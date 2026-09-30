import { Hono } from "hono";
import { eq, and, ne, ilike, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { persons, members, applications, applicationGuardians } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { ClickToEditHint, Layout } from "../components/layout.js";
import { Icon } from "../components/icon.js";
import { SortIcon } from "./members.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { env } from "../env.js";
import { ageInYears } from "../lib/status.js";
import { sendMail } from "../lib/mail.js";
import {
  isFormCurrentlyActive,
  loadApplicationForms,
  saveApplicationForm,
  type ApplicationForm,
} from "../lib/application-forms.js";

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
  open: "badge badge-warning",
  approved: "badge badge-success",
  rejected: "badge badge-ghost opacity-60",
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

// GET /applications — queue, defaults to open only
applicationRoutes.get("/", guard, async (c) => {
  const user = c.get("user");
  const statusRaw = (c.req.queries("status") ?? []).filter(Boolean);
  const statusFilter: ApplicationStatus[] = statusRaw[0] === "all"
    ? ALL_STATUSES
    : statusRaw.length > 0 ? (statusRaw as ApplicationStatus[]) : ["open"];
  const allSelected = ALL_STATUSES.every((s) => statusFilter.includes(s));

  const sort = ((c.req.query("sort") as SortKey) || "submittedAt");
  const dir = ((c.req.query("sort_dir") as "asc" | "desc") || "desc");

  const rows = sortApplications((await fetchApplications()).filter((a) => statusFilter.includes(a.status)), sort, dir);
  const forms = await loadApplicationForms();
  const canManageForms = user.permissions.has("applications:manage-forms");

  function filterUrl(next: ApplicationStatus[]) {
    const params = new URLSearchParams();
    for (const s of next) params.append("status", s);
    params.set("sort", sort);
    params.set("sort_dir", dir);
    return `/applications?${params}`;
  }

  function sortUrl(col: SortKey) {
    const defaultDir = DATE_SORT_KEYS.includes(col) ? "desc" : "asc";
    const newDir = sort === col ? (dir === "asc" ? "desc" : "asc") : defaultDir;
    const params = new URLSearchParams();
    for (const s of statusFilter) params.append("status", s);
    params.set("sort", col);
    params.set("sort_dir", newDir);
    return `/applications?${params}`;
  }

  return c.html(
    <Layout title={t("applications.title")} user={user} activeNav="applications">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">{t("applications.title")}</h1>
        <div class="dropdown dropdown-end">
          <div tabindex={0} role="button" class="btn btn-ghost btn-sm btn-circle" title={t("applications.links.title")} aria-label={t("applications.links.title")}>
            <Icon name="link" class="h-5 w-5" />
          </div>
          <ul tabindex={0} class="dropdown-content menu bg-base-200 rounded-box z-10 w-64 p-2 shadow">
            <li class="menu-title">{t("applications.links.title")}</li>
            {(["membership", "youth"] as const).map((type) => {
              const url = new URL(type === "membership" ? "/apply" : "/apply/youth", env.OIDC_APP_URL).toString();
              const status = formatFormStatusText(forms[type]);
              return (
                <li key={type}>
                  <div class="flex flex-col gap-0.5 px-1 py-1 w-full">
                    <div class="flex items-center justify-between gap-2 w-full">
                      <a href={url} target="_blank" rel="noopener" class="flex-1" onclick="document.activeElement.blur()">{TYPE_LABELS[type]}</a>
                      <button type="button" class="btn btn-md btn-ghost btn-square apply-link-copy" data-url={url} title={t("applications.links.copy")} aria-label={t("applications.links.copy")}>
                        <Icon name="clipboard-document" class="h-4 w-4" />
                      </button>
                      {canManageForms && (
                        <button
                          type="button"
                          class="btn btn-md btn-ghost btn-square"
                          title={t("applications.links.settings")}
                          aria-label={t("applications.links.settings")}
                          onclick={`document.getElementById('form-settings-${type}').showModal();document.activeElement.blur()`}
                        >
                          <Icon name="cog-6-tooth" class="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div class="flex items-center gap-1.5 text-xs opacity-60 pl-1 w-full">
                      <span class={`inline-block h-2 w-2 rounded-full ${status.active ? "bg-success" : "bg-error"}`} />
                      {status.text}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      {canManageForms && (["membership", "youth"] as const).map((type) => {
        const form = forms[type];
        return (
          <dialog id={`form-settings-${type}`} class="modal" key={`form-settings-${type}`}>
            <div class="modal-box">
              <h3 class="font-bold text-lg mb-4">{t("applications.formSettings.title", { type: TYPE_LABELS[type] })}</h3>
              <form method="post" action={`/applications/forms/${type}`} class="space-y-4 form-settings-form">
                <div class="form-control">
                  <span class="label-text">{t("applications.formSettings.statusLabel")}</span>
                  <div class="join w-full mt-1">
                    <label class="join-item btn flex-1 has-[:checked]:btn-primary">
                      <input type="radio" name="status" value="active" class="hidden" checked={form?.isActive === true} />
                      {t("applications.formSettings.active")}
                    </label>
                    <label class="join-item btn flex-1 has-[:checked]:btn-primary">
                      <input type="radio" name="status" value="inactive" class="hidden" checked={form?.isActive !== true} />
                      {t("applications.formSettings.inactive")}
                    </label>
                  </div>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div class="form-control">
                    <label class="label"><span class="label-text form-start-label">{t("applications.formSettings.startDate")}</span></label>
                    <input type="date" name="startDate" value={form?.startDate ?? ""} class="input input-bordered w-full" />
                  </div>
                  <div class="form-control">
                    <label class="label"><span class="label-text form-end-label">{t("applications.formSettings.endDate")}</span></label>
                    <input type="date" name="endDate" value={form?.endDate ?? ""} class="input input-bordered w-full" />
                  </div>
                </div>
                <p class="text-sm form-status-preview"></p>
                <p class="text-xs opacity-60">{t("applications.formSettings.dateHint")}</p>
                <div class="modal-action">
                  <button type="button" class="btn" onclick="this.closest('dialog').close()">{t("common.cancel")}</button>
                  <button type="submit" class="btn btn-primary">{t("applications.formSettings.save")}</button>
                </div>
              </form>
            </div>
            <form method="dialog" class="modal-backdrop">
              <button>{t("common.close")}</button>
            </form>
          </dialog>
        );
      })}
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          document.querySelectorAll('.apply-link-copy').forEach(function(btn) {
            btn.addEventListener('click', function() {
              navigator.clipboard.writeText(btn.dataset.url).then(function() {
                document.body.dispatchEvent(new CustomEvent('showToast', { detail: { message: ${JSON.stringify(t("applications.links.copied"))}, type: 'info' } }));
              });
            });
          });

          var labels = {
            active: { start: ${JSON.stringify(t("applications.formSettings.startDate"))}, end: ${JSON.stringify(t("applications.formSettings.endDate"))} },
            inactive: { start: ${JSON.stringify(t("applications.formSettings.inactiveStartDate"))}, end: ${JSON.stringify(t("applications.formSettings.inactiveEndDate"))} },
          };
          var statusText = {
            active: ${JSON.stringify(t("applications.formStatus.active"))},
            inactive: ${JSON.stringify(t("applications.formStatus.inactive"))},
            activeFrom: ${JSON.stringify(t("applications.formStatus.activeFrom"))},
            activeUntil: ${JSON.stringify(t("applications.formStatus.activeUntil"))},
            activeRange: ${JSON.stringify(t("applications.formStatus.activeRange"))},
            inactiveFrom: ${JSON.stringify(t("applications.formStatus.inactiveFrom"))},
            inactiveUntil: ${JSON.stringify(t("applications.formStatus.inactiveUntil"))},
            inactiveRange: ${JSON.stringify(t("applications.formStatus.inactiveRange"))},
          };
          function fmt(iso) {
            var p = iso.split('-');
            return p[2] + '.' + p[1] + '.' + p[0];
          }
          document.querySelectorAll('.form-settings-form').forEach(function(form) {
            var startInput = form.querySelector('input[name="startDate"]');
            var endInput = form.querySelector('input[name="endDate"]');
            var startLabel = form.querySelector('.form-start-label');
            var endLabel = form.querySelector('.form-end-label');
            var preview = form.querySelector('.form-status-preview');
            function update() {
              var mode = form.querySelector('input[name="status"]:checked').value;
              startLabel.textContent = labels[mode].start;
              endLabel.textContent = labels[mode].end;
              var start = startInput.value, end = endInput.value;
              if (!start && !end) preview.textContent = statusText[mode];
              else if (start && !end) preview.textContent = statusText[mode + 'From'].replace('{date}', fmt(start));
              else if (!start && end) preview.textContent = statusText[mode + 'Until'].replace('{date}', fmt(end));
              else preview.textContent = statusText[mode + 'Range'].replace('{start}', fmt(start)).replace('{end}', fmt(end));
            }
            form.querySelectorAll('input[name="status"]').forEach(function(r) { r.addEventListener('change', update); });
            startInput.addEventListener('input', update);
            endInput.addEventListener('input', update);
            form.closest('dialog').addEventListener('close', function() { form.reset(); update(); });
            update();
          });
        })();
      ` }} />
      <div class="join mb-4">
        {ALL_STATUSES.map((s) => (
          <a
            key={s}
            href={filterUrl(statusFilter.includes(s) ? statusFilter.filter((x) => x !== s) : [...statusFilter, s])}
            class={`btn btn-sm join-item${statusFilter.includes(s) ? " btn-primary btn-outline" : " btn-ghost"}`}
          >
            {STATUS_LABELS[s]}
          </a>
        ))}
        <a key="all" href={filterUrl(ALL_STATUSES)} class={`btn btn-sm join-item${allSelected ? " btn-primary btn-outline" : " btn-ghost"}`}>
          {t("applications.filter.all")}
        </a>
      </div>
      <ClickToEditHint />
      <table class="table table-zebra w-full">
        <thead>
          <tr>
            <th><a href={sortUrl("lastName")} class="link link-hover">{t("applications.table.lastName")} <SortIcon col="lastName" active={sort} dir={dir} /></a></th>
            <th><a href={sortUrl("firstName")} class="link link-hover">{t("applications.table.firstName")} <SortIcon col="firstName" active={sort} dir={dir} /></a></th>
            <th>{t("applications.table.type")}</th>
            <th><a href={sortUrl("submittedAt")} class="link link-hover">{t("applications.table.submittedAt")} <SortIcon col="submittedAt" active={sort} dir={dir} /></a></th>
            <th>{t("applications.table.status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colspan={5} class="text-center opacity-50 py-8">{t("applications.table.empty")}</td></tr>
          ) : rows.map((a) => (
            <tr key={a.id} class="cursor-pointer hover" onclick={`window.location='/applications/${a.id}'`}>
              <td>{a.person.lastName}</td>
              <td>{a.person.firstName}</td>
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
  // Only the first match is offered for linking — a second, coinciding match is an
  // out-of-scope edge case (see backlog "Digitale Anträge" § Duplikat-Prüfung).
  const memberMatch = memberMatches[0];
  const memberMatchIsArchived = !!(memberMatch?.exitDate || memberMatch?.deathDate);
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
        <div class="alert alert-warning mb-4 max-w-2xl">
          <div>
            {memberMatches.length > 0 && (
              <>
                <p class="font-bold">{t("applications.duplicate.isMember")}</p>
                <p class="text-sm">{t(memberMatchIsArchived ? "applications.duplicate.statusArchived" : "applications.duplicate.statusActive")}</p>
              </>
            )}
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
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <button type="submit" form="application-edit-form" class="btn btn-primary btn-outline">{t("applications.actions.save")}</button>
              {memberMatch ? (
                <button type="button" id="create-member-btn" class="btn btn-primary" onclick="document.getElementById('approve-modal').showModal()">{t("applications.actions.approve")}</button>
              ) : (
                <button type="submit" form="application-approve-form" id="create-member-btn" class="btn btn-primary">{t("applications.actions.approve")}</button>
              )}
            </div>
            <button type="button" class="btn btn-outline btn-error" onclick="document.getElementById('reject-modal').showModal()">{t("applications.actions.reject")}</button>
          </div>

          <form id="application-approve-form" method="post" action={`/applications/${app.id}/approve`}>
            {ageWarning && (
              <>
                <p class="text-warning text-sm">{t("applications.ageWarning", { limit: String(env.YOUTH_AGE_LIMIT) })}</p>
                <label class="label cursor-pointer justify-start gap-3">
                  <input type="checkbox" name="confirmAge" class="checkbox" />
                  <span class="label-text">{t("applications.ageWarning.confirm")}</span>
                </label>
              </>
            )}
          </form>

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
                <div class="form-control">
                  <label class="label"><span class="label-text">{t("applications.reject.reasonLabel")}</span></label>
                  <textarea name="rejectedReason" class="textarea textarea-bordered w-full" rows={2}></textarea>
                </div>
                <label class="label cursor-pointer justify-start gap-3">
                  <input type="checkbox" name="notifyApplicant" class="checkbox" />
                  <span class="label-text">{t("applications.reject.notifyLabel")}</span>
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

// POST /applications/:id/approve — re-validates the age hard-confirm server-side
// (the member-duplicate choice is now made directly via the linkMemberId submit
// button, see GET /:id's approve-modal), auto-rejects any open twin applications
// found by findDuplicates, then hands off to the prefilled /members/new form. The
// application's status only flips to "approved" once that form is actually saved
// (see members.tsx).
applicationRoutes.post("/:id/approve", guard, async (c) => {
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

// POST /applications/forms/:type — de-/activate a public application form,
// gated by its own permission (separate from applications:review).
applicationRoutes.post("/forms/:type", requireAuth("applications:manage-forms"), async (c) => {
  const type = c.req.param("type");
  if (type !== "membership" && type !== "youth") return c.notFound();

  const body = await c.req.parseBody();
  await saveApplicationForm(type, {
    isActive: body.status === "active",
    startDate: String(body.startDate ?? "").trim() || null,
    endDate: String(body.endDate ?? "").trim() || null,
  });

  setFlash(c, t("applications.flash.formSettingsSaved"), "success");
  return c.redirect("/applications");
});
