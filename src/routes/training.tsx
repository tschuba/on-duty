import { Hono, type Context } from "hono";
import { and, asc, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { members, persons, trainingRecords } from "../db/schema/index.js";
import { requireAuth, type AuthedUser, type Variables } from "../middleware/auth.js";
import { EntityPicker, PickerOptions } from "../components/entity-picker.js";
import { HTTP_STATUS } from "../lib/constants.js";
import { Layout } from "../components/layout.js";
import { Section } from "../components/section.js";
import { Field } from "../components/field.js";
import { RowAction } from "../components/row-action.js";
import { ActionContent, FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { Pager } from "../components/pager.js";
import { FilterDialog, navFilterLabels } from "../components/filter-dialog.js";
import { PageSearch } from "../components/page-search.js";
import { formatDate } from "../lib/format.js";
import { resolveTimezone, toLocalDate } from "../lib/datetime.js";
import { buildListUrl, PAGE_SIZE_OPTIONS, parsePagination } from "../lib/list-query.js";
import { TRAINING_TITLE_MAX, parseTrainingInput, trainingStatuses, sortTrainings, parseTrainingSort, nextTrainingDir, defaultTrainingDir, type SortDir, type TrainingSortKey, type TrainingStatus } from "../lib/training.js";
import { t } from "../i18n/index.js";
import { SortIcon, memberViews } from "./members.js";
import { TitleSwitch } from "../components/title-switch.js";

export const trainingRoutes = new Hono<{ Variables: Variables }>();
const read = requireAuth("training:read");
const write = requireAuth("training:write");
const del = requireAuth("training:delete");

type Record_ = typeof trainingRecords.$inferSelect;
const today = () => toLocalDate(new Date(), resolveTimezone());

function StatusBadge({ s }: { s: TrainingStatus | undefined }) {
  if (s === "expired") return <span class="badge badge-sm badge-error">{t("training.status.expired")}</span>;
  if (s === "soon") return <span class="badge badge-sm badge-warning">{t("training.status.soon")}</span>;
  return null;
}

const recFields = (r: Record_) => ({ member: null, title: r.title, completedAt: r.completedAt, expiresAt: r.expiresAt, organizer: r.organizer });
export const sortRecords = (rows: Record_[], sort?: TrainingSortKey, dir?: SortDir) => sortTrainings(rows, recFields, sort, dir);

async function loadRecords(memberId: string, sort?: TrainingSortKey, dir?: SortDir) {
  return sortRecords(await db.select().from(trainingRecords).where(eq(trainingRecords.memberId, memberId)), sort, dir);
}

const parseDir = (v?: string): SortDir | undefined => (v === "asc" || v === "desc" ? v : undefined);

export function TrainingBox({ memberId, rows, canWrite, canDelete, sort, dir }: { memberId: string; rows: Record_[]; canWrite: boolean; canDelete: boolean; sort?: TrainingSortKey; dir?: SortDir }) {
  const d = dir ?? (sort ? defaultTrainingDir(sort) : "desc");
  const th = (col: TrainingSortKey, label: string) => (
    <th><a href="#" class="link link-hover" hx-get={`/members/${memberId}/training?sort=${col}&dir=${nextTrainingDir(col, sort, d)}`} hx-target="#training-box" hx-swap="outerHTML">{label} <SortIcon col={col} active={sort ?? "expiresAt"} dir={sort ? d : "desc"} /></a></th>
  );
  const status = trainingStatuses(rows, today());
  return (
    <div id="training-box">
      <div class="overflow-x-auto">
        <table class="table table-cards w-full">
          <thead><tr>{th("title", t("training.form.title"))}{th("completedAt", t("training.form.completedAt"))}{th("expiresAt", t("training.form.expiresAt"))}{th("organizer", t("training.form.organizer"))}<th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colspan={5} class="text-center opacity-50 py-4">{t("training.empty")}</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} class="cursor-pointer hover" onclick={`window.location='/training/${r.id}'`}>
                <td>{r.title} <StatusBadge s={status.get(r.id)} /></td>
                <td data-label={t("training.form.completedAt")}>{r.completedAt ? formatDate(r.completedAt) : "–"}</td>
                <td data-label={t("training.form.expiresAt")}>{r.expiresAt ? formatDate(r.expiresAt) : "–"}</td>
                <td data-label={t("training.form.organizer")} data-empty={!r.organizer || undefined}>{r.organizer}</td>
                <td class="text-right whitespace-nowrap">
                  {canDelete && <RowAction icon="icon-[tabler--trash]" label={t("common.delete")} class="btn-outline btn-error" onclick="event.stopPropagation()" attrs={{ "hx-post": `/members/${memberId}/training/${r.id}/delete`, "hx-confirm": t("training.confirmDelete"), "hx-target": "#training-box", "hx-swap": "outerHTML" }} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Detail-Abschnitt auf /members/:id (nur mit training:read einbinden).
export function TrainingSection({ memberId, rows, canWrite, canDelete }: { memberId: string; rows: Record_[]; canWrite: boolean; canDelete: boolean }) {
  return (
    <>
      <Section title={t("training.title")} badge={<span id="training-count">{rows.length}</span>} class="mt-6" actions={canWrite && (
        <a class="btn btn-outline btn-primary" aria-label={t("training.add")} title={t("training.add")} onclick="event.stopPropagation()" href={`/training/new?memberId=${memberId}`}>
          <ActionContent icon="icon-[tabler--plus]" label={t("training.add")} />
        </a>
      )}>
        <TrainingBox memberId={memberId} rows={rows} canWrite={canWrite} canDelete={canDelete} />
      </Section>
    </>
  );
}

type FormValues = { title?: string; completedAt?: string | null; expiresAt?: string | null; organizer?: string | null; notes?: string | null };

function TrainingFields({ values = {} }: { values?: FormValues }) {
  return (
    <>
      <Field label={t("training.form.title")} required><input type="text" name="title" class="input w-full" required maxlength={TRAINING_TITLE_MAX} placeholder={t("training.form.title")} value={values.title ?? ""} /></Field>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t("training.form.completedAt")}><input type="date" name="completedAt" class="input w-full" value={values.completedAt ?? ""} /></Field>
        <Field label={t("training.form.expiresAt")}><input type="date" name="expiresAt" class="input w-full" value={values.expiresAt ?? ""} /></Field>
      </div>
      <Field label={t("training.form.organizer")}><input type="text" name="organizer" class="input w-full" placeholder={t("training.form.organizer")} value={values.organizer ?? ""} /></Field>
      <Field label={t("training.form.notes")}><textarea name="notes" rows={3} class="textarea w-full" placeholder={t("training.form.notes")}>{values.notes ?? ""}</textarea></Field>
    </>
  );
}

// Anlegen und Bearbeiten auf eigener Seite. `picker`: Anlegen mit Mitgliederauswahl (`fromMember`: vorbelegt aus der Detailseite, bestimmt das Rücksprungziel).
function TrainingPage({ user, title, action, back, values, error, picker }: { user: AuthedUser; title: string; action: string; back: string; values?: FormValues; error?: string; picker?: { member?: { id: string; name: string }; fromMember?: boolean } }) {
  return (
    <Layout title={title} user={user}>
      <div class="max-w-2xl mx-auto">
        <PageHeader title={title} backHref={back.startsWith("/training/") ? LIST_URL : back} actions={<FormActions formId="training-form" cancelHref={back} />} />
        <form id="training-form" method="post" action={action} class="space-y-4">
          {error && <div class="alert alert-error text-sm" role="alert">{error}</div>}
          {picker && (
            <>
              {picker.fromMember && <input type="hidden" name="fromMember" value="1" />}
              <EntityPicker id="training-memberId" name="memberId" searchUrl="/training/search-members" selectedId={picker.member?.id} selectedName={picker.member?.name} placeholder={t("training.form.member")} required />
            </>
          )}
          <TrainingFields values={values} />
        </form>
      </div>
    </Layout>
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
  const sort = parseTrainingSort(c.req.query("sort"));
  return c.html(<TrainingBox memberId={id} rows={await loadRecords(id, sort, parseDir(c.req.query("dir")))} sort={sort} dir={parseDir(c.req.query("dir"))} canWrite={p.has("training:write")} canDelete={p.has("training:delete")} />);
});

// `?from=training` (von der Detailseite): Rücksprung dorthin statt zum Mitglied.
function editTarget(c: import("hono").Context<{ Variables: Variables }>, id: string, tid: string) {
  const fromTraining = c.req.query("from") === "training";
  return { action: `/members/${id}/training/${tid}${fromTraining ? "?from=training" : ""}`, back: fromTraining ? `/training/${tid}` : `/members/${id}` };
}

trainingRoutes.get("/members/:id/training/:tid/edit", write, async (c) => {
  const id = c.req.param("id");
  const r = await findRecord(id, c.req.param("tid"));
  if (!r) return c.notFound();
  const { action, back } = editTarget(c, id, r.id);
  return c.html(<TrainingPage user={c.get("user")} title={t("training.titleEdit")} action={action} back={back} values={r} />);
});

const LIST_URL = "/members?view=training";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function memberName(id: string) {
  const [m] = UUID.test(id) ? await db.select({ f: persons.firstName, l: persons.lastName }).from(members).innerJoin(persons, eq(persons.id, members.personId)).where(eq(members.id, id)) : [];
  return m ? `${m.f} ${m.l}` : undefined;
}

const formValues = (body: Record<string, unknown>): FormValues => ({ title: String(body.title ?? ""), completedAt: String(body.completedAt ?? ""), expiresAt: String(body.expiresAt ?? ""), organizer: String(body.organizer ?? ""), notes: String(body.notes ?? "") });

// Bearbeiten (eigene Seite).
async function save(c: import("hono").Context<{ Variables: Variables }>, tid: string) {
  const id = c.req.param("id")!;
  if (!(await findRecord(id, tid))) return c.notFound();
  const body = await c.req.parseBody();
  const parsed = parseTrainingInput(body, today());
  if (!("value" in parsed)) {
    c.status(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    const { action, back } = editTarget(c, id, tid);
    return c.html(<TrainingPage user={c.get("user")} title={t("training.titleEdit")} action={action} back={back} values={formValues(body)} error={t(`training.error.${parsed.error}`)} />);
  }
  await db.update(trainingRecords).set(parsed.value).where(eq(trainingRecords.id, tid));
  return c.redirect(editTarget(c, id, tid).back);
}

// Anlegen (eigene Seite): Mitglied kommt aus dem Formular.
trainingRoutes.get("/training/new", write, async (c) => {
  const id = c.req.query("memberId") ?? "";
  const name = await memberName(id);
  return c.html(<TrainingPage user={c.get("user")} title={t("training.titleNew")} action="/training" back={name ? `/members/${id}` : LIST_URL} picker={{ member: name ? { id, name } : undefined, fromMember: !!name }} />);
});

trainingRoutes.post("/training", write, async (c) => {
  const body = await c.req.parseBody();
  const id = String(body.memberId ?? "");
  const fromMember = body.fromMember === "1";
  const name = await memberName(id);
  const parsed = parseTrainingInput(body, today());
  const error = !name ? "member" : "error" in parsed ? parsed.error : undefined;
  if (error || !("value" in parsed)) {
    c.status(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    return c.html(<TrainingPage user={c.get("user")} title={t("training.titleNew")} action="/training" back={fromMember && name ? `/members/${id}` : LIST_URL} values={formValues(body)} error={t(`training.error.${error ?? "title"}`)} picker={{ member: name ? { id, name } : undefined, fromMember }} />);
  }
  await db.insert(trainingRecords).values({ ...parsed.value, memberId: id });
  return c.redirect(fromMember ? `/members/${id}` : LIST_URL);
});

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

// Mitgliederauswahl für die Anlegen-Seite (nur aktive Mitglieder).
trainingRoutes.get("/training/search-members", write, async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.html("");
  const needle = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db.select({ id: members.id, firstName: persons.firstName, lastName: persons.lastName }).from(members)
    .innerJoin(persons, eq(persons.id, members.personId))
    .where(and(or(ilike(persons.firstName, needle), ilike(persons.lastName, needle)), isNull(members.exitDate), isNull(members.deathDate)))
    .orderBy(asc(persons.lastName), asc(persons.firstName)).limit(10);
  return c.html(<PickerOptions empty={t("picker.noResults", { query: q })} options={rows.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}` }))} />);
});
// Detailseite (nur lesen).
trainingRoutes.get("/training/:id", read, async (c) => {
  const tid = c.req.param("id");
  const [x] = UUID.test(tid) ? await db.select({ r: trainingRecords, firstName: persons.firstName, lastName: persons.lastName }).from(trainingRecords)
    .innerJoin(members, eq(members.id, trainingRecords.memberId)).innerJoin(persons, eq(persons.id, members.personId)).where(eq(trainingRecords.id, tid)) : [];
  if (!x) return c.notFound();
  const status = trainingStatuses([x.r], today()).get(x.r.id);
  const rows: [string, unknown][] = [
    [t("training.col.member"), <a class="link link-hover" href={`/members/${x.r.memberId}`}>{x.lastName}, {x.firstName}</a>],
    [t("training.form.title"), <>{x.r.title} <StatusBadge s={status} /></>],
    [t("training.form.completedAt"), x.r.completedAt ? formatDate(x.r.completedAt) : "–"],
    [t("training.form.expiresAt"), x.r.expiresAt ? formatDate(x.r.expiresAt) : "–"],
    [t("training.form.organizer"), x.r.organizer || "–"],
    [t("training.form.notes"), x.r.notes ? <span class="whitespace-pre-line">{x.r.notes}</span> : "–"],
  ];
  return c.html(
    <Layout title={x.r.title} user={c.get("user")}>
      <div class="max-w-2xl mx-auto">
        <PageHeader title={t("training.titleView")} backHref={LIST_URL} actions={c.get("user").permissions.has("training:write") && (
          <HeaderAction variant="primary" icon="icon-[tabler--pencil]" label={t("common.edit")} href={`/members/${x.r.memberId}/training/${x.r.id}/edit?from=training`} class="btn-primary" />
        )} />
        <dl class="space-y-4">
          {rows.map(([k, v]) => <div><dt class="text-sm opacity-60">{k}</dt><dd>{v as never}</dd></div>)}
        </dl>
      </div>
    </Layout>,
  );
});

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

// Alte Links (/training?…) bleiben gültig.
trainingRoutes.get("/training", read, (c) => {
  const u = new URL(c.req.url);
  u.searchParams.set("view", "training");
  return c.redirect(`/members${u.search}`);
});

type ListRow = { r: Record_; firstName: string; lastName: string };
function TrainingRow({ x, status, showMember, showTitle = true }: { x: ListRow; status: Map<string, TrainingStatus>; showMember: boolean; showTitle?: boolean }) {
  return (
    <tr class={`cursor-pointer hover ${status.get(x.r.id) === "replaced" ? "opacity-50" : ""}`} onclick={`window.location='/training/${x.r.id}'`}>
      {showMember && <td class="max-md:font-semibold"><a class="link link-hover" onclick="event.stopPropagation()" href={`/members/${x.r.memberId}`}>{x.lastName}, {x.firstName}</a>{!showTitle && <> <StatusBadge s={status.get(x.r.id)} /></>}</td>}
      {showTitle && <td>{x.r.title} <StatusBadge s={status.get(x.r.id)} /></td>}
      <td data-label={t("training.form.completedAt")} data-empty={!x.r.completedAt || undefined}>{x.r.completedAt ? formatDate(x.r.completedAt) : "–"}</td>
      <td data-label={t("training.form.expiresAt")} data-empty={!x.r.expiresAt || undefined}>{x.r.expiresAt ? formatDate(x.r.expiresAt) : "–"}</td>
      <td data-label={t("training.form.organizer")}>{x.r.organizer}</td>
    </tr>
  );
}

const headCols = [["member", "training.col.member"], ["title", "training.form.title"], ["completedAt", "training.form.completedAt"], ["expiresAt", "training.form.expiresAt"], ["organizer", "training.form.organizer"]] as const;

export async function renderTraining(c: Context<{ Variables: Variables }>) {
  const user = c.get("user")!;
  const q = c.req.query();
  const search = (q.q ?? "").trim().toLowerCase();
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
    .filter((x) => !search || `${x.firstName} ${x.lastName}`.toLowerCase().includes(search) || x.r.title.toLowerCase().includes(search))
    .filter((x) => statusFilter.length === 0 || (statusFilter as TrainingStatus[]).includes(status.get(x.r.id)!))
    ;
  const sort = parseTrainingSort(q.sort);
  const dir = parseDir(q.dir) ?? (sort ? defaultTrainingDir(sort) : "desc");
  const sorted = sortTrainings(rows, (x) => ({ ...recFields(x.r), member: `${x.lastName}, ${x.firstName}` }), sort, dir);
  const group = q.group === "member" || q.group === "title" ? q.group : undefined;
  const grouped = !!group;
  const byTitle = group === "title";
  // Gruppiert wird nach Mitglied bzw. Ausbildung (Titel, ohne Groß-/Kleinschreibung) paginiert, damit keine Gruppe über Seiten zerreißt.
  const keyOf = (x: (typeof sorted)[number]) => (byTitle ? x.r.title.trim().toLowerCase() : x.r.memberId);
  const labelOf = (g: typeof sorted) => (byTitle ? g[0].r.title : `${g[0].lastName}, ${g[0].firstName}`);
  const groups = grouped
    ? [...sorted.reduce((m, x) => m.set(keyOf(x), [...(m.get(keyOf(x)) ?? []), x]), new Map<string, typeof sorted>()).values()].sort((a, b) => labelOf(a).localeCompare(labelOf(b), "de"))
    : [];
  const unit = grouped ? groups.length : sorted.length;
  const totalPages = Math.max(1, Math.ceil(unit / pageSize));
  const slice = <T,>(l: T[]) => l.slice((page - 1) * pageSize, page * pageSize);
  const items = grouped ? [] : slice(sorted);
  const pageGroups = grouped ? slice(groups) : [];
  const cur = { view: "training", group, q: q.q, status: statusFilter, former: withFormer ? "1" : "", pageSize, sort, dir: sort ? dir : undefined };
  const pageUrl = (p: number) => buildListUrl("/members", cur, { page: p });

  return c.html(
    <Layout title={t("training.pageTitle")} user={user}>
      <PageHeader title={<TitleSwitch items={memberViews(user.permissions as Set<string>, "training")} />} actions={<>
        <div class="join">
          <HeaderAction icon="icon-[tabler--users]" label={t("training.filter.grouped")} href={buildListUrl("/members", cur, { group: group === "member" ? undefined : "member", page: 1 })} class={`join-item ${group === "member" ? "btn-neutral" : "btn-outline"}`} hideLabel="@max-[1090px]:hidden" />
          <HeaderAction icon="icon-[tabler--certificate]" label={t("training.filter.groupedTitle")} href={buildListUrl("/members", cur, { group: byTitle ? undefined : "title", page: 1 })} class={`join-item ${byTitle ? "btn-neutral" : "btn-outline"}`} hideLabel="@max-[1090px]:hidden" />
        </div>
        {user.permissions.has("training:write") && <HeaderAction variant="primary" icon="icon-[tabler--plus]" label={t("training.add")} href="/training/new" class="btn-primary" />}
      </>} />
      <PageSearch name="q" action="/members" label={t("training.pageTitle")} value={q.q ?? ""}
        hidden={[["view", "training"], ...(group ? [["group", group] as [string, string]] : []), ...statusFilter.map((v): [string, string] => ["status", v]), ...(withFormer ? [["former", "1"] as [string, string]] : [])]} />
      <FilterDialog navbar id="training-filter-dialog" resetHref={buildListUrl("/members", { view: "training", group })} labels={navFilterLabels()}
        hidden={[["view", "training"], ...(group ? [["group", group] as [string, string]] : []), ...(q.q ? [["q", q.q] as [string, string]] : [])]}
        sections={[
          { type: "chips", param: "status", title: t("training.filter.statusAll"), options: LIST_STATUSES.map((s) => ({ value: s, label: t(`training.status.${s}`) })), selected: statusFilter },
          { type: "toggle", param: "former", title: t("training.filter.former"), selected: withFormer ? ["1"] : [] },
        ]} />
      <div id="training-results" class="flex flex-1 flex-col">
      {grouped ? (
        <div class="flex flex-col gap-4">
          {unit === 0 && <p class="text-center opacity-50 py-4">{t("training.empty")}</p>}
          {pageGroups.map((g, i) => {
            const counts = (["expired", "soon"] as const).map((k) => [k, g.filter((x) => status.get(x.r.id) === k).length] as const).filter(([, n]) => n > 0);
            const accent = counts[0]?.[0] === "expired" ? "border-l-4 border-l-error" : "";
            return (
              <section class={`group-card rounded-box border border-base-300 ${accent} bg-base-100 overflow-hidden`}>
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 bg-base-200/60">
                  {byTitle ? (<>
                    <div class="avatar avatar-placeholder"><div class="bg-primary text-primary-content w-9 rounded-full"><span class="icon-[tabler--certificate] size-5" aria-hidden="true" /></div></div>
                    <span class="font-bold">{g[0].r.title}</span>
                  </>) : (<>
                    <div class="avatar avatar-placeholder"><div class="bg-primary text-primary-content w-9 rounded-full text-sm font-semibold">{g[0].firstName[0]}{g[0].lastName[0]}</div></div>
                    <a class="link link-hover" href={`/members/${g[0].r.memberId}`}><span class="font-bold">{g[0].lastName}</span>, {g[0].firstName}</a>
                  </>)}
                  <span class="badge badge-sm badge-ghost">{g.length}</span>
                  <span class="ml-auto flex flex-wrap gap-1">
                    {counts.length === 0 && <span class="badge badge-sm badge-success badge-soft">{t("training.status.valid")}</span>}
                    {counts.map(([k, n]) => <span class={`badge badge-sm ${k === "expired" ? "badge-error" : "badge-warning"}`}>{n} {t(`training.status.${k}`)}</span>)}
                  </span>
                </div>
                <div class="overflow-x-auto">
                  <table class="table table-cards table-fixed w-full">
                    {i === 0 && <thead><tr>{headCols.filter(([col]) => col !== (byTitle ? "title" : "member")).map(([col, key], n) => (
                      <th class={n === 0 ? "w-2/5" : "w-1/5"}><a href={buildListUrl("/members", cur, { sort: col, dir: nextTrainingDir(col, sort, dir), page: 1 })} class="link link-hover">{t(key)} <SortIcon col={col} active={sort ?? "expiresAt"} dir={sort ? dir : "desc"} /></a></th>
                    ))}</tr></thead>}
                    <tbody>{g.map((x) => <TrainingRow x={x} status={status} showMember={byTitle} showTitle={!byTitle} />)}</tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
      <div class="overflow-x-auto">
        <table class="table table-cards table-zebra w-full">
          <thead><tr>{headCols.map(([col, key]) => (
            <th><a href={buildListUrl("/members", cur, { sort: col, dir: nextTrainingDir(col, sort, dir), page: 1 })} class="link link-hover">{t(key)} <SortIcon col={col} active={sort ?? "expiresAt"} dir={sort ? dir : "desc"} /></a></th>
          ))}</tr></thead>
          <tbody>
            {unit === 0 && <tr><td colspan={5} class="text-center opacity-50 py-4">{t("training.empty")}</td></tr>}
            {items.map((x) => <TrainingRow x={x} status={status} showMember />)}
          </tbody>
        </table>
      </div>
      )}
      <Pager countLabel={t(byTitle ? "training.countGroupedTitle" : grouped ? "training.countGrouped" : "training.count", { count: unit })} page={page} totalPages={totalPages} pageUrl={pageUrl} pageSize={pageSize} pageSizeOptions={PAGE_SIZE_OPTIONS} />
      </div>
    </Layout>,
  );
}
