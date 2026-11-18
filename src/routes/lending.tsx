import { Hono, type Context } from "hono";
import { and, asc, eq, exists, ilike, or } from "drizzle-orm";
import { EmailField, Field, PhoneField } from "../components/field.js";
import { db } from "../db/index.js";
import { inventoryItems, inventoryItemTags, lendingItems, lendingLoans, loanRequests, members, persons } from "../db/schema/index.js";
import { Icon } from "../components/icon.js";
import { EntityPicker, PickerOptions } from "../components/entity-picker.js";
import { FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { QuickRangeFilter } from "../components/quick-range-filter.js";
import { parseRange, rangeParams, rangePresets, todayStr } from "../lib/quick-range.js";
import { ToggleFilter, pairToggles } from "../components/toggle-filter.js";
import { MemberMark, MemberLink } from "../components/member-mark.js";
import { MultiSelectFilter } from "../components/multi-select-filter.js";
import { buildListUrl, parseMulti } from "../lib/list-query.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { formatDate } from "../lib/format.js";
import { trimmed } from "../lib/forms.js";
import { getSettings } from "../lib/settings.js";
import { StatCard } from "../components/stat-card.js";
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

// Auswahl für das Verleihformular: nur nicht ausgemusterte Items, alphabetisch.
async function fetchLendableItems(): Promise<LendingItemWithRelations[]> {
  const all = await fetchLendingItems();
  return all
    .filter((li) => !li.inventoryItem.retiredAt)
    .sort((a, b) => a.inventoryItem.name.localeCompare(b.inventoryItem.name, "de"));
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
    <div id="lending-stats" class="hidden sm:block @container mb-6">
      <div class={`grid grid-cols-2 ${openRequests === null ? "@4xl:grid-cols-4" : "@4xl:grid-cols-5"} gap-2 @4xl:gap-4`}>
        <StatCard label={t("lending.stats.out")} value={open.filter((l) => l.pickedUpAt).length} tone="text-info" />
        <StatCard label={t("lending.stats.overdue")} value={overdue} tone={overdue > 0 ? "text-error" : undefined} href={statusHref("overdue")} link="filter" />
        <StatCard label={t("lending.stats.dueToday")} value={open.filter((l) => l.plannedTo === today).length} />
        <StatCard label={t("lending.stats.planned")} value={loans.filter((l) => loanStatus(l, today) === "planned").length} href={statusHref("planned")} link="filter" />
        {openRequests !== null && <StatCard label={t("lending.stats.requests")} value={openRequests} tone={openRequests > 0 ? "text-primary" : undefined} href={requestsHref} link="filter" />}
      </div>
    </div>
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
  const member = c.req.query("member") === "yes" || c.req.query("member") === "no" ? c.req.query("member")! : "";
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
  const statusLabel = sameSet(statusFilter, allowedStates) ? t("lending.filter.allStatus")
    : statusIsDefault ? (canManage ? t("lending.filter.allButRejected") : t("lending.filter.allStatus")) : undefined;

  return c.html(
    <Layout title={t("lending.title")} user={user}>
      <PageHeader title={t("lending.title")} actions={<>
        <label class="flex items-center gap-2 cursor-pointer" title={t("lending.stats.toggle")}>
          <Icon name="chart-bar" class="w-5 h-5" />
          <span class="@max-xl:hidden">{t("lending.stats.toggle")}</span>
          <input type="checkbox" id="lending-stats-toggle" class="toggle" aria-label={t("lending.stats.toggle")} onchange="toggleLendingStats(this.checked)" />
        </label>
        {canManage && <HeaderAction variant="primary" icon="plus" label={t("lending.newLoan")} href="/inventory/lending/loans/new" class="btn-primary" />}
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

      <form method="get" action="/inventory/lending" class="filter-bar flex gap-2 items-center flex-wrap mb-4">
        <label class="input flex items-center gap-2 w-56"><Icon name="magnifying-glass" class="w-4 h-4 opacity-60" /><input type="search" name="q" value={search} placeholder={t("lending.filter.searchPlaceholder")} class="grow min-w-0" /></label>
        <MultiSelectFilter
          param="status"
          options={allowedStates.map((st) => ({ value: st, label: ROW_STATE_LABEL[st] }))}
          selected={statusFilter}
          allLabel={t("lending.filter.allStatus")}
          labelOverride={statusLabel}
          countLabel={(count) => t("lending.filter.statusCount", { count })}
          applyLabel={t("common.apply")}
          resetLabel={t("common.reset")}
        />
        <MultiSelectFilter
          param="tag"
          searchable
          options={allTags.map((tag) => ({ value: tag, label: tag }))}
          selected={tagFilter}
          allLabel={t("inventory.filter.allTags")}
          countLabel={(count) => t("inventory.filter.tagCount", { count })}
          applyLabel={t("common.apply")}
          resetLabel={t("common.reset")}
          searchPlaceholder={t("common.searchPlaceholder")}
          emptyLabel={t("inventory.filter.noTags")}
        />
        <input type="hidden" name="member" value={member} />
        <input type="hidden" name="item" value={itemFilter} />
        {itemFilter && <a href={buildListUrl("/inventory/lending", { q: search, status: statusParam, tag: tagFilter, member, ...rp })} class="badge badge-neutral gap-1">{rows.find((r) => r.lendingItem.id === itemFilter)?.lendingItem.inventoryItem.name ?? "?"} ✕</a>}
        <ToggleFilter items={pairToggles(member,
          [{ value: "yes", label: t("common.filter.members") }, { value: "no", label: t("common.filter.external") }],
          (m) => buildListUrl("/inventory/lending", { item: itemFilter, q: search, status: statusParam, tag: tagFilter, ...rp }, { member: m }))} />
        <QuickRangeFilter presets={presets} range={range} dir="future" action="/inventory/lending" bare
          href={(p) => buildListUrl("/inventory/lending", { item: itemFilter, q: search, status: statusParam, tag: tagFilter, member }, p)} />
        {hasFilter && <a href="/inventory/lending" class="btn btn-ghost">{t("lending.overview.rangeReset")}</a>}
      </form>

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
                          {r.conflict && <span class="inline-block mr-1 align-text-bottom text-warning" title={t("lending.overview.conflict")}><Icon name="exclamation-triangle" class="w-4 h-4" /><span class="sr-only">{t("lending.overview.conflict")}</span></span>}
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

function LoanPage({ loan, item }: { loan: LoanWithBorrower; item: LendingItemWithRelations }) {
  const base = `/inventory/lending/loans/${loan.id}`;
  const today = new Date().toISOString().slice(0, 10);
  const state = loanStatus(loan, today);
  const maxQuantity = Math.max(1, item.inventoryItem.quantity - item.inventoryItem.retiredQuantity);
  return (
    <>
      <PageHeader title={<a href={`/inventory/${item.inventoryItem.id}`} class="link link-hover">{item.inventoryItem.name}</a>} backHref="/inventory/lending" backLabel={t("lending.loans.backToList")} actions={<>
        <HeaderAction icon="trash" label={t("common.delete")} class="btn-outline btn-error mr-6" onclick="document.getElementById('delete-loan-modal').showModal()" />
        <HeaderAction variant="primary" icon="check" label={t("common.save")} form="loan-form" class="btn-primary" />
      </>} />
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

      <div class="space-y-4 max-w-xl">
        <form id="loan-form" method="post" action={base} class="space-y-4 border border-base-300 rounded-box p-4">
          {!item.individualTracking && (
            <Field label={t("lending.loans.form.quantity")} class="max-w-32">
              <input type="number" name="quantity" min="1" max={maxQuantity} value={String(loan.quantity)} class="input w-full" placeholder={t("lending.loans.form.quantity")} />
            </Field>
          )}
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(["plannedFrom", "plannedTo", "pickedUpAt", "returnedAt"] as const).map((f) => (
              <Field label={t(`lending.loans.form.${f}`)} required={f === "plannedFrom" || f === "plannedTo"}>
                <input type="date" name={f} value={loan[f] ?? ""} required={f === "plannedFrom" || f === "plannedTo"} class="input w-full" />
              </Field>
            ))}
            <Field label={t("lend.form.plannedFromTime")}>
              <input type="time" name="plannedFromTime" value={loan.plannedFromTime?.slice(0, 5) ?? ""} class="input w-full" />
            </Field>
            <Field label={t("lend.form.plannedToTime")}>
              <input type="time" name="plannedToTime" value={loan.plannedToTime?.slice(0, 5) ?? ""} class="input w-full" />
            </Field>
          </div>
          <div class="flex gap-2 pt-2">
            <button type="reset" class="btn btn-ghost">{t("common.reset")}</button>
          </div>
        </form>
      </div>

      <dialog id="delete-loan-modal" class="modal">
        <div class="modal-box">
          <h3 class="font-bold text-lg">{t("lending.loans.actions.deleteTitle")}</h3>
          <p class="py-2 opacity-70">{t("lending.loans.actions.deleteBody", { borrower: borrowerLabel(loan), name: item.inventoryItem.name })}</p>
          <div class="modal-action">
            <form method="dialog"><button class="btn">{t("common.cancel")}</button></form>
            <form method="post" action={`${base}/delete`}><button type="submit" class="btn btn-error">{t("common.delete")}</button></form>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop"><button>{t("common.close")}</button></form>
      </dialog>
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

function LoanForm({ action, item, items, values, errors, maxQuantity }: {
  action: string;
  item?: LendingItemWithRelations;
  // Gesetzt = Gegenstand-Auswahl im Formular (Einstieg ohne Item im Pfad).
  items?: LendingItemWithRelations[];
  values?: Partial<{ quantity: string; plannedFrom: string; plannedTo: string; plannedFromTime: string; plannedToTime: string; pickedUpAt: string; returnedAt: string; borrowerPersonId: string }> & BorrowerValues;
  errors?: Record<string, string>;
  maxQuantity?: number;
}) {
  const v = values ?? {};
  return (
    <form id="loan-new-form" method="post" action={action} class="space-y-4 max-w-md">
      {items && (
        <Field label={t("lending.loans.form.item")}>
          <select name="lendingItemId" required class={`select w-full${errors?.item ? " select-error" : ""}`}>
            <option value="">{t("lending.loans.form.itemPlaceholder")}</option>
            {items.map((li) => (
              <option value={li.id} selected={item?.id === li.id}>{li.inventoryItem.name}</option>
            ))}
          </select>
          {errors?.item && <span class="text-error text-sm mt-1">{errors.item}</span>}
        </Field>
      )}
      <BorrowerPickerFields personId={v.borrowerPersonId} values={v} errors={errors} />

      {(items || !item?.individualTracking) && (
        <Field label={t("lending.loans.form.quantity")} class="max-w-32">
          <input type="number" name="quantity" min="1" max={maxQuantity} value={v.quantity ?? "1"} class={`input w-full${errors?.quantity ? " input-error" : ""}`} placeholder={t("lending.loans.form.quantity")} />
          {errors?.quantity && <span class="text-error text-sm mt-1">{errors.quantity}</span>}
        </Field>
      )}

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t("lending.loans.form.plannedFrom")} required>
          <input type="date" id="loan-plannedFrom" name="plannedFrom" oninput="document.getElementById('loan-takeFrom').disabled=!this.value" value={v.plannedFrom ?? ""} required class={`input w-full${errors?.plannedFrom ? " input-error" : ""}`} />
          {errors?.plannedFrom && <span class="text-error text-sm mt-1">{errors.plannedFrom}</span>}
        </Field>
        <Field label={t("lending.loans.form.plannedTo")} required>
          <input type="date" id="loan-plannedTo" name="plannedTo" oninput="document.getElementById('loan-takeTo').disabled=!this.value" value={v.plannedTo ?? ""} required class={`input w-full${errors?.plannedTo ? " input-error" : ""}`} />
          {errors?.plannedTo && <span class="text-error text-sm mt-1">{errors.plannedTo}</span>}
        </Field>
        <Field label={t("lend.form.plannedFromTime")}>
          <input type="time" name="plannedFromTime" value={v.plannedFromTime ?? ""} class={`input w-full${errors?.times ? " input-error" : ""}`} />
        </Field>
        <Field label={t("lend.form.plannedToTime")}>
          <input type="time" name="plannedToTime" value={v.plannedToTime ?? ""} class={`input w-full${errors?.times ? " input-error" : ""}`} />
        </Field>
        {errors?.times && <p class="text-error text-sm sm:col-span-2">{errors.times}</p>}
        <Field label={t("lending.loans.form.pickedUpAt")} after={
          <button type="button" id="loan-takeFrom" disabled={!v.plannedFrom} class="btn min-h-11 w-full mt-2" onclick="document.getElementById('loan-pickedUpAt').value=document.getElementById('loan-plannedFrom').value">
            <Icon name="arrow-up" class="w-4 h-4" />
            {t("lending.loans.form.takeOverFrom")}
          </button>
        }>
          <input type="date" id="loan-pickedUpAt" name="pickedUpAt" value={v.pickedUpAt ?? ""} class="input w-full" />
        </Field>
        <Field label={t("lending.loans.form.returnedAt")} after={
          <button type="button" id="loan-takeTo" disabled={!v.plannedTo} class="btn min-h-11 w-full mt-2" onclick="document.getElementById('loan-returnedAt').value=document.getElementById('loan-plannedTo').value">
            <Icon name="arrow-up" class="w-4 h-4" />
            {t("lending.loans.form.takeOverTo")}
          </button>
        }>
          <input type="date" id="loan-returnedAt" name="returnedAt" value={v.returnedAt ?? ""} class="input w-full" />
        </Field>
      </div>
      {errors?.dates && <p class="text-error text-sm" role="alert">{errors.dates}</p>}
      {errors?.conflict && <p class="text-error text-sm" role="alert">{errors.conflict}</p>}
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

async function createLoan(c: Context<{ Variables: Variables }>, itemId: string) {
  const item = itemId ? await fetchLendingItem(itemId) : undefined;
  if (item?.inventoryItem.retiredAt) return c.notFound();

  const body = await c.req.parseBody();
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
    const existingLoans = await fetchLoans(item.id);
    const conflict = checkAvailability(item, existingLoans, { plannedFrom, plannedTo, plannedFromTime, plannedToTime, pickedUpAt, returnedAt, quantity });
    if (conflict) errors.conflict = conflict;
  }

  if (Object.keys(errors).length > 0) {
    const user = c.get("user")!;
    const values = { quantity: String(quantity), plannedFrom: plannedFrom ?? "", plannedTo: plannedTo ?? "", plannedFromTime: plannedFromTime ?? "", plannedToTime: plannedToTime ?? "", pickedUpAt: pickedUpAt ?? "", returnedAt: returnedAt ?? "", borrowerPersonId, ...person };
    return c.html(
      <Layout title={t("lending.newLoan.title")} user={user}>
        <div class="max-w-md mx-auto">
          <NewLoanHeader />
          <LoanForm action="/inventory/lending/loans" item={item} items={await fetchLendableItems()} values={values} errors={errors} />
        </div>
      </Layout>,
      422
    );
  }

  await db.transaction(async (tx) => {
    // Gewählte Person: Kontakt/Name wie im Spender-Formular direkt an der Person korrigieren.
    let personId = borrowerPersonId;
    const columns = { firstName: person.firstName, lastName: person.lastName, companyName: person.companyName || null, email: person.email || null, phone: person.phone || null };
    if (personId) await tx.update(persons).set(columns).where(eq(persons.id, personId));
    else [{ id: personId }] = await tx.insert(persons).values(columns).returning({ id: persons.id });
    await tx.insert(lendingLoans).values({
      lendingItemId: item!.id,
      quantity,
      borrowerPersonId: personId,
      plannedFrom,
      plannedTo,
      plannedFromTime,
      plannedToTime,
      pickedUpAt,
      returnedAt,
    });
  });

  setFlash(c, t("lending.loans.flash.created"), "success");
  return c.redirect(`/inventory/lending?item=${item!.id}&start=&end=`);
}

// GET /inventory/lending/search-persons — Mitglieder und frühere Ausleiher (keine reinen
// Spender/Antragsteller). Treffer tragen die vier bearbeitbaren Felder.
lendingRoutes.get("/search-persons", requireAuth("lending:manage"), async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.html("");

  const needle = `%${q}%`;
  const results = await db
    .select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName, email: persons.email, phone: persons.phone, companyName: persons.companyName })
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
        sub: [p.email, p.phone].filter(Boolean).join(" · ") || undefined,
        data: { firstName: p.firstName, lastName: p.lastName, companyName: p.companyName, email: p.email, phone: p.phone },
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
  const items = await fetchLendableItems();
  const selected = items.find((li) => li.id === c.req.query("item"));
  return c.html(
    <Layout title={t("lending.newLoan.title")} user={user}>
      <div class="max-w-md mx-auto">
        <NewLoanHeader />
        <LoanForm action="/inventory/lending/loans" item={selected} items={items} />
      </div>
    </Layout>
  );
});

lendingRoutes.post("/loans", requireAuth("lending:manage"), async (c) => {
  const body = await c.req.parseBody();
  return createLoan(c, trimmed(body, "lendingItemId"));
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
    return c.redirect(`/inventory/lending/loans/${loan.id}`);
  }

  await db.update(lendingLoans).set(patch).where(eq(lendingLoans.id, loan.id));
  setFlash(c, t("lending.loans.flash.updated"), "success");
  return c.redirect(`/inventory/lending?item=${item.id}&start=&end=`);
}

lendingRoutes.post("/loans/:loanId", requireAuth("lending:manage"), (c) => saveLoan(c, c.req.param("loanId")));

lendingRoutes.post("/loans/:loanId/delete", requireAuth("lending:manage"), async (c) => {
  const found = await loadLoanWithItem(c.req.param("loanId"));
  if (!found) return c.notFound();
  await db.delete(lendingLoans).where(eq(lendingLoans.id, found.loan.id));
  setFlash(c, t("lending.loans.flash.deleted"), "success");
  return c.redirect(`/inventory/lending?item=${found.item.id}&start=&end=`);
});
