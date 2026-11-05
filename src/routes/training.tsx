import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { members, persons, trainingRecords } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { Section } from "../components/section.js";
import { Field } from "../components/field.js";
import { RowAction } from "../components/row-action.js";
import { ActionContent, PageHeader } from "../components/page-header.js";
import { Pager } from "../components/pager.js";
import { MultiSelectFilter } from "../components/multi-select-filter.js";
import { formatDate } from "../lib/format.js";
import { resolveTimezone, toLocalDate } from "../lib/datetime.js";
import { buildListUrl, PAGE_SIZE_OPTIONS, parsePagination } from "../lib/list-query.js";
import { TRAINING_TITLE_MAX, parseTrainingInput, trainingStatuses, type TrainingStatus } from "../lib/training.js";
import { t } from "../i18n/index.js";

export const trainingRoutes = new Hono<{ Variables: Variables }>();
const read = requireAuth("training:read");
const write = requireAuth("training:write");
const del = requireAuth("training:delete");

type Record_ = typeof trainingRecords.$inferSelect;
const today = () => toLocalDate(new Date(), resolveTimezone());
const UNPROCESSABLE = 422;

function StatusBadge({ s }: { s: TrainingStatus | undefined }) {
  if (s === "expired") return <span class="badge badge-sm badge-error">{t("training.status.expired")}</span>;
  if (s === "soon") return <span class="badge badge-sm badge-warning">{t("training.status.soon")}</span>;
  return null;
}

async function loadRecords(memberId: string) {
  const rows = await db.select().from(trainingRecords).where(eq(trainingRecords.memberId, memberId));
  return rows.sort((a, b) => (a.expiresAt ?? "9999").localeCompare(b.expiresAt ?? "9999") || a.title.localeCompare(b.title, "de"));
}

export function TrainingBox({ memberId, rows, canWrite, canDelete }: { memberId: string; rows: Record_[]; canWrite: boolean; canDelete: boolean }) {
  const status = trainingStatuses(rows, today());
  return (
    <div id="training-box">
      <div class="overflow-x-auto">
        <table class="table w-full">
          <thead><tr><th>{t("training.form.title")}</th><th>{t("training.form.completedAt")}</th><th>{t("training.form.expiresAt")}</th><th>{t("training.form.organizer")}</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colspan={5} class="text-center opacity-50 py-4">{t("training.empty")}</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.title} <StatusBadge s={status.get(r.id)} /></td>
                <td>{r.completedAt ? formatDate(r.completedAt) : "–"}</td>
                <td>{r.expiresAt ? formatDate(r.expiresAt) : "–"}</td>
                <td>{r.organizer}</td>
                <td class="text-right whitespace-nowrap">
                  {canWrite && <RowAction icon="pencil" label={t("common.edit")} attrs={{ "hx-get": `/members/${memberId}/training/${r.id}/edit`, "hx-target": "#training-modal-body", "hx-swap": "innerHTML", "hx-on::after-request": OPEN_MODAL }} />}
                  {canDelete && <RowAction icon="trash" label={t("common.delete")} class="btn-outline btn-error" attrs={{ "hx-post": `/members/${memberId}/training/${r.id}/delete`, "hx-confirm": t("training.confirmDelete"), "hx-target": "#training-box", "hx-swap": "outerHTML" }} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const OPEN_MODAL = "if(event.detail.successful){document.getElementById('training-modal').showModal()}";

// Detail-Abschnitt auf /members/:id (nur mit training:read einbinden).
export function TrainingSection({ memberId, rows, canWrite, canDelete }: { memberId: string; rows: Record_[]; canWrite: boolean; canDelete: boolean }) {
  return (
    <>
      <Section title={t("training.title")} badge={<span id="training-count">{rows.length}</span>} class="mt-6" actions={canWrite && (
        <button type="button" class="btn btn-outline btn-primary" aria-label={t("training.add")} title={t("training.add")} onclick="event.preventDefault();event.stopPropagation()" hx-get={`/members/${memberId}/training/new`} hx-target="#training-modal-body" hx-swap="innerHTML" {...{ "hx-on::after-request": OPEN_MODAL }}>
          <ActionContent icon="plus" label={t("training.add")} />
        </button>
      )}>
        <TrainingBox memberId={memberId} rows={rows} canWrite={canWrite} canDelete={canDelete} />
      </Section>
      <dialog id="training-modal" class="modal">
        <div class="modal-box max-w-xl" id="training-modal-body" />
        <form method="dialog" class="modal-backdrop"><button>{t("common.close")}</button></form>
      </dialog>
      <script dangerouslySetInnerHTML={{ __html: `
        document.body.addEventListener('htmx:beforeSwap', function (e) {
          var d = document.getElementById('training-modal');
          if (e.detail.xhr.status === ${UNPROCESSABLE} && d && d.contains(e.detail.requestConfig.elt)) {
            e.detail.shouldSwap = true; e.detail.isError = false;
            e.detail.target = document.getElementById('training-modal-body'); e.detail.swapOverride = 'innerHTML';
          }
        });
        document.body.addEventListener('training-modal', function () { document.getElementById('training-modal').close(); });
      ` }} />
    </>
  );
}

type FormValues = { title?: string; completedAt?: string | null; expiresAt?: string | null; organizer?: string | null; notes?: string | null };

function TrainingForm({ action, title, values = {}, error }: { action: string; title: string; values?: FormValues; error?: string }) {
  return (
    <form hx-post={action} hx-target="#training-box" hx-swap="outerHTML" class="space-y-4">
      <h3 class="font-bold text-lg">{title}</h3>
      {error && <div class="alert alert-error text-sm" role="alert">{error}</div>}
      <Field label={t("training.form.title")} required><input type="text" name="title" class="input w-full" required maxlength={TRAINING_TITLE_MAX} placeholder={t("training.form.title")} value={values.title ?? ""} /></Field>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t("training.form.completedAt")}><input type="date" name="completedAt" class="input w-full" value={values.completedAt ?? ""} /></Field>
        <Field label={t("training.form.expiresAt")}><input type="date" name="expiresAt" class="input w-full" value={values.expiresAt ?? ""} /></Field>
      </div>
      <Field label={t("training.form.organizer")}><input type="text" name="organizer" class="input w-full" placeholder={t("training.form.organizer")} value={values.organizer ?? ""} /></Field>
      <Field label={t("training.form.notes")}><textarea name="notes" rows={3} class="textarea w-full" placeholder={t("training.form.notes")}>{values.notes ?? ""}</textarea></Field>
      <div class="modal-action">
        <button type="button" class="btn" onclick="this.closest('dialog').close()"><ActionContent icon="x-mark" label={t("common.cancel")} variant="primary" /></button>
        <button type="submit" class="btn btn-primary"><ActionContent icon="check" label={t("common.save")} variant="primary" /></button>
      </div>
    </form>
  );
}

async function memberExists(id: string) {
  const [m] = await db.select({ id: members.id }).from(members).where(eq(members.id, id));
  return !!m;
}

async function findRecord(id: string, tid: string) {
  const [r] = await db.select().from(trainingRecords).where(and(eq(trainingRecords.id, tid), eq(trainingRecords.memberId, id)));
  return r;
}

// ── Mitglieds-Abschnitt ─────────────────────────────────────────────────────
trainingRoutes.get("/members/:id/training", read, async (c) => {
  const id = c.req.param("id");
  if (!(await memberExists(id))) return c.notFound();
  const p = c.get("user").permissions;
  return c.html(<TrainingBox memberId={id} rows={await loadRecords(id)} canWrite={p.has("training:write")} canDelete={p.has("training:delete")} />);
});

trainingRoutes.get("/members/:id/training/new", write, async (c) => {
  const id = c.req.param("id");
  if (!(await memberExists(id))) return c.notFound();
  return c.html(<TrainingForm action={`/members/${id}/training`} title={t("training.titleNew")} />);
});

trainingRoutes.get("/members/:id/training/:tid/edit", write, async (c) => {
  const id = c.req.param("id");
  const r = await findRecord(id, c.req.param("tid"));
  if (!r) return c.notFound();
  return c.html(<TrainingForm action={`/members/${id}/training/${r.id}`} title={t("training.titleEdit")} values={r} />);
});

async function save(c: import("hono").Context<{ Variables: Variables }>, tid?: string) {
  const id = c.req.param("id")!;
  if (!(await memberExists(id))) return c.notFound();
  if (tid && !(await findRecord(id, tid))) return c.notFound();
  const body = await c.req.parseBody();
  const parsed = parseTrainingInput(body, today());
  if ("error" in parsed) {
    c.status(UNPROCESSABLE);
    return c.html(<TrainingForm action={tid ? `/members/${id}/training/${tid}` : `/members/${id}/training`} title={tid ? t("training.titleEdit") : t("training.titleNew")}
      values={{ title: String(body.title ?? ""), completedAt: String(body.completedAt ?? ""), expiresAt: String(body.expiresAt ?? ""), organizer: String(body.organizer ?? ""), notes: String(body.notes ?? "") }}
      error={t(`training.error.${parsed.error}`)} />);
  }
  if (tid) await db.update(trainingRecords).set(parsed.value).where(eq(trainingRecords.id, tid));
  else await db.insert(trainingRecords).values({ ...parsed.value, memberId: id });
  c.header("HX-Trigger", JSON.stringify({ "training-modal": "close" }));
  return c.html(await boxWithCount(c, id));
}

// Box neu laden + Badge im Section-Titel per OOB-Swap aktualisieren (liegt außerhalb von #training-box).
async function boxWithCount(c: import("hono").Context<{ Variables: Variables }>, id: string) {
  const p = c.get("user").permissions;
  const rows = await loadRecords(id);
  return (
    <>
      <TrainingBox memberId={id} rows={rows} canWrite={p.has("training:write")} canDelete={p.has("training:delete")} />
      <span id="training-count" hx-swap-oob="true">{rows.length}</span>
    </>
  );
}

trainingRoutes.post("/members/:id/training", write, (c) => save(c));
trainingRoutes.post("/members/:id/training/:tid", write, (c) => save(c, c.req.param("tid")));

trainingRoutes.post("/members/:id/training/:tid/delete", del, async (c) => {
  const id = c.req.param("id");
  const tid = c.req.param("tid");
  if (!(await findRecord(id, tid))) return c.notFound();
  await db.delete(trainingRecords).where(eq(trainingRecords.id, tid));
  return c.html(await boxWithCount(c, id));
});

// ── Gesamtübersicht ─────────────────────────────────────────────────────────
const LIST_STATUSES = ["expired", "soon", "valid", "noExpiry"] as const;

trainingRoutes.get("/training", read, async (c) => {
  const user = c.get("user");
  const q = c.req.query();
  const memberQ = (q.member ?? "").trim().toLowerCase();
  const titleQ = (q.title ?? "").trim().toLowerCase();
  const statusFilter = (c.req.queries("status") ?? []).filter((s): s is (typeof LIST_STATUSES)[number] => (LIST_STATUSES as readonly string[]).includes(s));
  const withFormer = q.former === "1";
  const { page, pageSize } = parsePagination(q);
  const now = today();

  const all = await db
    .select({ r: trainingRecords, firstName: persons.firstName, lastName: persons.lastName, exitDate: members.exitDate })
    .from(trainingRecords)
    .innerJoin(members, eq(members.id, trainingRecords.memberId))
    .innerJoin(persons, eq(persons.id, members.personId))
    .orderBy(asc(persons.lastName), asc(persons.firstName));
  const status = trainingStatuses(all.map((x) => x.r), now);
  const rows = all
    .filter((x) => withFormer || !x.exitDate || x.exitDate > now)
    .filter((x) => !memberQ || `${x.firstName} ${x.lastName}`.toLowerCase().includes(memberQ))
    .filter((x) => !titleQ || x.r.title.toLowerCase().includes(titleQ))
    .filter((x) => statusFilter.length === 0 || (statusFilter as TrainingStatus[]).includes(status.get(x.r.id)!))
    // NULL zuletzt; stabile Sortierung behält die Namensreihenfolge der Abfrage.
    .sort((a, b) => (a.r.expiresAt ?? "9999").localeCompare(b.r.expiresAt ?? "9999"));
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const items = rows.slice((page - 1) * pageSize, page * pageSize);
  const cur = { member: q.member, title: q.title, status: statusFilter, former: withFormer ? "1" : "", pageSize };
  const pageUrl = (p: number) => buildListUrl("/training", cur, { page: p });

  return c.html(
    <Layout title={t("training.pageTitle")} user={user}>
      <PageHeader title={t("training.pageTitle")} />
      <form method="get" action="/training" class="filter-bar mb-4 flex flex-wrap items-end gap-x-4 gap-y-2">
        <input type="search" name="member" class="input" placeholder={t("training.filter.member")} value={q.member ?? ""} />
        <input type="search" name="title" class="input" placeholder={t("training.filter.title")} value={q.title ?? ""} />
        <MultiSelectFilter
          param="status"
          autoApply
          options={LIST_STATUSES.map((s) => ({ value: s, label: t(`training.status.${s}`) }))}
          selected={statusFilter}
          allLabel={t("training.filter.statusAll")}
          countLabel={(count) => t("training.filter.statusCount", { count })}
          applyLabel={t("common.apply")}
          resetLabel={t("common.reset")}
        />
        <label class="flex items-center gap-2 min-h-11 cursor-pointer">
          <input type="checkbox" name="former" value="1" class="toggle toggle-primary" checked={withFormer} onchange="this.form.submit()" />
          <span class="text-sm">{t("training.filter.former")}</span>
        </label>
        <button type="submit" class="btn btn-outline">{t("training.filter.apply")}</button>
      </form>
      <div class="overflow-x-auto">
        <table class="table table-zebra w-full">
          <thead><tr><th>{t("training.col.member")}</th><th>{t("training.form.title")}</th><th>{t("training.form.completedAt")}</th><th>{t("training.form.expiresAt")}</th><th>{t("training.form.organizer")}</th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colspan={5} class="text-center opacity-50 py-4">{t("training.empty")}</td></tr>}
            {items.map((x) => (
              <tr key={x.r.id}>
                <td><a class="link link-hover" href={`/members/${x.r.memberId}`}>{x.lastName}, {x.firstName}</a></td>
                <td>{x.r.title} <StatusBadge s={status.get(x.r.id)} /></td>
                <td>{x.r.completedAt ? formatDate(x.r.completedAt) : "–"}</td>
                <td>{x.r.expiresAt ? formatDate(x.r.expiresAt) : "–"}</td>
                <td>{x.r.organizer}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager countLabel={t("training.count", { count: rows.length })} page={page} totalPages={totalPages} pageUrl={pageUrl} pageSize={pageSize} pageSizeOptions={PAGE_SIZE_OPTIONS} />
    </Layout>,
  );
});
