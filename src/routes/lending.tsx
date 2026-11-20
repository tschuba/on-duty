import { Hono, type Context } from "hono";
import { and, asc, eq, exists, ilike, isNull, or, sql } from "drizzle-orm";
import { EmailField, Field, PhoneField, ViewField, ViewGrid } from "../components/field.js";
import { db } from "../db/index.js";
import { inventoryItems, inventoryItemNumbers, inventoryItemTags, lendingItems, lendingLoans, loanRequests, members, persons } from "../db/schema/index.js";
import { DeleteDialog } from "../components/delete-dialog.js";
import { Icon } from "../components/icon.js";
import { EntityPicker, PickerOptions } from "../components/entity-picker.js";
import { DetailActions, FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { QuickRangeFilter } from "../components/quick-range-filter.js";
import { parseRange, rangeParams, rangePresets, todayStr } from "../lib/quick-range.js";
import { MemberMark, MemberLink } from "../components/member-mark.js";
import { FilterDialog } from "../components/filter-dialog.js";
import { buildListUrl, parseMulti } from "../lib/list-query.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { formatDate } from "../lib/format.js";
import { trimmed } from "../lib/forms.js";
import { getSettings } from "../lib/settings.js";
import { StatCard, StatGrid } from "../components/stat-card.js";
import { checkAvailability as checkSharedAvailability, cleanupRejectedLoanRequests, effectiveRange, rangesOverlap, loanStatus, validateLoanDates, type LoanRange, type LoanStatus } from "../lib/lending.js";

export const lendingRoutes = new Hono<{ Variables: Variables }>();

// ── Types ────────────────────────────────────────────────────────────────────

type InventoryItemRow = typeof inventoryItems.$inferSelect;
type LendingItemRow = typeof lendingItems.$inferSelect;
type LoanRow = typeof lendingLoans.$inferSelect;
type Tag = typeof inventoryItemTags.$inferSelect;
type Person = typeof persons.$inferSelect & { member: { id: string } | null };
type LendingItemWithRelations = LendingItemRow & {
  inventoryItem: InventoryItemRow & { tags: Tag[] };
};
type LoanWithBorrower = LoanRow & { borrower: Person };

// ── Data access ──────────────────────────────────────────────────────────────

async function fetchLendingItems(): Promise<LendingItemWithRelations[]> {
  return db.query.lendingItems.findMany({
    with: { inventoryItem: { with: { tags: true } } },
  }) as unknown as Promise<LendingItemWithRelations[]>;
}

async function fetchLendingItem(id: string): Promise<LendingItemWithRelations | undefined> {
  return db.query.lendingItems.findFirst({
    where: eq(lendingItems.id, id),
    with: { inventoryItem: { with: { tags: true } } },
  }) as unknown as Promise<LendingItemWithRelations | undefined>;
}

async function fetchLoans(lendingItemId: string): Promise<LoanWithBorrower[]> {
  return db.query.lendingLoans.findMany({
    where: eq(lendingLoans.lendingItemId, lendingItemId),
    with: { borrower: { with: { member: true } } },
  }) as unknown as Promise<LoanWithBorrower[]>;
}

async function fetchLoan(id: string): Promise<LoanWithBorrower | undefined> {
  return db.query.lendingLoans.findFirst({
    where: eq(lendingLoans.id, id),
    with: { borrower: { with: { member: true } } },
  }) as unknown as Promise<LoanWithBorrower | undefined>;
}

// ── Vorgangsliste (GET /inventory/lending) ──────────────────────────────────
// Zeitlich gruppierte Sicht quer über alle Items (analog routes/anniversaries.tsx).
// Gegenstände werden unter /inventory verwaltet, hier nur Vorgänge.

const LOAN_STATUS_BADGE: Record<LoanStatus, string> = {
  planned: "badge badge-ghost badge-sm",
  active: "badge badge-info badge-sm",
  overdue: "badge badge-error badge-sm",
  returned: "badge badge-success badge-sm",
};
const LOAN_STATUS_LABEL: Record<LoanStatus, string> = {
  planned: t("lending.overview.status.planned"),
  active: t("lending.overview.status.active"),
  overdue: t("lending.overview.status.overdue"),
  returned: t("lending.overview.status.returned"),
};

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

async function fetchAllLoans(): Promise<(LoanWithBorrower & { lendingItem: LendingItemWithRelations })[]> {
  return db.query.lendingLoans.findMany({
    with: {
      borrower: { with: { member: true } },
      lendingItem: { with: { inventoryItem: { with: { tags: true } } } },
    },
  }) as unknown as Promise<(LoanWithBorrower & { lendingItem: LendingItemWithRelations })[]>;
}

function formatMonth(yyyymm: string): string {
  if (!yyyymm) return "—";
  const [y, m] = yyyymm.split("-");
  const names = ["month.january", "month.february", "month.march", "month.april", "month.may", "month.june",
    "month.july", "month.august", "month.september", "month.october", "month.november", "month.december"] as const;
  return `${t(names[parseInt(m, 10) - 1])} ${y}`;
}

// E-Mail und Telefon sind getrennte Felder in persons und werden direkt verlinkt.
function BorrowerContact({ person, inline }: { person: { email: string | null; phone: string | null }; inline?: boolean }) {
  if (!person.email && !person.phone) return null;
  const links = (
    <>
      {person.email && <a href={`mailto:${person.email}`} class="link link-hover" onclick="event.stopPropagation()">{person.email}</a>}
      {person.email && person.phone && " · "}
      {person.phone && <a href={`tel:${person.phone.replace(/[^\d+]/g, "")}`} class="link link-hover" onclick="event.stopPropagation()">{person.phone}</a>}
    </>
  );
  return inline ? links : <div class="text-sm opacity-60">{links}</div>;
}

// Name, Organisation oder "Name (Organisation)"; reine Organisation bleibt lesbar.
function personName(p: { firstName: string; lastName: string; companyName?: string | null }): string {
  const name = `${p.firstName} ${p.lastName}`.trim();
  if (!p.companyName) return name;
  return name ? `${name} (${p.companyName})` : p.companyName;
}

function borrowerLabel(l: LoanWithBorrower): string {
  return personName(l.borrower) || "—";
}

// Kennzahlen über alle Vorgänge (nicht über die gefilterte Liste). Die Karten überschneiden sich:
// „Überfällig“ und „Heute fällig“ sind meist auch „Verliehen“.
function LendingStats({ loans, today, openRequests, requestsHref }: { loans: LoanRange[]; today: string; openRequests: number | null; requestsHref: string }) {
  const open = loans.filter((l) => !l.returnedAt);
  const overdue = loans.filter((l) => loanStatus(l, today) === "overdue").length;
  // Leere start/end heben das Standardfenster auf, sonst weicht die Liste von der Kartenzahl ab.
  const statusHref = (st: LoanStatus) => `/inventory/lending?status=${st}&start=&end=`;
  return (
    <StatGrid id="lending-stats" cols={openRequests === null ? 4 : 5}>
        <StatCard label={t("lending.stats.overdue")} value={overdue} tone={overdue > 0 ? "text-error" : undefined} href={statusHref("overdue")} link="filter" />
        {openRequests !== null && <StatCard label={t("lending.stats.requests")} value={openRequests} tone={openRequests > 0 ? "text-primary" : undefined} href={requestsHref} link="filter" />}
        <StatCard label={t("lending.stats.out")} value={open.filter((l) => l.pickedUpAt).length} tone="text-info" />
        <StatCard label={t("lending.stats.dueToday")} value={open.filter((l) => l.plannedTo === today).length} />
        <StatCard label={t("lending.stats.planned")} value={loans.filter((l) => loanStatus(l, today) === "planned").length} href={statusHref("planned")} link="filter" />
      </StatGrid>
  );
}

// Zeile der Zeitleiste: Vorgang oder Anfrage (offen/abgelehnt). Genehmigte Anfragen stehen nur als Vorgang da.
type RowState = LoanStatus | "requested" | "rejected";
type Row = {
  id: string; kind: "loan" | "request"; href: string; state: RowState;
  lendingItem: LendingItemWithRelations; person: Person; quantity: number;
  plannedFrom: string | null; plannedTo: string | null;
  sortDate: string; monthDate: string; submittedAt: number;
  conflict: boolean; range: { from: string; to: string } | null;
};
type RequestRow = typeof loanRequests.$inferSelect & { lendingItem: LendingItemWithRelations; person: Person };

const ROW_STATE_LABEL: Record<RowState, string> = {
  ...LOAN_STATUS_LABEL,
  requested: t("lending.overview.status.requested"),
  rejected: t("lending.overview.status.rejected"),
};
const ROW_STATE_BADGE: Record<RowState, string> = {
  ...LOAN_STATUS_BADGE,
  requested: "badge badge-primary badge-outline badge-sm",
  rejected: "badge badge-ghost badge-sm",
};
const LOAN_STATES: RowState[] = ["planned", "active", "overdue", "returned"];
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

async function fetchAllRequests(): Promise<RequestRow[]> {
  return db.query.loanRequests.findMany({
    with: { lendingItem: { with: { inventoryItem: { with: { tags: true } } } }, person: { with: { member: true } } },
  }) as unknown as Promise<RequestRow[]>;
}

lendingRoutes.get("/", requireAuth("lending:read"), async (c) => {
  const user = c.get("user")!;
  const today = new Date().toISOString().slice(0, 10);
  const canManage = user.permissions.has("lending:manage");
  const canLink = user.permissions.has("members:read");
  // Anfragen sieht nur, wer verwalten darf. Standard: alles außer „Abgelehnt“.
  const allowedStates: RowState[] = canManage ? [...LOAN_STATES, "requested", "rejected"] : LOAN_STATES;
  const defaultStates = allowedStates.filter((st) => st !== "rejected");
  const picked = parseMulti(c.req.queries("status"), allowedStates) as RowState[];
  const statusFilter = picked.length > 0 ? picked : defaultStates;
  const statusIsDefault = sameSet(statusFilter, defaultStates);
  const statusParam = statusIsDefault ? undefined : statusFilter;
  const search = (c.req.query("q") ?? "").trim();
  const tagFilter = c.req.queries("tag") ?? [];
  // Ohne start/end in der URL gilt das Standardfenster; leere Felder heben es auf.
  const range = parseRange(c.req.query(), today, "future", { start: addDays(today, -14), end: addDays(today, 30) });
  const { start, end } = range;
  const rp = rangeParams(range);
  const itemFilter = c.req.query("item") ?? "";
  // Beide (oder keine) Werte gewählt = kein Filter.
  const memberPicked = parseMulti(c.req.queries("member"), ["yes", "no"]);
  const member = memberPicked.length === 1 ? memberPicked[0] : "";
  const needle = search.toLowerCase();

  // Lazy statt Scheduler, siehe Backlog-Doc "Aufbewahrung" — die App führt keinen eigenen Cron.
  if (canManage) await cleanupRejectedLoanRequests(Number((await getSettings()).loanRequestRetentionDays));

  const all = await fetchAllLoans();
  const requests = canManage ? (await fetchAllRequests()).filter((r) => r.status !== "approved") : [];
  const openRequests = requests.filter((r) => r.status === "open").length;
  const loansByItem = new Map<string, typeof all>();
  for (const l of all) loansByItem.set(l.lendingItem.id, [...(loansByItem.get(l.lendingItem.id) ?? []), l]);

  const loanRows: Row[] = all.map((l) => {
    const state = loanStatus(l, today);
    const r = effectiveRange(l);
    // Überfällige sind noch draußen: offenes Ende statt plannedTo.
    if (r && state === "overdue") r.to = "9999-12-31T23:59";
    return {
      id: l.id, kind: "loan", href: `/inventory/lending/loans/${l.id}`, state, lendingItem: l.lendingItem, person: l.borrower, quantity: l.quantity,
      plannedFrom: l.plannedFrom, plannedTo: l.plannedTo,
      sortDate: l.plannedFrom ?? l.pickedUpAt ?? "", monthDate: l.plannedFrom ?? l.pickedUpAt ?? l.plannedTo ?? l.returnedAt ?? "",
      submittedAt: 0, conflict: false, range: r,
    };
  });
  const requestRows: Row[] = requests.map((q) => {
    const cand = { plannedFrom: q.plannedFrom, plannedTo: q.plannedTo, plannedFromTime: q.plannedFromTime, plannedToTime: q.plannedToTime, pickedUpAt: null, returnedAt: null, quantity: q.quantity };
    const item = q.lendingItem;
    const conflict = q.status === "open" && checkSharedAvailability(
      { individualTracking: item.individualTracking, stock: item.inventoryItem.quantity - item.inventoryItem.retiredQuantity },
      loansByItem.get(item.id) ?? [], cand,
    ).conflict;
    return {
      id: q.id, kind: "request", href: `/inventory/requests/${q.id}`, state: q.status === "open" ? "requested" : "rejected", lendingItem: item, person: q.person, quantity: q.quantity,
      plannedFrom: q.plannedFrom, plannedTo: q.plannedTo, sortDate: q.plannedFrom, monthDate: q.plannedFrom,
      submittedAt: q.submittedAt.getTime(), conflict, range: effectiveRange(cand),
    };
  });
  const rows = [...loanRows, ...requestRows];
  const allTags = [...new Set(rows.flatMap((r) => r.lendingItem.inventoryItem.tags.map((tg) => tg.tag)))].sort((a, b) => a.localeCompare(b, "de"));

  const filtered = rows.filter((r) => {
    // Offene Anfragen sind vom Standardfenster ausgenommen (bleiben sichtbar, bis entschieden); ein gewählter Zeitraum gilt auch für sie.
    const windowExempt = r.state === "requested" && range.mode === "default";
    if ((start || end) && !windowExempt) {
      // Überlappung mit dem Filterzeitraum; Einträge ganz ohne Datum fallen raus.
      if (!r.range || !rangesOverlap(r.range, { from: `${start || "0000-01-01"}T00:00`, to: `${end || "9999-12-31"}T23:59` })) return false;
    }
    if (itemFilter && r.lendingItem.id !== itemFilter) return false;
    if (!statusFilter.includes(r.state)) return false;
    if (tagFilter.length > 0 && !tagFilter.some((wanted) => r.lendingItem.inventoryItem.tags.some((tg) => tg.tag === wanted))) return false;
    if (member && Boolean(r.person.member) !== (member === "yes")) return false;
    if (needle && !`${r.lendingItem.inventoryItem.name} ${personName(r.person)}`.toLowerCase().includes(needle)) return false;
    return true;
  });

  // Am selben Tag stehen Anfragen vor Vorgängen (Handlungsbedarf), untereinander nach Eingang.
  const sorted = [...filtered].sort((a, b) =>
    a.sortDate.localeCompare(b.sortDate) || Number(b.kind === "request") - Number(a.kind === "request") || a.submittedAt - b.submittedAt);

  const groups = new Map<string, Row[]>();
  for (const r of sorted) {
    const key = r.monthDate.slice(0, 7);
    let bucket = groups.get(key);
    if (!bucket) { bucket = []; groups.set(key, bucket); }
    bucket.push(r);
  }

  const presets = rangePresets(today, "future");
  const hasFilter = Boolean(itemFilter || search || !statusIsDefault || tagFilter.length || member || start !== addDays(today, -14) || end !== addDays(today, 30));

  return c.html(
    <Layout title={t("lending.title")} user={user}>
      <PageHeader title={t("lending.title")} actions={<>
        <label class="flex items-center gap-2 cursor-pointer" title={t("lending.stats.toggle")}>
          <Icon name="icon-[tabler--chart-bar]" class="w-5 h-5" />
          <span class="@max-xl:hidden">{t("lending.stats.toggle")}</span>
          <input type="checkbox" id="lending-stats-toggle" class="toggle" aria-label={t("lending.stats.toggle")} onchange="toggleLendingStats(this.checked)" />
        </label>
        {canManage && <HeaderAction variant="primary" icon="icon-[tabler--plus]" label={t("lending.newLoan")} href="/inventory/lending/loans/new" class="btn-primary" />}
      </>} />

      <LendingStats loans={all} today={today} openRequests={canManage ? openRequests : null} requestsHref="/inventory/lending?status=requested" />
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          const stats = document.getElementById('lending-stats');
          const saved = localStorage.getItem('lending_statsVisible');
          if (saved) stats.style.display = saved === '1' ? 'block' : 'none';
          document.getElementById('lending-stats-toggle').checked = getComputedStyle(stats).display !== 'none';
          window.toggleLendingStats = function(show) {
            stats.style.display = show ? 'block' : 'none';
            localStorage.setItem('lending_statsVisible', show ? '1' : '0');
          };
        })();
      ` }} />

      <div class="filter-bar flex gap-2 items-center flex-wrap mb-4">
      <form method="get" action="/inventory/lending" class="contents">
        <label class="input flex items-center gap-2 w-56"><Icon name="icon-[tabler--search]" class="w-4 h-4 opacity-60" /><input type="search" name="q" value={search} placeholder={t("lending.filter.searchPlaceholder")} class="grow min-w-0" /></label>
        {statusParam?.map((v) => <input type="hidden" name="status" value={v} />)}
        {tagFilter.map((v) => <input type="hidden" name="tag" value={v} />)}
        {member && <input type="hidden" name="member" value={member} />}
        <input type="hidden" name="item" value={itemFilter} />
        {itemFilter && <a href={buildListUrl("/inventory/lending", { q: search, status: statusParam, tag: tagFilter, member, ...rp })} class="badge badge-neutral gap-1">{rows.find((r) => r.lendingItem.id === itemFilter)?.lendingItem.inventoryItem.name ?? "?"} ✕</a>}
        <QuickRangeFilter presets={presets} range={range} dir="future" action="/inventory/lending" bare
          href={(p) => buildListUrl("/inventory/lending", { item: itemFilter, q: search, status: statusParam, tag: tagFilter, member }, p)} />
      </form>
      <FilterDialog
        id="lending-filter-dialog"
        hidden={[
          ...(search ? [["q", search] as [string, string]] : []),
          ...(itemFilter ? [["item", itemFilter] as [string, string]] : []),
          ...Object.entries(rp).flatMap(([k, v]) => (v ? [[k, v] as [string, string]] : [])),
        ]}
        labels={{ button: t("lending.filter.button"), title: t("lending.filter.title"), quick: t("lending.filter.quick"), apply: t("common.apply"), close: t("common.cancel"), reset: t("common.reset"), searchPlaceholder: t("common.searchPlaceholder"), noResults: t("common.nav.noResults") }}
        quick={[
          ...(canManage ? [{ label: ROW_STATE_LABEL.requested, values: { status: ["requested"] } }] : []),
          { label: ROW_STATE_LABEL.overdue, values: { status: ["overdue"] } },
        ]}
        sections={[
          { type: "chips", param: "status", title: t("lending.loans.table.status"), options: allowedStates.map((st) => ({ value: st, label: ROW_STATE_LABEL[st] })), selected: statusFilter, defaults: defaultStates },
          { type: "chips", param: "member", title: t("lending.filter.borrower"), options: [{ value: "yes", label: t("common.filter.members") }, { value: "no", label: t("common.filter.external") }], selected: member ? [member] : [] },
          { type: "list", compact: true, param: "tag", title: t("inventory.table.tags"), options: allTags.map((tag) => ({ value: tag, label: tag })), selected: tagFilter },
        ]}
      />
        {hasFilter && <a href="/inventory/lending" class="btn btn-ghost">{t("lending.overview.rangeReset")}</a>}
      </div>

      {sorted.length === 0 ? (
        <p class="text-center opacity-50 py-8">{t("lending.overview.empty")}</p>
      ) : (
        <div class="overflow-x-auto">
          <table class="table table-zebra w-full [&_tbody_td]:border-b-0">
            <thead>
              <tr>
                <th class="pl-5 border-l-4 border-l-transparent">{t("lending.overview.col.start")}</th>
                <th>{t("lending.loans.form.item")}</th>
                <th>{t("lending.loans.table.borrower")}</th>
                <th>{t("lending.loans.table.status")}</th>
                <th>{t("lending.overview.col.period")}</th>
              </tr>
            </thead>
            <tbody>
              {[...groups.entries()].map(([month, group], i) => (
                <>
                  <tr>
                    <td colspan={5} class={`text-base font-semibold text-base-content/70 pb-1${i > 0 ? " pt-8" : " pt-2"}`}>
                      {formatMonth(month)}
                    </td>
                  </tr>
                  {group.map((r, idx) => {
                    const border = idx > 0 ? " border-t border-base-300" : "";
                    const clickable = r.kind === "request" || canManage;
                    const edge = r.state === "overdue" ? "border-l-error" : r.state === "requested" ? (r.conflict ? "border-l-warning" : "border-l-primary") : "border-l-transparent";
                    return (
                      <tr
                        key={`${r.kind}-${r.id}`}
                        class={`${clickable ? "cursor-pointer hover" : ""}${r.state === "rejected" ? " opacity-60" : ""}`}
                        {...(clickable ? { onclick: `window.location='${r.href}'` } : {})}
                      >
                        <td class={`whitespace-nowrap text-sm pl-5 border-l-4 ${edge}${border}`}>{formatDate(r.sortDate)}</td>
                        <td class={border}>{r.lendingItem.inventoryItem.name}{r.quantity > 1 && ` × ${r.quantity}`}</td>
                        <td class={border}><MemberLink memberId={r.person.member?.id} canLink={canLink}>{personName(r.person) || "—"}</MemberLink><MemberMark memberId={r.person.member?.id} canLink={canLink} /><BorrowerContact person={r.person} /></td>
                        <td class={border}><span class={ROW_STATE_BADGE[r.state]}>{ROW_STATE_LABEL[r.state]}</span></td>
                        <td class={`text-sm${r.state === "overdue" ? " text-error" : ""}${border}`}>
                          {r.conflict && <span class="inline-block mr-1 align-text-bottom text-warning" title={t("lending.overview.conflict")}><Icon name="icon-[tabler--alert-triangle]" class="w-4 h-4" /><span class="sr-only">{t("lending.overview.conflict")}</span></span>}
                          {formatDate(r.plannedFrom)} – {formatDate(r.plannedTo)}
                        </td>
                      </tr>
                    );
                  })}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
});

// ── Vorgangsseite (GET /loans/:loanId) ───────────────────────────────────────
// Abholen, Zurückgeben, Bearbeiten, Löschen als einfache POST-Formulare.

function LoanPage({ loan, item, editing }: { loan: LoanWithBorrower; item: LendingItemWithRelations; editing?: boolean }) {
  const base = `/inventory/lending/loans/${loan.id}`;
  const today = new Date().toISOString().slice(0, 10);
  const state = loanStatus(loan, today);
  const maxQuantity = Math.max(1, item.inventoryItem.quantity - item.inventoryItem.retiredQuantity);
  return (
    <>
      <PageHeader title={<a href={`/inventory/${item.inventoryItem.id}`} class="link link-hover">{item.inventoryItem.name}</a>} backHref="/inventory/lending" backLabel={t("lending.loans.backToList")} actions={editing
        ? <FormActions formId="loan-form" cancelHref={base} />
        : <DetailActions editHref={`${base}/edit`} remove={<DeleteDialog header id={`loan-${loan.id}`} action={`${base}/delete`} title={t("lending.loans.actions.deleteTitle")} body={t("lending.loans.actions.deleteBody", { borrower: borrowerLabel(loan), name: item.inventoryItem.name })} />} />} />
      <div class="mb-4">
        <dl class="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt class="opacity-60">{t("lending.loans.table.borrower")}</dt>
          <dd>{borrowerLabel(loan)}</dd>
          {(loan.borrower.email || loan.borrower.phone) && (
            <>
              <dt class="opacity-60">{t("lending.loans.form.borrowerContact")}</dt>
              <dd><BorrowerContact person={loan.borrower} inline /></dd>
            </>
          )}
          <dt class="opacity-60">{t("lending.loans.table.status")}</dt>
          <dd><span class={LOAN_STATUS_BADGE[state]}>{LOAN_STATUS_LABEL[state]}</span></dd>
        </dl>
      </div>
      {!editing && (
        <ViewGrid>
          {!item.individualTracking && <ViewField label={t("lending.loans.form.quantity")} value={String(loan.quantity)} />}
          <ViewField label={t("lending.loans.form.plannedFrom")} value={[formatDate(loan.plannedFrom), loan.plannedFromTime?.slice(0, 5)].filter(Boolean).join(" ")} />
          <ViewField label={t("lending.loans.form.plannedTo")} value={[formatDate(loan.plannedTo), loan.plannedToTime?.slice(0, 5)].filter(Boolean).join(" ")} />
          <ViewField label={t("lending.loans.form.pickedUpAt")} value={loan.pickedUpAt ? formatDate(loan.pickedUpAt) : ""} />
          <ViewField label={t("lending.loans.form.returnedAt")} value={loan.returnedAt ? formatDate(loan.returnedAt) : ""} />
        </ViewGrid>
      )}

      {editing && <div class="space-y-4 max-w-xl">
        <form id="loan-form" method="post" action={base} class="space-y-4">
          {!item.individualTracking && (
            <Field label={t("lending.loans.form.quantity")} class="max-w-32">
              <input type="number" name="quantity" min="1" max={maxQuantity} value={String(loan.quantity)} class="input w-full" placeholder={t("lending.loans.form.quantity")} />
            </Field>
          )}
          <LoanDateFields v={{
            plannedFrom: loan.plannedFrom ?? "", plannedTo: loan.plannedTo ?? "",
            plannedFromTime: loan.plannedFromTime?.slice(0, 5) ?? "", plannedToTime: loan.plannedToTime?.slice(0, 5) ?? "",
            pickedUpAt: loan.pickedUpAt ?? "", returnedAt: loan.returnedAt ?? "",
          }} />
        </form>
      </div>}
    </>
  );
}

// ── Verleihvorgänge zu einem Gegenstand ─────────────────────────────────────

// Wie DonorPickerFields: Suche über Personen (Mitglieder und frühere Ausleiher),
// Treffer oder "neu erfassen" öffnen dieselben editierbaren Felder; Kontaktdaten
// werden so an der Person ergänzt oder korrigiert.
type BorrowerValues = Partial<Record<"firstName" | "lastName" | "companyName" | "email" | "phone", string>>;

function BorrowerPickerFields({ personId, values, errors }: {
  personId?: string;
  values?: BorrowerValues;
  errors?: Record<string, string>;
}) {
  const v = values ?? {};
  const showFields = Boolean(personId) || Object.values(v).some(Boolean);
  const field = (name: keyof BorrowerValues, label: string, type = "text", required = false) => type === "email" || type === "tel" ? (
    <>
      {type === "email"
        ? <EmailField label={label} id={`borrower-${name}`} name={name} value={v[name] ?? ""} required={required} error={!!errors?.[name]} />
        : <PhoneField label={label} id={`borrower-${name}`} name={name} value={v[name] ?? ""} required={required} error={!!errors?.[name]} />}
      {errors?.[name] && <span class="text-error text-sm mt-1">{errors[name]}</span>}
    </>
  ) : (
    <Field label={label} required={required}>
      <input type={type} id={`borrower-${name}`} name={name} value={v[name] ?? ""} class={`input w-full${errors?.[name] ? " input-error" : ""}`} placeholder={label} />
      {errors?.[name] && <span class="text-error text-sm mt-1">{errors[name]}</span>}
    </Field>
  );
  return (
    <div class="space-y-3">
      <div id="borrower-picker">
        <p class="fieldset-legend">{t("lending.loans.form.borrowerType")}</p>
        <EntityPicker id="borrower-personId" name="borrowerPersonId" searchUrl="/inventory/lending/search-persons" selectedId={personId}
          selectedName={personId ? personName({ firstName: v.firstName ?? "", lastName: v.lastName ?? "", companyName: v.companyName }) : undefined}
          placeholder={t("lending.loans.form.borrowerSearchPlaceholder")} error={!!errors?.borrower} />
        {errors?.borrower && <p class="text-error text-sm mt-1">{errors.borrower}</p>}
      </div>
      <div id="borrower-fields" class={`space-y-4${showFields ? "" : " hidden"}`}>
        <p class="text-sm opacity-70">{t("lending.loans.form.borrowerHint")}</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field("lastName", t("members.form.lastName"))}
          {field("firstName", t("members.form.firstName"))}
        </div>
        {field("companyName", t("lend.form.organization"))}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field("email", t("members.form.email"), "email")}
          {field("phone", t("members.form.phone"), "tel")}
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        (function(){
          var root = document.getElementById('borrower-picker'), fields = ['firstName', 'lastName', 'companyName', 'email', 'phone'];
          var show = function(on, d) {
            fields.forEach(function(f) { document.getElementById('borrower-' + f).value = (d && d[f]) || ''; });
            document.getElementById('borrower-fields').classList.toggle('hidden', !on);
          };
          root.addEventListener('picker:select', function(e) { show(true, e.detail); });
          root.addEventListener('picker:create', function() { document.getElementById('borrower-personId').value = ''; show(true); document.getElementById('borrower-companyName').focus(); });
          root.addEventListener('picker:clear', function() { show(false); });
        })();
      ` }} />
    </div>
  );
}

// Treffer ohne Verleih-Eintrag blenden die Verleih-Optionen ein; "neu anlegen" springt mit dem
// aktuellen Formularstand ins Inventar und kommt über returnTo mit der neuen Auswahl zurück.
const ITEM_PICKER_SCRIPT = `
  (function(){
    var root = document.getElementById('item-picker'), cfg = document.getElementById('lend-config'), max = document.getElementById('lend-config-max'), form = document.getElementById('loan-new-form');
    root.addEventListener('picker:select', function(e) {
      var d = e.detail, pending = d.lendable !== '1';
      cfg.classList.toggle('hidden', !pending);
      max.classList.toggle('hidden', !(pending && Number(d.stock) > 1));
      var q = form.elements.quantity; if (q && d.stock) q.max = d.stock;
    });
    root.addEventListener('picker:clear', function() { cfg.classList.add('hidden'); });
    root.addEventListener('picker:create', function() {
      var skip = ['q', 'inventoryItemId', 'publicRequestable', 'timesRequired', 'maxRequestQuantity'], p = new URLSearchParams();
      new FormData(form).forEach(function(v, k) { if (v && skip.indexOf(k) < 0) p.append(k, v); });
      var back = '/inventory/lending/loans/new?' + p.toString() + (p.toString() ? '&' : '') + 'item={id}';
      location.href = '/inventory/new?lendable=1&returnTo=' + encodeURIComponent(back);
    });
  })();
`;

// Noch nicht verleihbarer Inventar-Gegenstand, der beim Anlegen des Vorgangs verleihbar gemacht wird.
type PendingItem = { id: string; name: string; quantity: number };
type LendConfigValues = Partial<{ publicRequestable: string; timesRequired: string; maxRequestQuantity: string }>;

// Plan (Pflicht) und Ist (optional) bewusst getrennt; gemeinsam für Neuanlage und Bearbeiten.
function LoanDateFields({ v, errors }: {
  v: Partial<Record<"plannedFrom" | "plannedTo" | "plannedFromTime" | "plannedToTime" | "pickedUpAt" | "returnedAt", string>>;
  errors?: Record<string, string>;
}) {
  // input-Event, damit abhängige Buttons (oninput) mitziehen.
  const todayBtn = (target: string) => (
    <div class="tooltip tooltip-left absolute right-9 top-1/2 -translate-y-1/2 z-10" data-tip={t("lending.loans.form.takeOverToday")}>
      <button type="button" class="btn btn-ghost btn-xs btn-square" aria-label={t("lending.loans.form.takeOverToday")} onclick={`var i=document.getElementById('${target}');i.value=new Date().toLocaleDateString('sv');i.dispatchEvent(new Event('input',{bubbles:true}))`}>
        <Icon name="icon-[tabler--calendar-check]" class="w-4 h-4" />
      </button>
    </div>
  );
  const takeOver = (id: string, target: string, srcId: string, label: string, disabled: boolean) => (
    <>
      <div class="tooltip tooltip-left absolute right-16 top-1/2 -translate-y-1/2 z-10" data-tip={label}>
        <button type="button" id={id} disabled={disabled} class="btn btn-ghost btn-xs btn-square" aria-label={label} onclick={`var i=document.getElementById('${target}');i.value=document.getElementById('${srcId}').value;i.dispatchEvent(new Event('input',{bubbles:true}))`}>
          <Icon name="icon-[tabler--calendar-spark]" class="w-4 h-4" />
        </button>
      </div>
      {todayBtn(target)}
    </>
  );
  return (
    <div class="space-y-4">
      <fieldset class="rounded-box border border-primary/40 p-4 space-y-3">
        <legend class="px-2 font-semibold text-primary">{t("lending.loans.form.planGroup")}</legend>
        <p class="text-sm opacity-70">{t("lending.loans.form.planHint")}</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t("lending.loans.form.plannedFrom")} required>
            <div class="relative w-full">
              <input type="date" id="loan-plannedFrom" name="plannedFrom" oninput="document.getElementById('loan-takeFrom').disabled=!this.value" value={v.plannedFrom ?? ""} required class={`input w-full${errors?.plannedFrom ? " input-error" : ""}`} />
              {todayBtn("loan-plannedFrom")}
            </div>
            {errors?.plannedFrom && <span class="text-error text-sm mt-1">{errors.plannedFrom}</span>}
          </Field>
          <Field label={t("lend.form.plannedFromTime")}>
            <input type="time" name="plannedFromTime" value={v.plannedFromTime ?? ""} class={`input w-full${errors?.times ? " input-error" : ""}`} />
          </Field>
          <Field label={t("lending.loans.form.plannedTo")} required>
            <div class="relative w-full">
              <input type="date" id="loan-plannedTo" name="plannedTo" oninput="document.getElementById('loan-takeTo').disabled=!this.value" value={v.plannedTo ?? ""} required class={`input w-full${errors?.plannedTo ? " input-error" : ""}`} />
              {todayBtn("loan-plannedTo")}
            </div>
            {errors?.plannedTo && <span class="text-error text-sm mt-1">{errors.plannedTo}</span>}
          </Field>
          <Field label={t("lend.form.plannedToTime")}>
            <input type="time" name="plannedToTime" value={v.plannedToTime ?? ""} class={`input w-full${errors?.times ? " input-error" : ""}`} />
          </Field>
          {errors?.times && <p class="text-error text-sm sm:col-span-2">{errors.times}</p>}
        </div>
      </fieldset>
      <fieldset class="rounded-box border border-success/40 bg-success/5 p-4 space-y-3">
        <legend class="px-2 font-semibold text-success">{t("lending.loans.form.actualGroup")}</legend>
        <p class="text-sm opacity-70">{t("lending.loans.form.actualHint")}</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t("lending.loans.form.pickedUpAt")}>
            <div class="relative w-full">
              <input type="date" id="loan-pickedUpAt" name="pickedUpAt" value={v.pickedUpAt ?? ""} class="input w-full" />
              {takeOver("loan-takeFrom", "loan-pickedUpAt", "loan-plannedFrom", t("lending.loans.form.takeOverFrom"), !v.plannedFrom)}
            </div>
          </Field>
          <Field label={t("lending.loans.form.returnedAt")}>
            <div class="relative w-full">
              <input type="date" id="loan-returnedAt" name="returnedAt" value={v.returnedAt ?? ""} class="input w-full" />
              {takeOver("loan-takeTo", "loan-returnedAt", "loan-plannedTo", t("lending.loans.form.takeOverTo"), !v.plannedTo)}
            </div>
          </Field>
        </div>
      </fieldset>
    </div>
  );
}

function LoanForm({ action, item, pending, withItemPicker, canCreateItem, values, errors, maxQuantity }: {
  action: string;
  item?: LendingItemWithRelations;
  pending?: PendingItem;
  // Gesetzt = Gegenstand-Auswahl im Formular (Einstieg ohne Item im Pfad).
  withItemPicker?: boolean;
  // Darf neue Inventar-Gegenstände anlegen (inventory:manage).
  canCreateItem?: boolean;
  values?: Partial<{ quantity: string; plannedFrom: string; plannedTo: string; plannedFromTime: string; plannedToTime: string; pickedUpAt: string; returnedAt: string; borrowerPersonId: string }> & BorrowerValues & LendConfigValues;
  errors?: Record<string, string>;
  maxQuantity?: number;
}) {
  const v = values ?? {};
  return (
    <form id="loan-new-form" method="post" action={action} class="space-y-4 max-w-md">
      {withItemPicker && (
        <div class="space-y-3">
          <div id="item-picker">
            <p class="fieldset-legend">{t("lending.loans.form.item")}</p>
            <EntityPicker id="loan-inventoryItemId" name="inventoryItemId" searchUrl="/inventory/lending/search-items" suggest
              selectedId={item?.inventoryItem.id ?? pending?.id} selectedName={item?.inventoryItem.name ?? pending?.name}
              extraParams={canCreateItem ? { canCreate: "1" } : undefined}
              placeholder={t("lending.loans.form.itemPlaceholder")} error={!!errors?.item} />
            {errors?.item && <span class="text-error text-sm mt-1">{errors.item}</span>}
          </div>
          <div id="lend-config" class={`card card-border border-base-300 bg-base-100${pending ? "" : " hidden"}`}>
            <div class="card-body gap-3 p-4">
              <p class="text-sm opacity-70">{t("lending.loans.form.makeLendableHint")}</p>
              <label class="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" name="publicRequestable" value="1" checked={v.publicRequestable === "1"} class="toggle toggle-success" />
                <span>{t("lend.form.publicRequestable")}</span>
              </label>
              <label class="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" name="timesRequired" value="1" checked={v.timesRequired === "1"} class="toggle toggle-success" />
                <span>{t("lend.form.timesRequired")}</span>
              </label>
              <div id="lend-config-max" class={pending && pending.quantity > 1 ? "" : "hidden"}>
                <Field label={t("lend.form.maxRequestQuantity")} class="max-w-32">
                  <input type="number" name="maxRequestQuantity" min="0" value={v.maxRequestQuantity ?? ""} class={`input w-full${errors?.maxRequestQuantity ? " input-error" : ""}`} placeholder="0" />
                  {errors?.maxRequestQuantity && <span class="text-error text-sm mt-1">{errors.maxRequestQuantity}</span>}
                </Field>
              </div>
            </div>
          </div>
        </div>
      )}
      <BorrowerPickerFields personId={v.borrowerPersonId} values={v} errors={errors} />

      {(withItemPicker || !item?.individualTracking) && (
        <Field label={t("lending.loans.form.quantity")} class="max-w-32">
          <input type="number" name="quantity" min="1" max={maxQuantity} value={v.quantity ?? "1"} class={`input w-full${errors?.quantity ? " input-error" : ""}`} placeholder={t("lending.loans.form.quantity")} />
          {errors?.quantity && <span class="text-error text-sm mt-1">{errors.quantity}</span>}
        </Field>
      )}

      <LoanDateFields v={v} errors={errors} />
      {errors?.dates && <p class="text-error text-sm" role="alert">{errors.dates}</p>}
      {errors?.conflict && <p class="text-error text-sm" role="alert">{errors.conflict}</p>}
      {withItemPicker && <script dangerouslySetInnerHTML={{ __html: ITEM_PICKER_SCRIPT }} />}
    </form>
  );
}

// Verfügbarkeitsprüfung beim Anlegen — hart blockierend, siehe Backlog-Doc
// "Verfügbarkeitsprüfung". Einzel-Tracking: jede Überschneidung blockiert.
// Stückzahl: Summe der Mengen überlappender Vorgänge + neue Anfrage gegen
// quantity - retiredQuantity.
function checkAvailability(
  item: LendingItemWithRelations,
  existingLoans: LoanWithBorrower[],
  candidate: { plannedFrom: string | null; plannedTo: string | null; plannedFromTime?: string | null; plannedToTime?: string | null; pickedUpAt: string | null; returnedAt: string | null; quantity: number },
  excludeLoanId?: string,
): string | null {
  // Menge gegen den Bestand prüfen, auch ohne Datum (sonst umgeht ein Vorgang
  // ganz ohne Zeitraum jede Prüfung).
  if (!item.individualTracking) {
    const stock = item.inventoryItem.quantity - item.inventoryItem.retiredQuantity;
    if (stock > 0 && candidate.quantity > stock) return t("lending.loans.error.exceedsStock", { max: stock });
  }

  const candidateRange = effectiveRange(candidate);
  if (!candidateRange) return null;

  const overlapping = existingLoans.filter((l) => {
    if (l.id === excludeLoanId) return false;
    const range = effectiveRange(l);
    return range && rangesOverlap(range, candidateRange);
  });

  if (item.individualTracking) {
    return overlapping.length > 0 ? t("lending.loans.error.conflict") : null;
  }

  const capacity = item.inventoryItem.quantity - item.inventoryItem.retiredQuantity;
  if (capacity <= 0) return null; // kein brauchbarer Bestand gepflegt — Prüfung entfällt, siehe Backlog-Doc
  const used = overlapping.reduce((sum, l) => sum + l.quantity, 0);
  return used + candidate.quantity > capacity ? t("lending.loans.error.conflict") : null;
}

async function createLoan(c: Context<{ Variables: Variables }>) {
  const body = await c.req.parseBody();
  const lendingItemId = trimmed(body, "lendingItemId");
  const inventoryItemId = trimmed(body, "inventoryItemId");
  let item = lendingItemId ? await fetchLendingItem(lendingItemId) : undefined;
  if (!item && inventoryItemId) {
    item = (await db.query.lendingItems.findFirst({
      where: eq(lendingItems.inventoryItemId, inventoryItemId),
      with: { inventoryItem: { with: { tags: true } } },
    })) as unknown as LendingItemWithRelations | undefined;
  }
  if (item?.inventoryItem.retiredAt) return c.notFound();

  // Gegenstand ist im Inventar, aber noch nicht verleihbar: Verleih-Eintrag wird mit dem Vorgang angelegt.
  let pending: PendingItem | undefined;
  const lendConfig = {
    publicRequestable: trimmed(body, "publicRequestable") === "1",
    timesRequired: trimmed(body, "timesRequired") === "1",
    maxRequestQuantity: Math.round(Number(trimmed(body, "maxRequestQuantity"))) || 0,
  };
  if (!item && inventoryItemId) {
    const inv = await db.query.inventoryItems.findFirst({ where: eq(inventoryItems.id, inventoryItemId) });
    if (!inv || inv.retiredAt) return c.notFound();
    const stock = inv.quantity - inv.retiredQuantity;
    pending = { id: inv.id, name: inv.name, quantity: stock };
    // Wie im Inventarformular: Einzel-Tracking aus der Menge abgeleitet und danach fix.
    item = { id: "", inventoryItemId: inv.id, individualTracking: inv.quantity <= 1, ...lendConfig, inventoryItem: { ...inv, tags: [] } } as LendingItemWithRelations;
  }

  const borrowerPersonId = trimmed(body, "borrowerPersonId");
  const person = {
    firstName: trimmed(body, "firstName"),
    lastName: trimmed(body, "lastName"),
    companyName: trimmed(body, "companyName"),
    email: trimmed(body, "email"),
    phone: trimmed(body, "phone"),
  };
  const plannedFrom = trimmed(body, "plannedFrom") || null;
  const plannedTo = trimmed(body, "plannedTo") || null;
  const plannedFromTime = trimmed(body, "plannedFromTime") || null;
  const plannedToTime = trimmed(body, "plannedToTime") || null;
  const pickedUpAt = trimmed(body, "pickedUpAt") || null;
  const returnedAt = trimmed(body, "returnedAt") || null;
  // Server erzwingt 1 bei Einzel-Tracking, auch falls im Formular manipuliert.
  const quantity = item?.individualTracking ? 1 : Math.max(1, Math.round(Number(trimmed(body, "quantity"))) || 1);

  const errors: Record<string, string> = {};
  if (!item) errors.item = t("lending.loans.error.itemRequired");
  if (pending && (item!.individualTracking ? lendConfig.maxRequestQuantity !== 0 : lendConfig.maxRequestQuantity < 0 || lendConfig.maxRequestQuantity > pending.quantity)) errors.maxRequestQuantity = t("lending.loans.error.invalidQuantity");
  if (pending) item!.maxRequestQuantity = item!.individualTracking ? 0 : lendConfig.maxRequestQuantity;
  // Organisation oder Name; ein Name braucht immer Vor- und Nachname. Kontakt ist optional.
  const hasPerson = Boolean(borrowerPersonId || person.companyName || person.lastName || person.firstName);
  if (!hasPerson) errors.borrower = t("lending.loans.error.borrowerRequired");
  else if (person.firstName || person.lastName) {
    if (!person.lastName) errors.lastName = t("common.required");
    if (!person.firstName) errors.firstName = t("common.required");
  }
  if (item && !item.individualTracking && (!Number.isInteger(quantity) || quantity < 1)) errors.quantity = t("lending.loans.error.invalidQuantity");
  if (!plannedFrom) errors.plannedFrom = t("common.required");
  if (!plannedTo) errors.plannedTo = t("common.required");
  const dateError = validateLoanDates({ plannedFrom, plannedTo, plannedFromTime, plannedToTime, pickedUpAt, returnedAt });
  // "noDates" ist durch die Pflicht für plannedFrom/plannedTo bereits abgedeckt.
  if (dateError && dateError !== "noDates") {
    const key = dateError === "timesIncomplete" || dateError === "plannedToTimeBeforeFrom" ? "times" : "dates";
    errors[key] = t(`lending.loans.error.${dateError}`);
  }

  if (item && !errors.dates && !errors.times) {
    const existingLoans = pending ? [] : await fetchLoans(item.id);
    const conflict = checkAvailability(item, existingLoans, { plannedFrom, plannedTo, plannedFromTime, plannedToTime, pickedUpAt, returnedAt, quantity });
    if (conflict) errors.conflict = conflict;
  }

  if (Object.keys(errors).length > 0) {
    const user = c.get("user")!;
    const values = { publicRequestable: lendConfig.publicRequestable ? "1" : "", timesRequired: lendConfig.timesRequired ? "1" : "", maxRequestQuantity: trimmed(body, "maxRequestQuantity"), quantity: String(quantity), plannedFrom: plannedFrom ?? "", plannedTo: plannedTo ?? "", plannedFromTime: plannedFromTime ?? "", plannedToTime: plannedToTime ?? "", pickedUpAt: pickedUpAt ?? "", returnedAt: returnedAt ?? "", borrowerPersonId, ...person };
    return c.html(
      <Layout title={t("lending.newLoan.title")} user={user}>
        <div class="max-w-md mx-auto">
          <NewLoanHeader />
          <LoanForm action="/inventory/lending/loans" item={pending ? undefined : item} pending={pending} withItemPicker canCreateItem={user.permissions.has("inventory:manage")} values={values} errors={errors} />
        </div>
      </Layout>,
      422
    );
  }

  const lendingItemIdForLoan = await db.transaction(async (tx) => {
    let lendingId = item!.id;
    if (pending) {
      [{ id: lendingId }] = await tx.insert(lendingItems).values({ inventoryItemId: pending.id, individualTracking: item!.individualTracking, publicRequestable: lendConfig.publicRequestable, timesRequired: lendConfig.timesRequired, maxRequestQuantity: item!.maxRequestQuantity }).returning({ id: lendingItems.id });
    }
    // Gewählte Person: Kontakt/Name wie im Spender-Formular direkt an der Person korrigieren.
    let personId = borrowerPersonId;
    const columns = { firstName: person.firstName, lastName: person.lastName, companyName: person.companyName || null, email: person.email || null, phone: person.phone || null };
    if (personId) await tx.update(persons).set(columns).where(eq(persons.id, personId));
    else [{ id: personId }] = await tx.insert(persons).values(columns).returning({ id: persons.id });
    await tx.insert(lendingLoans).values({
      lendingItemId: lendingId,
      quantity,
      borrowerPersonId: personId,
      plannedFrom,
      plannedTo,
      plannedFromTime,
      plannedToTime,
      pickedUpAt,
      returnedAt,
    });
    return lendingId;
  });

  setFlash(c, t("lending.loans.flash.created"), "success");
  return c.redirect(`/inventory/lending?item=${lendingItemIdForLoan}&start=&end=`);
}

// GET /inventory/lending/search-persons — Mitglieder und frühere Ausleiher (keine reinen
// Spender/Antragsteller). Treffer tragen die vier bearbeitbaren Felder.
lendingRoutes.get("/search-persons", requireAuth("lending:manage"), async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.html("");

  const needle = `%${q}%`;
  const results = await db
    .select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName, email: persons.email, phone: persons.phone, companyName: persons.companyName,
      isMember: sql<boolean>`exists (select 1 from ${members} where ${members.personId} = ${persons.id})` })
    .from(persons)
    .where(and(
      or(ilike(persons.firstName, needle), ilike(persons.lastName, needle), ilike(persons.companyName, needle)),
      or(
        exists(db.select({ x: members.id }).from(members).where(eq(members.personId, persons.id))),
        exists(db.select({ x: lendingLoans.id }).from(lendingLoans).where(eq(lendingLoans.borrowerPersonId, persons.id))),
      ),
    ))
    .orderBy(asc(persons.lastName))
    .limit(10);

  return c.html(
    <PickerOptions
      empty={t("picker.noResults", { query: q })}
      createLabel={t("lending.loans.form.borrowerExternalNew")}
      options={results.map((p) => ({
        id: p.id,
        name: personName(p),
        member: p.isMember,
        sub: [p.email, p.phone].filter(Boolean).join(" · ") || undefined,
        data: { firstName: p.firstName, lastName: p.lastName, companyName: p.companyName, email: p.email, phone: p.phone },
      }))}
    />
  );
});

// GET /inventory/lending/search-items — alle nicht ausgemusterten Inventar-Gegenstände; ohne Suchtext
// die verleihbaren als Vorschlag. Treffer ohne Verleih-Eintrag werden beim Speichern verleihbar gemacht.
lendingRoutes.get("/search-items", requireAuth("lending:manage"), async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const needle = `%${q}%`;
  const match = q
    ? or(
        ilike(inventoryItems.name, needle),
        exists(db.select({ x: inventoryItemTags.id }).from(inventoryItemTags).where(and(eq(inventoryItemTags.inventoryItemId, inventoryItems.id), ilike(inventoryItemTags.tag, needle)))),
        exists(db.select({ x: inventoryItemNumbers.id }).from(inventoryItemNumbers).where(and(eq(inventoryItemNumbers.inventoryItemId, inventoryItems.id), ilike(inventoryItemNumbers.number, needle)))),
      )
    : undefined;
  const rows = await db
    .select({ id: inventoryItems.id, name: inventoryItems.name, quantity: inventoryItems.quantity, retiredQuantity: inventoryItems.retiredQuantity, lendingItemId: lendingItems.id })
    .from(inventoryItems)
    .leftJoin(lendingItems, eq(lendingItems.inventoryItemId, inventoryItems.id))
    .where(and(isNull(inventoryItems.retiredAt), match, q ? undefined : exists(db.select({ x: lendingItems.id }).from(lendingItems).where(eq(lendingItems.inventoryItemId, inventoryItems.id)))))
    .orderBy(asc(inventoryItems.name))
    .limit(10);
  return c.html(
    <PickerOptions
      empty={t("picker.noResults", { query: q })}
      createLabel={q && c.req.query("canCreate") === "1" ? t("lending.loans.form.itemNew") : undefined}
      options={rows.map((r) => ({
        id: r.id,
        name: r.name,
        sub: r.lendingItemId ? t("lending.loans.form.itemStock", { count: r.quantity - r.retiredQuantity }) : t("lending.loans.form.itemNotLendable"),
        data: { lendable: r.lendingItemId ? "1" : "0", stock: String(r.quantity - r.retiredQuantity) },
      }))}
    />
  );
});

function NewLoanHeader() {
  return (
    <PageHeader title={t("lending.newLoan.title")} backHref="/inventory/lending" backLabel={t("lending.loans.backToList")} actions={<FormActions formId="loan-new-form" />} />
  );
}

// GET /inventory/lending/loans/new?item=<lendingItemId> — Einstieg aus der Vorgangsliste
// (kein Item) und aus /inventory (Item vorausgewählt).
lendingRoutes.get("/loans/new", requireAuth("lending:manage"), async (c) => {
  const user = c.get("user")!;
  const query = c.req.query();
  const selected = query.item ? await fetchLendingItem(query.item) : undefined;
  const keys = ["quantity", "plannedFrom", "plannedTo", "plannedFromTime", "plannedToTime", "pickedUpAt", "returnedAt", "borrowerPersonId", "firstName", "lastName", "companyName", "email", "phone"];
  // Formularstand kommt beim Rücksprung aus dem Inventar (returnTo) in der Query zurück.
  const values = Object.fromEntries(keys.filter((k) => query[k]).map((k) => [k, query[k]]));
  return c.html(
    <Layout title={t("lending.newLoan.title")} user={user}>
      <div class="max-w-md mx-auto">
        <NewLoanHeader />
        <LoanForm action="/inventory/lending/loans" item={selected?.inventoryItem.retiredAt ? undefined : selected} withItemPicker canCreateItem={user.permissions.has("inventory:manage")} values={values} />
      </div>
    </Layout>
  );
});

lendingRoutes.post("/loans", requireAuth("lending:manage"), async (c) => {
  return createLoan(c);
});

async function loadLoanWithItem(loanId: string) {
  const loan = await fetchLoan(loanId);
  const item = loan ? await fetchLendingItem(loan.lendingItemId) : undefined;
  return loan && item ? { loan, item } : undefined;
}

lendingRoutes.get("/loans/:loanId", requireAuth("lending:manage"), async (c) => {
  const found = await loadLoanWithItem(c.req.param("loanId"));
  if (!found) return c.notFound();
  return c.html(
    <Layout title={found.item.inventoryItem.name} user={c.get("user")!}>
      <LoanPage {...found} />
    </Layout>
  );
});

lendingRoutes.get("/loans/:loanId/edit", requireAuth("lending:manage"), async (c) => {
  const found = await loadLoanWithItem(c.req.param("loanId"));
  if (!found) return c.notFound();
  return c.html(
    <Layout title={found.item.inventoryItem.name} user={c.get("user")!}>
      <LoanPage {...found} editing />
    </Layout>
  );
});

// Datumsregeln gelten immer; die Verfügbarkeit nur, wenn sich Plan oder Menge
// ändern (Abholung/Rückgabe sind Tatsachen und werden nie blockiert).
async function saveLoan(c: Context<{ Variables: Variables }>, loanId: string) {
  const found = await loadLoanWithItem(loanId);
  if (!found) return c.notFound();
  const { loan, item } = found;

  const body = await c.req.parseBody();
  const pick = (key: "plannedFrom" | "plannedTo" | "plannedFromTime" | "plannedToTime" | "pickedUpAt" | "returnedAt") =>
    key in body ? trimmed(body, key) || null : loan[key];

  const patch = {
    plannedFrom: pick("plannedFrom"),
    plannedTo: pick("plannedTo"),
    plannedFromTime: pick("plannedFromTime"),
    plannedToTime: pick("plannedToTime"),
    pickedUpAt: pick("pickedUpAt"),
    returnedAt: pick("returnedAt"),
    quantity: item.individualTracking ? 1 : "quantity" in body ? Math.max(1, Math.round(Number(trimmed(body, "quantity"))) || 1) : loan.quantity,
  };
  const next = { ...loan, ...patch };

  let error: string | null = null;
  const dateError = validateLoanDates(next);
  if (dateError) error = t(`lending.loans.error.${dateError}`);
  else if (next.plannedFrom !== loan.plannedFrom || next.plannedTo !== loan.plannedTo || next.plannedFromTime !== loan.plannedFromTime || next.plannedToTime !== loan.plannedToTime || next.quantity !== loan.quantity) {
    error = checkAvailability(item, await fetchLoans(item.id), next, loan.id);
  }

  if (error) {
    setFlash(c, error, "error");
    return c.redirect(`/inventory/lending/loans/${loan.id}/edit`);
  }

  await db.update(lendingLoans).set(patch).where(eq(lendingLoans.id, loan.id));
  setFlash(c, t("lending.loans.flash.updated"), "success");
  return c.redirect(`/inventory/lending/loans/${loan.id}`);
}

lendingRoutes.post("/loans/:loanId", requireAuth("lending:manage"), (c) => saveLoan(c, c.req.param("loanId")));

lendingRoutes.post("/loans/:loanId/delete", requireAuth("lending:manage"), async (c) => {
  const found = await loadLoanWithItem(c.req.param("loanId"));
  if (!found) return c.notFound();
  await db.delete(lendingLoans).where(eq(lendingLoans.id, found.loan.id));
  setFlash(c, t("lending.loans.flash.deleted"), "success");
  return c.redirect(`/inventory/lending?item=${found.item.id}&start=&end=`);
});
