import { loadOrgConfig } from "../lib/org-config.js";
import { Hono } from "hono";
import { eq, and, ne, ilike, inArray } from "drizzle-orm";
import { AddressFields } from "../components/address.js";
import { EmailField, Field } from "../components/field.js";
import { db } from "../db/index.js";
import { persons, members, applications, applicationGuardians } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { ClickToEditHint, Layout } from "../components/layout.js";
import { ImpressumHint } from "../components/impressum-hint.js";
import { Icon } from "../components/icon.js";
import { HeaderAction, PageHeader } from "../components/page-header.js";
import { SortIcon } from "./members.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { buildListUrl } from "../lib/list-query.js";
import { QuickRangeFilter } from "../components/quick-range-filter.js";
import { parseRange, rangeParams, rangePresets, todayStr } from "../lib/quick-range.js";
import { env } from "../env.js";
import { ageInYears } from "../lib/status.js";
import { sendMail } from "../lib/mail.js";
import { buildVars } from "../lib/mail-templates.js";
import {
  isFormCurrentlyActive,
  loadApplicationForms,
  saveApplicationForm,
  type ApplicationForm,
} from "../lib/application-forms.js";

export const applicationRoutes = new Hono<{ Variables: Variables }>();
const guard = requireAuth("applications:read");
const recordGuard = requireAuth("applications:record");
const reviewGuard = requireAuth("applications:review");

// ── Types ────────────────────────────────────────────────────────────────────

type Person = typeof persons.$inferSelect;
type ApplicationRow = typeof applications.$inferSelect;
type GuardianRow = typeof applicationGuardians.$inferSelect;
type ApplicationWithPerson = ApplicationRow & { person: Person; guardians: (GuardianRow & { person: Person })[] };
type ApplicationType = "membership" | "youth";
type ApplicationStatus = "open" | "approved" | "rejected";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(d: Date): string {
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function fetchApplications(): Promise<ApplicationWithPerson[]> {
  return db.query.applications.findMany({
    with: { person: true, guardians: { with: { person: true } } },
  }) as unknown as Promise<ApplicationWithPerson[]>;
}

// ── Sort helpers (mirrors members.tsx's sortMembers/SortIcon pattern) ──────────

type SortKey = "lastName" | "firstName" | "submittedAt";
const DATE_SORT_KEYS: SortKey[] = ["submittedAt"];

function sortApplications(list: ApplicationWithPerson[], sort: SortKey, dir: "asc" | "desc"): ApplicationWithPerson[] {
  return [...list].sort((a, b) => {
    const cmp = sort === "submittedAt"
      ? a.submittedAt.getTime() - b.submittedAt.getTime()
      : a.person[sort].localeCompare(b.person[sort], "de");
    return dir === "asc" ? cmp : -cmp;
  });
}

async function fetchApplication(id: string): Promise<ApplicationWithPerson | undefined> {
  return db.query.applications.findFirst({
    where: eq(applications.id, id),
    with: { person: true, guardians: { with: { person: true } } },
  }) as unknown as Promise<ApplicationWithPerson | undefined>;
}

// Exact match, case-insensitive, on last name + first name + birth date — checked
// against both existing members and other still-open applications (see backlog
// "Digitale Anträge" § Duplikat-Prüfung).
async function findDuplicates(person: Pick<Person, "lastName" | "firstName" | "birthDate">, excludeApplicationId: string) {
  if (!person.birthDate) return { memberMatches: [], applicationMatches: [] };

  const memberMatches = await db
    .select({ id: members.id, lastName: persons.lastName, firstName: persons.firstName, exitDate: members.exitDate, deathDate: members.deathDate })
    .from(members)
    .innerJoin(persons, eq(members.personId, persons.id))
    .where(and(ilike(persons.lastName, person.lastName), ilike(persons.firstName, person.firstName), eq(persons.birthDate, person.birthDate)));

  const applicationMatches = await db
    .select({ id: applications.id, lastName: persons.lastName, firstName: persons.firstName })
    .from(applications)
    .innerJoin(persons, eq(applications.personId, persons.id))
    .where(and(
      ilike(persons.lastName, person.lastName),
      ilike(persons.firstName, person.firstName),
      eq(persons.birthDate, person.birthDate),
      eq(applications.status, "open"),
      ne(applications.id, excludeApplicationId),
    ));

  return { memberMatches, applicationMatches };
}

const TYPE_LABELS: Record<ApplicationType, string> = {
  membership: t("applications.type.membership"),
  youth: t("applications.type.youth"),
};

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  open: t("applications.status.open"),
  approved: t("applications.status.approved"),
  rejected: t("applications.status.rejected"),
};

const STATUS_BADGE_CLASS: Record<ApplicationStatus, string> = {
  open: "badge badge-sm badge-warning",
  approved: "badge badge-sm badge-success",
  rejected: "badge badge-sm badge-ghost opacity-60",
};

// Describes the *configured rule* in plain text (e.g. "Aktiv bis 01.09.2026"),
// independent of the "active" flag below which reflects whether that rule
// currently resolves to active — see isFormCurrentlyActive's window semantics.
function formatFormStatusText(form: ApplicationForm | undefined): { text: string; active: boolean } {
  const active = isFormCurrentlyActive(form);
  if (!form) return { text: t("applications.formStatus.inactive"), active };
  const fmt = (d: string) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const { isActive, startDate, endDate } = form;
  if (!startDate && !endDate) {
    return { text: t(isActive ? "applications.formStatus.active" : "applications.formStatus.inactive"), active };
  }
  if (startDate && !endDate) {
    return { text: t(isActive ? "applications.formStatus.activeFrom" : "applications.formStatus.inactiveFrom", { date: fmt(startDate) }), active };
  }
  if (!startDate && endDate) {
    return { text: t(isActive ? "applications.formStatus.activeUntil" : "applications.formStatus.inactiveUntil", { date: fmt(endDate) }), active };
  }
  return { text: t(isActive ? "applications.formStatus.activeRange" : "applications.formStatus.inactiveRange", { start: fmt(startDate!), end: fmt(endDate!) }), active };
}

// ── Routes ───────────────────────────────────────────────────────────────────

const ALL_STATUSES: ApplicationStatus[] = ["open", "approved", "rejected"];

// GET /applications — die Liste lebt in /members (offene Anträge dort mit Statusfilter)
applicationRoutes.get("/", guard, (c) => c.redirect("/members?status=requested", 301));

// GET /applications/:id — detail, duplicate check, edit form
applicationRoutes.get("/:id", guard, async (c) => {
  const user = c.get("user");
  const canEdit = user.permissions.has("applications:record");
  const canReview = user.permissions.has("applications:review");
  const app = await fetchApplication(c.req.param("id"));
  if (!app) return c.notFound();

  const { memberMatches, applicationMatches } = app.status === "open"
    ? await findDuplicates(app.person, app.id)
    : { memberMatches: [], applicationMatches: [] };
  const hasDuplicates = memberMatches.length > 0 || applicationMatches.length > 0;
  // Only the first match is offered for linking — a second, coinciding match is an
  // out-of-scope edge case (see backlog "Digitale Anträge" § Duplikat-Prüfung).
  const memberMatch = memberMatches[0];
  const memberMatchIsArchived = !!(memberMatch?.exitDate || memberMatch?.deathDate);
  const ageWarning = app.type === "youth" && app.person.birthDate ? ageInYears(app.person.birthDate) >= env.YOUTH_AGE_LIMIT : false;
  const canDecide = app.status === "open" && canReview;
  const showSave = app.status === "open" && canEdit;
  const actions = (
    <>
      {canDecide && (
        <div class="flex items-center gap-2 mr-3">
        <HeaderAction icon="icon-[tabler--user-x]" label={t("applications.actions.reject")} hideLabel="@max-3xl:hidden" class="btn-outline btn-error" onclick="document.getElementById('reject-modal').showModal()" />
        {memberMatch
          ? <HeaderAction icon="icon-[tabler--user-check]" label={t("applications.actions.approve")} hideLabel="@max-3xl:hidden" class="btn-success" attrs={{ id: "create-member-btn" }} onclick="document.getElementById('approve-modal').showModal()" />
          : <HeaderAction icon="icon-[tabler--user-check]" label={t("applications.actions.approve")} hideLabel="@max-3xl:hidden" form="application-approve-form" class="btn-success" attrs={{ id: "create-member-btn" }} />}
        </div>
      )}
      {showSave && <HeaderAction variant="primary" icon="icon-[tabler--check]" label={t("applications.actions.save")} form="application-edit-form" class="btn-primary" />}
    </>
  );
  const cardCls = "card card-border bg-base-100 border-base-300";

  return c.html(
    <Layout title={`${app.person.firstName} ${app.person.lastName}`} user={user}>
      <PageHeader title={<>{app.person.firstName} {app.person.lastName} <span class={STATUS_BADGE_CLASS[app.status]}>{STATUS_LABELS[app.status]}</span></>} backHref="/members?status=requested" subtitle={<>{t("applications.detail.submittedAt", { date: formatDateTime(app.submittedAt) })} · {TYPE_LABELS[app.type]}</>} actions={actions} />

      {hasDuplicates && (
        <div class="alert alert-warning mb-4" role="alert">
          <Icon name="icon-[tabler--alert-triangle]" class="h-5 w-5 shrink-0" />
          <div>
            {memberMatches.length > 0 && (
              <>
                <p class="font-bold">{t("applications.duplicate.isMember")}: <a class="link" href={`/members/${memberMatch.id}`}>{memberMatch.firstName} {memberMatch.lastName}</a></p>
                <p class="text-sm">{t(memberMatchIsArchived ? "applications.duplicate.statusArchived" : "applications.duplicate.statusActive")}</p>
              </>
            )}
            {applicationMatches.length > 0 && <p class="font-bold">{t("applications.duplicate.hasOpenApplication")}</p>}
          </div>
        </div>
      )}

      {ageWarning && app.status === "open" && (
        <div class="alert alert-warning mb-4" role="alert">
          <Icon name="icon-[tabler--alert-triangle]" class="h-5 w-5 shrink-0" />
          <div>
            <p class="text-sm">{t("applications.ageWarning", { limit: String(env.YOUTH_AGE_LIMIT) })}</p>
            {canDecide && (
              <label class="label cursor-pointer justify-start gap-3 pointer-coarse:min-h-11">
                <input type="checkbox" name="confirmAge" form="application-approve-form" class="checkbox" />
                <span class="text-sm">{t("applications.ageWarning.confirm")}</span>
              </label>
            )}
          </div>
        </div>
      )}

      <form id="application-edit-form" method="post" action={`/applications/${app.id}`} class="mb-6">
        <fieldset disabled={!canEdit} class="border-0 p-0 m-0 min-w-0 grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <section class={`${cardCls} card-body gap-4`}>
            <h2 class="card-title text-base" style="font-family: var(--font-heading)"><Icon name="icon-[tabler--user]" class="h-5 w-5 opacity-60" />{t("applications.detail.person")}</h2>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={t("apply.form.lastName")}>
                <input type="text" name="lastName" value={app.person.lastName} class="input w-full" placeholder={t("apply.form.lastName")} />
              </Field>
              <Field label={t("apply.form.firstName")}>
                <input type="text" name="firstName" value={app.person.firstName} class="input w-full" placeholder={t("apply.form.firstName")} />
              </Field>
            </div>
            <Field label={t("apply.form.birthDate")}>
              <input type="date" name="birthDate" value={app.person.birthDate ?? ""} class="input w-full" />
            </Field>
          </section>

          <section class={`${cardCls} card-body gap-4`}>
            <h2 class="card-title text-base" style="font-family: var(--font-heading)"><Icon name="icon-[tabler--mail]" class="h-5 w-5 opacity-60" />{t("applications.detail.contact")}</h2>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <EmailField label={t("apply.form.email")} name="email" value={app.person.email ?? ""} />
              <Field label={t("apply.form.phone")}>
                <input type="tel" name="phone" value={app.person.phone ?? ""} class="input w-full" placeholder={t("apply.form.phone")} />
              </Field>
            </div>
            <AddressFields
              street={<Field label={t("apply.form.street")}><input type="text" name="street" value={app.person.street ?? ""} class="input w-full" placeholder={t("apply.form.street")} /></Field>}
              houseNumber={<Field label={t("apply.form.houseNumber")}><input type="text" name="houseNumber" value={app.person.houseNumber ?? ""} class="input w-full" placeholder={t("apply.form.houseNumber")} /></Field>}
              zip={<Field label={t("apply.form.zip")}><input type="text" name="zip" value={app.person.zip ?? ""} class="input w-full" placeholder={t("apply.form.zip")} /></Field>}
              city={<Field label={t("apply.form.city")}><input type="text" name="city" value={app.person.city ?? ""} class="input w-full" placeholder={t("apply.form.city")} /></Field>}
            />
          </section>

          <section class={`${cardCls} card-body gap-4 lg:col-span-2`}>
            <h2 class="card-title text-base" style="font-family: var(--font-heading)">{t("applications.detail.message")}</h2>
            <Field label={t("applications.detail.message")}>
              <textarea name="message" class="textarea w-full" rows={3} placeholder={t("applications.detail.message")}>{app.message ?? ""}</textarea>
            </Field>
          </section>
        </fieldset>
      </form>

      {(app.guardians.length > 0 || (app.status === "rejected" && app.rejectedReason)) && (
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {app.guardians.length > 0 && (
            <section class={`${cardCls} card-body gap-2`}>
              <h2 class="card-title text-base" style="font-family: var(--font-heading)"><Icon name="icon-[tabler--users]" class="h-5 w-5 opacity-60" />{t("applications.detail.guardians")}</h2>
              <ul class="space-y-1 text-sm">
                {app.guardians.map((g) => (
                  <li key={g.id}>
                    {g.person.firstName} {g.person.lastName} —{" "}
                    {g.person.email ? <a class="link" href={`mailto:${g.person.email}`}>{g.person.email}</a>
                      : g.person.phone ? <a class="link" href={`tel:${g.person.phone}`}>{g.person.phone}</a> : "—"}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {app.status === "rejected" && app.rejectedReason && (
            <section class="card card-border bg-base-100 border-error card-body gap-2">
              <h2 class="card-title text-base text-error" style="font-family: var(--font-heading)"><Icon name="icon-[tabler--x]" class="h-5 w-5" />{t("applications.detail.rejectedReason")}</h2>
              <p class="text-sm">{app.rejectedReason}</p>
            </section>
          )}
        </div>
      )}

      {canDecide && (
        <>
          <form id="application-approve-form" method="post" action={`/applications/${app.id}/approve`} />

          {memberMatch && (
            <dialog id="approve-modal" class="modal">
              <div class="modal-box max-w-xl">
                <h3 class="font-bold text-lg mb-4">{t("applications.duplicate.chooseTitle")}</h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button type="submit" form="application-approve-form" name="linkMemberId" value={memberMatch.id} class="card bg-base-200 hover:bg-base-300 p-4 text-left">
                    <div class="font-bold">{t("applications.duplicate.linkOption")}</div>
                    <div class="text-sm opacity-70 mt-1">{t(memberMatchIsArchived ? "applications.duplicate.linkOptionDesc" : "applications.duplicate.linkOptionDescActive")}</div>
                  </button>
                  <button type="submit" form="application-approve-form" name="linkMemberId" value="" class="card bg-base-200 hover:bg-base-300 p-4 text-left">
                    <div class="font-bold">{t("applications.duplicate.newOption")}</div>
                    <div class="text-sm opacity-70 mt-1">{t("applications.duplicate.newOptionDesc")}</div>
                  </button>
                </div>
                <div class="modal-action">
                  <form method="dialog">
                    <button class="btn">{t("common.cancel")}</button>
                  </form>
                </div>
              </div>
              <form method="dialog" class="modal-backdrop">
                <button>{t("common.close")}</button>
              </form>
            </dialog>
          )}

          <dialog id="reject-modal" class="modal">
            <div class="modal-box">
              <h3 class="font-bold text-lg">{t("applications.reject.confirm")}</h3>
              <form id="application-reject-form" method="post" action={`/applications/${app.id}/reject`} class="space-y-3 mt-4">
                <Field label={t("applications.reject.reasonLabel")}>
                  <textarea name="rejectedReason" class="textarea w-full" rows={2} placeholder={t("applications.reject.reasonLabel")}></textarea>
                </Field>
                <label class="label cursor-pointer justify-start gap-3 pointer-coarse:min-h-11">
                  <input type="checkbox" name="notifyApplicant" class="checkbox" />
                  <span class="text-sm">{t("applications.reject.notifyLabel")}</span>
                </label>
              </form>
              <div class="modal-action">
                <form method="dialog">
                  <button class="btn">{t("common.cancel")}</button>
                </form>
                <button type="submit" form="application-reject-form" class="btn btn-error">{t("applications.reject.confirmButton")}</button>
              </div>
            </div>
            <form method="dialog" class="modal-backdrop">
              <button>{t("common.close")}</button>
            </form>
          </dialog>
        </>
      )}
    </Layout>
  );
});

// POST /applications/:id — edit fields (typo corrections etc.)
applicationRoutes.post("/:id", recordGuard, async (c) => {
  const id = c.req.param("id");
  const app = await fetchApplication(id);
  if (!app) return c.notFound();

  const body = await c.req.parseBody();
  await db.update(persons).set({
    lastName: String(body.lastName ?? "").trim() || app.person.lastName,
    firstName: String(body.firstName ?? "").trim() || app.person.firstName,
    birthDate: (body.birthDate as string) || null,
    street: (body.street as string) || null,
    houseNumber: (body.houseNumber as string) || null,
    zip: (body.zip as string) || null,
    city: (body.city as string) || null,
    email: (body.email as string) || null,
    phone: (body.phone as string) || null,
  }).where(eq(persons.id, app.personId));
  await db.update(applications).set({ message: (body.message as string) || null }).where(eq(applications.id, id));

  setFlash(c, t("applications.flash.saved"), "success");
  return c.redirect(`/applications/${id}`);
});

// POST /applications/:id/approve — re-validates the age hard-confirm server-side
// (the member-duplicate choice is now made directly via the linkMemberId submit
// button, see GET /:id's approve-modal), auto-rejects any open twin applications
// found by findDuplicates, then hands off to the prefilled /members/new form. The
// application's status only flips to "approved" once that form is actually saved
// (see members.tsx).
applicationRoutes.post("/:id/approve", reviewGuard, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const app = await fetchApplication(id);
  if (!app || app.status !== "open") return c.notFound();

  const body = await c.req.parseBody();
  const { memberMatches, applicationMatches } = await findDuplicates(app.person, app.id);
  const ageWarning = app.type === "youth" && app.person.birthDate ? ageInYears(app.person.birthDate) >= env.YOUTH_AGE_LIMIT : false;

  if (ageWarning && body.confirmAge !== "on") {
    setFlash(c, t("applications.ageWarning.confirm"), "error");
    return c.redirect(`/applications/${id}`);
  }

  const linkMemberId = String(body.linkMemberId ?? "").trim() || undefined;
  if (linkMemberId && !memberMatches.some((m) => m.id === linkMemberId)) {
    return c.notFound();
  }

  if (applicationMatches.length > 0) {
    await db.update(applications)
      .set({ status: "rejected", rejectedReason: t("applications.duplicate.autoRejectedReason"), reviewedAt: new Date(), reviewedBy: user.id })
      .where(inArray(applications.id, applicationMatches.map((m) => m.id)));
  }

  const params = new URLSearchParams({ applicationId: app.id });
  if (linkMemberId) params.set("linkMemberId", linkMemberId);
  else params.set("personId", app.personId);
  return c.redirect(`/members/new?${params}`);
});

// POST /applications/:id/reject
applicationRoutes.post("/:id/reject", reviewGuard, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const app = await fetchApplication(id);
  if (!app || app.status !== "open") return c.notFound();

  const body = await c.req.parseBody();
  const rejectedReason = String(body.rejectedReason ?? "").trim() || null;
  const notifyApplicant = body.notifyApplicant === "on";

  await db.update(applications)
    .set({ status: "rejected", rejectedReason, reviewedAt: new Date(), reviewedBy: user.id })
    .where(eq(applications.id, id));

  if (notifyApplicant && app.person.email) {
    await sendMail({ key: "application-rejected", to: app.person.email, vars: buildVars("application-rejected", { orgContactEmail: (await loadOrgConfig()).orgContactEmail }, [{ firstName: app.person.firstName, lastName: app.person.lastName, email: app.person.email }]) });
  }

  setFlash(c, t("applications.flash.rejected"), "success");
  return c.redirect("/members");
});

// POST /applications/forms/:type — de-/activate a public application form,
// gated by its own permission (separate from applications:review).
applicationRoutes.post("/forms/:type", requireAuth("applications:manage"), async (c) => {
  const type = c.req.param("type");
  if (type !== "membership" && type !== "youth") return c.notFound();

  const body = await c.req.parseBody();
  await saveApplicationForm(type, {
    isActive: body.status === "active",
    startDate: String(body.startDate ?? "").trim() || null,
    endDate: String(body.endDate ?? "").trim() || null,
  });

  setFlash(c, t("applications.flash.formSettingsSaved"), "success");
  return c.redirect("/members");
});
