import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { eq, and, ne, ilike, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { persons, members, applications, applicationGuardians } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { ClickToEditHint, Layout } from "../components/layout.js";
import { t } from "../i18n/index.js";
import { env } from "../env.js";
import { ageInYears } from "../lib/status.js";
import { sendMail } from "../lib/mail.js";

export const applicationRoutes = new Hono<{ Variables: Variables }>();
const guard = requireAuth("applications:review");

// ── Types ────────────────────────────────────────────────────────────────────

type Person = typeof persons.$inferSelect;
type ApplicationRow = typeof applications.$inferSelect;
type GuardianRow = typeof applicationGuardians.$inferSelect;
type ApplicationWithPerson = ApplicationRow & { person: Person; guardians: (GuardianRow & { person: Person })[] };
type ApplicationType = "membership" | "youth";
type ApplicationStatus = "open" | "approved" | "rejected";

// ── Helpers ──────────────────────────────────────────────────────────────────

function setFlash(c: any, message: string, type: "success" | "error") {
  setCookie(c, "flash", JSON.stringify({ message, type }), { path: "/", maxAge: 10, httpOnly: false });
}

function formatDateTime(d: Date): string {
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function fetchApplications(status?: ApplicationStatus): Promise<ApplicationWithPerson[]> {
  return db.query.applications.findMany({
    where: status ? eq(applications.status, status) : undefined,
    orderBy: desc(applications.submittedAt),
    with: { person: true, guardians: { with: { person: true } } },
  }) as unknown as Promise<ApplicationWithPerson[]>;
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
    .select({ id: members.id, lastName: persons.lastName, firstName: persons.firstName })
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
  open: "badge badge-warning",
  approved: "badge badge-success",
  rejected: "badge badge-ghost opacity-60",
};

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /applications — queue, defaults to open only
applicationRoutes.get("/", guard, async (c) => {
  const user = c.get("user");
  const statusParam = c.req.query("status");
  const status: ApplicationStatus | undefined = statusParam === "all" ? undefined : (statusParam as ApplicationStatus) || "open";

  const rows = await fetchApplications(status);

  return c.html(
    <Layout title={t("applications.title")} user={user} activeNav="applications">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">{t("applications.title")}</h1>
      </div>
      <div class="bg-base-200 rounded-box p-4 mb-4">
        <p class="text-sm font-medium mb-2">{t("applications.links.title")}</p>
        <div class="flex flex-col gap-2">
          {(["membership", "youth"] as const).map((type) => {
            const url = new URL(type === "membership" ? "/apply" : "/apply/youth", env.OIDC_APP_URL).toString();
            return (
              <div key={type} class="flex items-center gap-2 flex-wrap">
                <span class="badge badge-ghost">{TYPE_LABELS[type]}</span>
                <code class="text-sm break-all">{url}</code>
                <button type="button" class="btn btn-xs btn-outline apply-link-copy" data-url={url}>{t("applications.links.copy")}</button>
              </div>
            );
          })}
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          document.querySelectorAll('.apply-link-copy').forEach(function(btn) {
            var original = btn.textContent;
            btn.addEventListener('click', function() {
              navigator.clipboard.writeText(btn.dataset.url).then(function() {
                btn.textContent = ${JSON.stringify(t("applications.links.copied"))};
                setTimeout(function() { btn.textContent = original; }, 1500);
              });
            });
          });
        })();
      ` }} />
      <div class="join mb-4">
        {(["open", "approved", "rejected", "all"] as const).map((s) => (
          <a key={s} href={`/applications?status=${s}`} class={`btn btn-sm join-item${(status ?? "all") === s ? " btn-active" : ""}`}>
            {s === "all" ? t("common.show") : STATUS_LABELS[s]}
          </a>
        ))}
      </div>
      <ClickToEditHint />
      <table class="table table-zebra w-full">
        <thead>
          <tr>
            <th>{t("applications.table.name")}</th>
            <th>{t("applications.table.type")}</th>
            <th>{t("applications.table.submittedAt")}</th>
            <th>{t("applications.table.status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colspan={4} class="text-center opacity-50 py-8">{t("applications.table.empty")}</td></tr>
          ) : rows.map((a) => (
            <tr key={a.id} class="cursor-pointer hover" onclick={`window.location='/applications/${a.id}'`}>
              <td>{a.person.firstName} {a.person.lastName}</td>
              <td>{TYPE_LABELS[a.type]}</td>
              <td>{formatDateTime(a.submittedAt)}</td>
              <td><span class={STATUS_BADGE_CLASS[a.status]}>{STATUS_LABELS[a.status]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
});

// GET /applications/:id — detail, duplicate check, edit form
applicationRoutes.get("/:id", guard, async (c) => {
  const user = c.get("user");
  const app = await fetchApplication(c.req.param("id"));
  if (!app) return c.notFound();

  const { memberMatches, applicationMatches } = app.status === "open"
    ? await findDuplicates(app.person, app.id)
    : { memberMatches: [], applicationMatches: [] };
  const hasDuplicates = memberMatches.length > 0 || applicationMatches.length > 0;
  const ageWarning = app.type === "youth" && app.person.birthDate ? ageInYears(app.person.birthDate) >= env.YOUTH_AGE_LIMIT : false;

  return c.html(
    <Layout title={`${app.person.firstName} ${app.person.lastName}`} user={user} activeNav="applications">
      <div class="mb-4">
        <a href="/applications" class="link link-hover text-sm opacity-70">{t("common.backToList")}</a>
        <div class="flex items-center gap-3 mt-1">
          <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">{app.person.firstName} {app.person.lastName}</h1>
          <span class={STATUS_BADGE_CLASS[app.status]}>{STATUS_LABELS[app.status]}</span>
        </div>
        <p class="text-sm opacity-60 mt-1">{t("applications.detail.submittedAt", { date: formatDateTime(app.submittedAt) })} · {TYPE_LABELS[app.type]}</p>
      </div>

      {hasDuplicates && (
        <div class="alert alert-warning mb-4">
          <div>
            {memberMatches.length > 0 && <p class="font-bold">{t("applications.duplicate.isMember")}</p>}
            {applicationMatches.length > 0 && <p class="font-bold">{t("applications.duplicate.hasOpenApplication")}</p>}
          </div>
        </div>
      )}

      <div class="max-w-2xl border border-base-300 rounded-box p-6 mb-6">
        <form id="application-edit-form" method="post" action={`/applications/${app.id}`} class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label"><span class="label-text">{t("apply.form.lastName")}</span></label>
              <input type="text" name="lastName" value={app.person.lastName} class="input input-bordered w-full" />
            </div>
            <div class="form-control">
              <label class="label"><span class="label-text">{t("apply.form.firstName")}</span></label>
              <input type="text" name="firstName" value={app.person.firstName} class="input input-bordered w-full" />
            </div>
          </div>
          <div class="form-control">
            <label class="label"><span class="label-text">{t("apply.form.birthDate")}</span></label>
            <input type="date" name="birthDate" value={app.person.birthDate ?? ""} class="input input-bordered w-full" />
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="form-control">
              <label class="label"><span class="label-text">{t("apply.form.street")}</span></label>
              <input type="text" name="street" value={app.person.street ?? ""} class="input input-bordered w-full" />
            </div>
            <div class="form-control">
              <label class="label"><span class="label-text">{t("apply.form.houseNumber")}</span></label>
              <input type="text" name="houseNumber" value={app.person.houseNumber ?? ""} class="input input-bordered w-full" />
            </div>
            <div class="form-control">
              <label class="label"><span class="label-text">{t("apply.form.zip")}</span></label>
              <input type="text" name="zip" value={app.person.zip ?? ""} class="input input-bordered w-full" />
            </div>
          </div>
          <div class="form-control">
            <label class="label"><span class="label-text">{t("apply.form.city")}</span></label>
            <input type="text" name="city" value={app.person.city ?? ""} class="input input-bordered w-full" />
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label"><span class="label-text">{t("apply.form.email")}</span></label>
              <input type="email" name="email" value={app.person.email ?? ""} class="input input-bordered w-full" />
            </div>
            <div class="form-control">
              <label class="label"><span class="label-text">{t("apply.form.phone")}</span></label>
              <input type="tel" name="phone" value={app.person.phone ?? ""} class="input input-bordered w-full" />
            </div>
          </div>
          <div class="form-control">
            <label class="label"><span class="label-text">{t("applications.detail.message")}</span></label>
            <textarea name="message" class="textarea textarea-bordered w-full" rows={3}>{app.message ?? ""}</textarea>
          </div>
        </form>
        {app.guardians.length > 0 && (
          <div class="mt-4">
            <div class="divider">{t("applications.detail.guardians")}</div>
            <ul class="space-y-1 text-sm">
              {app.guardians.map((g) => (
                <li key={g.id}>{g.person.firstName} {g.person.lastName} — {g.person.email || g.person.phone || "—"}</li>
              ))}
            </ul>
          </div>
        )}
        {app.status === "rejected" && app.rejectedReason && (
          <div class="mt-4">
            <div class="divider">{t("applications.detail.rejectedReason")}</div>
            <p class="text-sm">{app.rejectedReason}</p>
          </div>
        )}
      </div>

      {app.status === "open" && (
        <div class="max-w-2xl space-y-4">
          <button type="submit" form="application-edit-form" class="btn btn-outline btn-sm">{t("applications.actions.save")}</button>

          <form method="post" action={`/applications/${app.id}/approve`} class="border border-base-300 rounded-box p-4 space-y-3">
            {hasDuplicates && (
              <label class="label cursor-pointer justify-start gap-3">
                <input type="checkbox" name="confirmDuplicate" class="checkbox" />
                <span class="label-text">{t("applications.duplicate.confirm")}</span>
              </label>
            )}
            {ageWarning && (
              <>
                <p class="text-warning text-sm">{t("applications.ageWarning", { limit: String(env.YOUTH_AGE_LIMIT) })}</p>
                <label class="label cursor-pointer justify-start gap-3">
                  <input type="checkbox" name="confirmAge" class="checkbox" />
                  <span class="label-text">{t("applications.ageWarning.confirm")}</span>
                </label>
              </>
            )}
            <button type="submit" class="btn btn-primary">{t("applications.actions.createMember")}</button>
          </form>

          <form
            method="post"
            action={`/applications/${app.id}/reject`}
            class="border border-base-300 rounded-box p-4 space-y-3"
            onsubmit={`return confirm('${t("applications.reject.confirm")}')`}
          >
            <div class="form-control">
              <label class="label"><span class="label-text">{t("applications.reject.reasonLabel")}</span></label>
              <textarea name="rejectedReason" class="textarea textarea-bordered w-full" rows={2}></textarea>
            </div>
            <label class="label cursor-pointer justify-start gap-3">
              <input type="checkbox" name="notifyApplicant" class="checkbox" />
              <span class="label-text">{t("applications.reject.notifyLabel")}</span>
            </label>
            <button type="submit" class="btn btn-outline btn-error">{t("applications.actions.reject")}</button>
          </form>
        </div>
      )}
    </Layout>
  );
});

// POST /applications/:id — edit fields (typo corrections etc.)
applicationRoutes.post("/:id", guard, async (c) => {
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

// POST /applications/:id/approve — re-validates the duplicate/age hard-confirms
// server-side, then hands off to the prefilled /members/new form. The application's
// status only flips to "approved" once that form is actually saved (see members.tsx).
applicationRoutes.post("/:id/approve", guard, async (c) => {
  const id = c.req.param("id");
  const app = await fetchApplication(id);
  if (!app || app.status !== "open") return c.notFound();

  const body = await c.req.parseBody();
  const { memberMatches, applicationMatches } = await findDuplicates(app.person, app.id);
  const hasDuplicates = memberMatches.length > 0 || applicationMatches.length > 0;
  const ageWarning = app.type === "youth" && app.person.birthDate ? ageInYears(app.person.birthDate) >= env.YOUTH_AGE_LIMIT : false;

  if (hasDuplicates && body.confirmDuplicate !== "on") {
    setFlash(c, t("applications.duplicate.confirm"), "error");
    return c.redirect(`/applications/${id}`);
  }
  if (ageWarning && body.confirmAge !== "on") {
    setFlash(c, t("applications.ageWarning.confirm"), "error");
    return c.redirect(`/applications/${id}`);
  }

  return c.redirect(`/members/new?personId=${app.personId}&applicationId=${app.id}`);
});

// POST /applications/:id/reject
applicationRoutes.post("/:id/reject", guard, async (c) => {
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
    await sendMail(app.person.email, t("applications.mail.rejectedSubject"), t("applications.mail.rejectedBody"));
  }

  setFlash(c, t("applications.flash.rejected"), "success");
  return c.redirect("/applications");
});
