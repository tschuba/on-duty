import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { inventoryItems, inventoryItemTags, lendingItems, lendingLoans, members } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { QuickRangeFilter } from "../components/quick-range-filter.js";
import { rangePresets, todayStr } from "../lib/quick-range.js";
import { MemberMark, MemberLink, MemberFilter } from "../components/member-mark.js";
import { MultiSelectFilter } from "../components/multi-select-filter.js";
import { buildListUrl, parseMulti } from "../lib/list-query.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { formatDate } from "../lib/format.js";
import { trimmed } from "../lib/forms.js";
import { effectiveRange, rangesOverlap, countOverdueLoans, loanStatus, validateLoanDates, safeReturnTo, type LoanRange, type LoanStatus } from "../lib/lending.js";
import { InventoryTabs, CATEGORIES, CATEGORY_LABELS } from "./inventory.js";
import { countOverdueInspectionItems } from "../lib/inventory.js";
import { SEARCH_DEBOUNCE_MS } from "../lib/constants.js";

export const lendingRoutes = new Hono<{ Variables: Variables }>();

// ── Types ────────────────────────────────────────────────────────────────────

type InventoryItemRow = typeof inventoryItems.$inferSelect;
type LendingItemRow = typeof lendingItems.$inferSelect;
type LoanRow = typeof lendingLoans.$inferSelect;
type Tag = typeof inventoryItemTags.$inferSelect;
type MemberRow = typeof members.$inferSelect;
type Person = { firstName: string; lastName: string };
type LendingItemWithRelations = LendingItemRow & {
  inventoryItem: InventoryItemRow & { tags: Tag[] };
};
type LoanWithBorrower = LoanRow & { borrowerMember: (MemberRow & { person: Person }) | null };

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
    with: { borrowerMember: { with: { person: true } } },
  }) as unknown as Promise<LoanWithBorrower[]>;
}

async function fetchLoan(id: string): Promise<LoanWithBorrower | undefined> {
  return db.query.lendingLoans.findFirst({
    where: eq(lendingLoans.id, id),
    with: { borrowerMember: { with: { person: true } } },
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
      borrowerMember: { with: { person: true } },
      lendingItem: { with: { inventoryItem: { with: { tags: true } } } },
    },
  }) as unknown as Promise<(LoanWithBorrower & { lendingItem: LendingItemWithRelations })[]>;
}

function formatMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  const names = ["month.january", "month.february", "month.march", "month.april", "month.may", "month.june",
    "month.july", "month.august", "month.september", "month.october", "month.november", "month.december"] as const;
  return `${t(names[parseInt(m, 10) - 1])} ${y}`;
}

function borrowerLabel(l: LoanWithBorrower): string {
  return l.borrowerMember ? `${l.borrowerMember.person.firstName} ${l.borrowerMember.person.lastName}` : l.borrowerName || "—";
}

lendingRoutes.get("/", requireAuth("lending:read"), async (c) => {
  const user = c.get("user")!;
  const today = new Date().toISOString().slice(0, 10);
  const search = (c.req.query("q") ?? "").trim();
  const statusFilter = parseMulti(c.req.queries("status"), Object.keys(LOAN_STATUS_LABEL)) as LoanStatus[];
  const categoryFilter = parseMulti(c.req.queries("category"), CATEGORIES);
  const start = c.req.query("start") ?? "";
  const end = c.req.query("end") ?? "";
  const member = c.req.query("member") === "yes" || c.req.query("member") === "no" ? c.req.query("member")! : "";
  const canLink = user.permissions.has("members:read");
  const rangeMode = Boolean(start || end);
  const needle = search.toLowerCase();

  const all = await fetchAllLoans();

  const filtered = all.filter((l) => {
    if (rangeMode) {
      const date = l.plannedFrom ?? l.pickedUpAt ?? l.plannedTo ?? l.returnedAt ?? "";
      if ((start && date < start) || (end && date > end)) return false;
    } else if (l.returnedAt) {
      const nearDate = l.plannedFrom ?? l.pickedUpAt ?? "";
      if (nearDate < addDays(today, -14) || nearDate > addDays(today, 30)) return false;
    }
    if (statusFilter.length > 0 && !statusFilter.includes(loanStatus(l, today))) return false;
    if (categoryFilter.length > 0 && !categoryFilter.includes(l.lendingItem.inventoryItem.category)) return false;
    if (member && Boolean(l.borrowerMember) !== (member === "yes")) return false;
    if (needle && !`${l.lendingItem.inventoryItem.name} ${borrowerLabel(l)}`.toLowerCase().includes(needle)) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const da = a.plannedFrom ?? a.pickedUpAt ?? "";
    const db_ = b.plannedFrom ?? b.pickedUpAt ?? "";
    return da.localeCompare(db_);
  });

  const groups = new Map<string, typeof sorted>();
  for (const l of sorted) {
    const date = l.plannedFrom ?? l.pickedUpAt ?? l.plannedTo ?? l.returnedAt ?? "0000-00";
    const key = date.slice(0, 7);
    let bucket = groups.get(key);
    if (!bucket) { bucket = []; groups.set(key, bucket); }
    bucket.push(l);
  }

  const presets = rangePresets(today, "future");
  const hasFilter = Boolean(search || statusFilter.length || categoryFilter.length || member || rangeMode);
  const canManage = user.permissions.has("lending:manage");
  const returnTo = currentPath(c.req.url);

  return c.html(
    <Layout title={t("lending.title")} user={user} activeNav="inventory">
      <InventoryTabs
        active="lending"
        overdueCount={await countOverdueInspectionItems()}
        overdueLoanCount={await countOverdueLoans()}
        showLending
      />
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">{t("lending.title")}</h1>
        {user.permissions.has("lending:manage") && <a href="/inventory/lending/loans/new" class="btn btn-primary">{t("lending.newLoan")}</a>}
      </div>

      <form method="get" action="/inventory/lending" class="flex gap-2 items-center flex-wrap mb-4">
        <input type="search" name="q" value={search} placeholder={t("lending.filter.searchPlaceholder")} class="input input-bordered w-56" />
        <MultiSelectFilter
          param="status"
          options={(Object.keys(LOAN_STATUS_LABEL) as LoanStatus[]).map((s) => ({ value: s, label: LOAN_STATUS_LABEL[s] }))}
          selected={statusFilter}
          allLabel={t("lending.filter.allStatus")}
          countLabel={(count) => t("lending.filter.statusCount", { count })}
          applyLabel={t("common.apply")}
          resetLabel={t("common.reset")}
        />
        <MultiSelectFilter
          param="category"
          options={CATEGORIES.map((cat) => ({ value: cat, label: CATEGORY_LABELS[cat] }))}
          selected={categoryFilter}
          allLabel={t("lending.filter.allCategories")}
          countLabel={(count) => t("lending.filter.categoryCount", { count })}
          applyLabel={t("common.apply")}
          resetLabel={t("common.reset")}
        />
        <input type="hidden" name="member" value={member} />
        <MemberFilter
          value={member}
          options={[{ value: "", label: t("common.filter.all") }, { value: "yes", label: t("common.filter.members") }, { value: "no", label: t("common.filter.external") }]}
          href={(m) => buildListUrl("/inventory/lending", { q: search, status: statusFilter, category: categoryFilter, start, end }, { member: m })}
        />
        <QuickRangeFilter presets={presets} start={start} end={end} href={(p) => buildListUrl("/inventory/lending", { q: search, status: statusFilter, category: categoryFilter, member }, { start: p.start, end: p.end })} />
        <input type="date" name="start" value={start} class="input input-bordered w-36" placeholder={t("lending.overview.rangeStart")} />
        <span class="text-base-content/50">–</span>
        <input type="date" name="end" value={end} class="input input-bordered w-36" placeholder={t("lending.overview.rangeEnd")} />
        <button type="submit" class="btn btn-outline">{t("lending.overview.rangeApply")}</button>
        {hasFilter && <a href="/inventory/lending" class="btn btn-ghost">{t("lending.overview.rangeReset")}</a>}
      </form>

      {sorted.length === 0 ? (
        <p class="text-base-content/60 py-8">{t("lending.overview.empty")}</p>
      ) : (
        <div class="overflow-x-auto">
          <table class="table table-zebra w-full [&_tbody_td]:border-b-0">
            <tbody>
              {[...groups.entries()].map(([month, loans], i) => (
                <>
                  <tr>
                    <td colspan={5} class={`text-base font-semibold text-base-content/70 pb-1${i > 0 ? " pt-8" : " pt-2"}`}>
                      {formatMonth(month)}
                    </td>
                  </tr>
                  {loans.map((l, idx) => {
                    const loanState = loanStatus(l, today);
                    const date = l.plannedFrom ?? l.pickedUpAt ?? "";
                    const border = idx > 0 ? " border-t border-base-300" : "";
                    return (
                      <tr
                        key={l.id}
                        class={`cursor-pointer hover${loanState === "overdue" ? " text-error" : ""}`}
                        {...(canManage ? loanDialogTrigger(l.id, returnTo) : { onclick: `window.location='/inventory/lending/${l.lendingItem.id}/loans'` })}
                      >
                        <td class={`whitespace-nowrap text-sm pl-6${border}`}>{formatDate(date)}</td>
                        <td class={border}>{l.lendingItem.inventoryItem.name}</td>
                        <td class={border}><MemberLink memberId={l.borrowerMember?.id} canLink={canLink}>{borrowerLabel(l)}</MemberLink><MemberMark memberId={l.borrowerMember?.id} canLink={canLink} /></td>
                        <td class={border}><span class={LOAN_STATUS_BADGE[loanState]}>{LOAN_STATUS_LABEL[loanState]}</span></td>
                        <td class={`text-sm${border}`}>{formatDate(l.plannedFrom)} – {formatDate(l.plannedTo)}</td>
                      </tr>
                    );
                  })}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage && <LoanDialog />}
    </Layout>
  );
});

// ── Aktions-Popup ────────────────────────────────────────────────────────────
// Ein geteilter <dialog> pro Seite; Inhalt kommt als HTMX-Fragment von
// GET /loans/:loanId/:view. returnTo (Allowlist in safeReturnTo) bestimmt, wohin
// nach Erfolg zurückgeleitet wird.

const LOAN_DIALOG_ID = "loan-dialog";
const LOAN_DIALOG_BODY_ID = "loan-dialog-body";

function currentPath(url: string): string {
  const u = new URL(url);
  return u.pathname + u.search;
}

function loanDialogTrigger(loanId: string, returnTo: string) {
  return {
    "hx-get": `/inventory/lending/loans/${loanId}/actions?returnTo=${encodeURIComponent(returnTo)}`,
    "hx-target": `#${LOAN_DIALOG_BODY_ID}`,
    "hx-on::after-request": `document.getElementById('${LOAN_DIALOG_ID}').showModal()`,
  };
}

function LoanDialog() {
  return (
    <dialog id={LOAN_DIALOG_ID} class="modal">
      <div class="modal-box">
        <div id={LOAN_DIALOG_BODY_ID} hx-target={`#${LOAN_DIALOG_BODY_ID}`} />
      </div>
      <form method="dialog" class="modal-backdrop"><button>{t("common.close")}</button></form>
    </dialog>
  );
}

type LoanDialogView = "actions" | "pickup" | "return" | "edit" | "delete";
const LOAN_DIALOG_VIEWS: LoanDialogView[] = ["actions", "pickup", "return", "edit", "delete"];

function LoanDialogContent({ loan, item, returnTo, view, values, error }: {
  loan: LoanWithBorrower;
  item: LendingItemWithRelations;
  returnTo: string;
  view: LoanDialogView;
  values?: Partial<Record<"date" | "quantity" | "plannedFrom" | "plannedTo" | "pickedUpAt" | "returnedAt", string>>;
  error?: string;
}) {
  const base = `/inventory/lending/loans/${loan.id}`;
  const today = new Date().toISOString().slice(0, 10);
  const state = loanStatus(loan, today);
  const v = values ?? {};
  const q = `?returnTo=${encodeURIComponent(returnTo)}`;
  const maxQuantity = Math.max(1, item.inventoryItem.quantity - item.inventoryItem.retiredQuantity);
  const closeDialog = `document.getElementById('${LOAN_DIALOG_ID}').close()`;
  const back = (
    <button type="button" class="btn" hx-get={`${base}/actions${q}`}>{t("lending.loans.actions.back")}</button>
  );
  const returnToField = <input type="hidden" name="returnTo" value={returnTo} />;
  const errorLine = error && <p class="text-error text-sm mt-2">{error}</p>;
  const dateForm = (name: "pickedUpAt" | "returnedAt", action: "pickup" | "return") => (
    <form hx-post={`${base}/${action}`} class="space-y-2">
      {returnToField}
      <label class="label"><span class="label-text">{t(name === "pickedUpAt" ? "lending.loans.form.pickedUpAt" : "lending.loans.form.returnedAt")}</span></label>
      <input type="date" name={name} value={v.date ?? today} required class="input input-bordered w-full" />
      {errorLine}
      <div class="modal-action">
        {back}
        <button type="submit" class="btn btn-primary">{t("lending.loans.form.save")}</button>
      </div>
    </form>
  );

  return (
    <div>
      <h3 class="font-bold text-lg">{item.inventoryItem.name}</h3>
      <p class="py-1 opacity-70">
        {borrowerLabel(loan)} · <span class={LOAN_STATUS_BADGE[state]}>{LOAN_STATUS_LABEL[state]}</span>
      </p>

      {view === "actions" && (
        <>
          <div class="flex flex-col gap-2 mt-2">
            {!loan.pickedUpAt && !loan.returnedAt && (
              <button type="button" class="btn btn-outline" hx-get={`${base}/pickup${q}`}>{t("lending.loans.actions.pickup")}</button>
            )}
            {loan.pickedUpAt && !loan.returnedAt && (
              <button type="button" class="btn btn-outline" hx-get={`${base}/return${q}`}>{t("lending.loans.actions.return")}</button>
            )}
            <button type="button" class="btn btn-outline" hx-get={`${base}/edit${q}`}>{t("lending.loans.actions.edit")}</button>
            <button type="button" class="btn btn-outline btn-error" hx-get={`${base}/delete${q}`}>{t("lending.loans.actions.delete")}</button>
            {!returnTo.startsWith(`/inventory/lending/${item.id}/loans`) && (
              <a href={`/inventory/lending/${item.id}/loans`} class="link link-hover text-sm">{t("lending.loans.actions.allLoans")}</a>
            )}
          </div>
          <div class="modal-action">
            <button type="button" class="btn" onclick={closeDialog}>{t("common.close")}</button>
          </div>
        </>
      )}

      {view === "pickup" && dateForm("pickedUpAt", "pickup")}
      {view === "return" && dateForm("returnedAt", "return")}

      {view === "edit" && (
        <form hx-post={base} class="space-y-2">
          {returnToField}
          {!item.individualTracking && (
            <div class="form-control max-w-32">
              <label class="label"><span class="label-text">{t("lending.loans.form.quantity")}</span></label>
              <input type="number" name="quantity" min="1" max={maxQuantity} value={v.quantity ?? String(loan.quantity)} class="input input-bordered w-full" />
            </div>
          )}
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(["plannedFrom", "plannedTo", "pickedUpAt", "returnedAt"] as const).map((f) => (
              <div class="form-control">
                <label class="label"><span class="label-text">{t(`lending.loans.form.${f}`)}</span></label>
                <input type="date" name={f} value={v[f] ?? loan[f] ?? ""} class="input input-bordered w-full" />
              </div>
            ))}
          </div>
          {errorLine}
          <div class="modal-action">
            {back}
            <button type="submit" class="btn btn-primary">{t("lending.loans.form.save")}</button>
          </div>
        </form>
      )}

      {view === "delete" && (
        <form hx-post={`${base}/delete`}>
          {returnToField}
          <p class="py-2">{t("lending.loans.actions.deleteBody", { borrower: borrowerLabel(loan), name: item.inventoryItem.name })}</p>
          <div class="modal-action">
            {back}
            <button type="submit" class="btn btn-error">{t("lending.loans.actions.deleteConfirm")}</button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Verleihvorgänge zu einem Gegenstand ─────────────────────────────────────

function BorrowerPickerFields({ memberId, memberName, name, contact }: {
  memberId?: string;
  memberName?: string;
  name?: string;
  contact?: string;
}) {
  const isMember = Boolean(memberId);
  return (
    <div class="form-control space-y-2">
      <label class="label"><span class="label-text">{t("lending.loans.form.borrowerType")}</span></label>
      <div class="join">
        <label class="join-item btn has-[:checked]:btn-outline has-[:checked]:btn-primary">
          <input type="radio" name="borrowerType" value="member" checked={isMember || (!name && !contact)} class="hidden" onchange="updateBorrowerTypeVisibility()" />
          {t("lending.loans.form.borrowerTypeMember")}
        </label>
        <label class="join-item btn has-[:checked]:btn-outline has-[:checked]:btn-primary">
          <input type="radio" name="borrowerType" value="external" checked={!isMember && Boolean(name || contact)} class="hidden" onchange="updateBorrowerTypeVisibility()" />
          {t("lending.loans.form.borrowerTypeExternal")}
        </label>
      </div>

      <div id="borrower-member-fields" class="space-y-2">
        <div id="borrower-picker-search" class={isMember ? "hidden" : ""}>
          <input
            type="text"
            name="q"
            autocomplete="off"
            placeholder={t("lending.loans.form.borrowerSearchPlaceholder")}
            class="input input-bordered w-full"
            hx-get="/inventory/search-members?scope=all"
            hx-trigger={`input changed delay:${SEARCH_DEBOUNCE_MS}ms`}
            hx-target="#borrower-picker-results"
          />
          <div id="borrower-picker-results" class="mt-1 border border-base-300 rounded-box divide-y empty:border-none" />
        </div>
        <input type="hidden" id="borrowerMemberId" name="borrowerMemberId" value={memberId ?? ""} />
        <div id="borrower-picker-selected" class={isMember ? "flex items-center gap-2" : "hidden flex items-center gap-2"}>
          <span id="borrower-picker-selected-name">{memberName ?? ""}</span>
          <button type="button" class="btn btn-ghost btn-sm borrower-picker-change">{t("inventory.form.assignedMemberChangeSelection")}</button>
        </div>
      </div>

      <div id="borrower-external-fields" class="space-y-2">
        <div class="form-control">
          <label class="label"><span class="label-text">{t("lending.loans.form.borrowerName")}</span></label>
          <input type="text" name="borrowerName" value={name ?? ""} class="input input-bordered w-full" />
        </div>
        <div class="form-control">
          <label class="label"><span class="label-text">{t("lending.loans.form.borrowerContact")}</span></label>
          <input type="text" name="borrowerContact" value={contact ?? ""} class="input input-bordered w-full" />
        </div>
      </div>

      <script dangerouslySetInnerHTML={{ __html: `
        function updateBorrowerTypeVisibility() {
          var isMember = document.querySelector('input[name=borrowerType]:checked')?.value !== 'external';
          document.getElementById('borrower-member-fields').classList.toggle('hidden', !isMember);
          document.getElementById('borrower-external-fields').classList.toggle('hidden', isMember);
        }
        updateBorrowerTypeVisibility();
        if (!window.__borrowerPickerBound) {
          window.__borrowerPickerBound = true;
          document.body.addEventListener('click', function(e) {
            var resEl = e.target.closest('#borrower-picker-results .member-result');
            if (resEl) {
              document.getElementById('borrowerMemberId').value = resEl.dataset.id;
              document.getElementById('borrower-picker-selected-name').textContent = resEl.dataset.name;
              document.getElementById('borrower-picker-selected').classList.remove('hidden');
              document.getElementById('borrower-picker-search').classList.add('hidden');
              return;
            }
            if (e.target.closest('.borrower-picker-change')) {
              document.getElementById('borrowerMemberId').value = '';
              document.getElementById('borrower-picker-selected').classList.add('hidden');
              document.getElementById('borrower-picker-search').classList.remove('hidden');
              document.getElementById('borrower-picker-results').innerHTML = '';
              var input = document.querySelector('#borrower-picker-search input[type=text]');
              if (input) { input.value = ''; input.focus(); }
            }
          });
        }
      ` }} />
    </div>
  );
}

function LoanForm({ action, item, items, values, errors, maxQuantity, memberName }: {
  action: string;
  item?: LendingItemWithRelations;
  // Gesetzt = Gegenstand-Auswahl im Formular (Einstieg ohne Item im Pfad).
  items?: LendingItemWithRelations[];
  values?: Partial<{ quantity: string; plannedFrom: string; plannedTo: string; pickedUpAt: string; returnedAt: string; borrowerMemberId: string; borrowerName: string; borrowerContact: string }>;
  errors?: Record<string, string>;
  maxQuantity?: number;
  memberName?: string;
}) {
  const v = values ?? {};
  return (
    <form method="post" action={action} class="space-y-4 max-w-xl border border-base-300 rounded-box p-4">
      {items && (
        <div class="form-control">
          <label class="label"><span class="label-text">{t("lending.loans.form.item")}</span></label>
          <select name="lendingItemId" required class={`select select-bordered w-full${errors?.item ? " select-error" : ""}`}>
            <option value="">{t("lending.loans.form.itemPlaceholder")}</option>
            {items.map((li) => (
              <option value={li.id} selected={item?.id === li.id}>{li.inventoryItem.name}</option>
            ))}
          </select>
          {errors?.item && <span class="text-error text-sm mt-1">{errors.item}</span>}
        </div>
      )}
      <BorrowerPickerFields memberId={v.borrowerMemberId} memberName={memberName} name={v.borrowerName} contact={v.borrowerContact} />
      {errors?.borrower && <span class="text-error text-sm">{errors.borrower}</span>}

      {(items || !item?.individualTracking) && (
        <div class="form-control max-w-32">
          <label class="label"><span class="label-text">{t("lending.loans.form.quantity")}</span></label>
          <input type="number" name="quantity" min="1" max={maxQuantity} value={v.quantity ?? "1"} class={`input input-bordered w-full${errors?.quantity ? " input-error" : ""}`} />
          {errors?.quantity && <span class="text-error text-sm mt-1">{errors.quantity}</span>}
        </div>
      )}

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="form-control">
          <label class="label"><span class="label-text">{t("lending.loans.form.plannedFrom")}</span></label>
          <input type="date" id="loan-plannedFrom" name="plannedFrom" value={v.plannedFrom ?? ""} class="input input-bordered w-full" />
        </div>
        <div class="form-control">
          <label class="label"><span class="label-text">{t("lending.loans.form.plannedTo")}</span></label>
          <input type="date" id="loan-plannedTo" name="plannedTo" value={v.plannedTo ?? ""} class="input input-bordered w-full" />
        </div>
        <div class="form-control">
          <label class="label"><span class="label-text">{t("lending.loans.form.pickedUpAt")}</span></label>
          <input type="date" id="loan-pickedUpAt" name="pickedUpAt" value={v.pickedUpAt ?? ""} class="input input-bordered w-full" />
          <button type="button" class="btn btn-ghost btn-xs mt-1 w-fit" onclick="document.getElementById('loan-pickedUpAt').value=document.getElementById('loan-plannedFrom').value">
            {t("lending.loans.form.takeOverFrom")}
          </button>
        </div>
        <div class="form-control">
          <label class="label"><span class="label-text">{t("lending.loans.form.returnedAt")}</span></label>
          <input type="date" id="loan-returnedAt" name="returnedAt" value={v.returnedAt ?? ""} class="input input-bordered w-full" />
          <button type="button" class="btn btn-ghost btn-xs mt-1 w-fit" onclick="document.getElementById('loan-returnedAt').value=document.getElementById('loan-plannedTo').value">
            {t("lending.loans.form.takeOverTo")}
          </button>
        </div>
      </div>
      {errors?.dates && <span class="text-error text-sm">{errors.dates}</span>}
      {errors?.conflict && <span class="text-error text-sm">{errors.conflict}</span>}

      <button type="submit" class="btn btn-primary">{t("lending.loans.form.save")}</button>
    </form>
  );
}

lendingRoutes.get("/:id/loans", requireAuth("lending:read"), async (c) => {
  const user = c.get("user")!;
  const item = await fetchLendingItem(c.req.param("id"));
  if (!item) return c.notFound();
  const loans = await fetchLoans(item.id);
  const today = new Date().toISOString().slice(0, 10);
  const assignedTotal = loans
    .filter((l) => !l.returnedAt)
    .reduce((sum, l) => sum + l.quantity, 0);
  const maxQuantity = Math.max(1, item.inventoryItem.quantity - item.inventoryItem.retiredQuantity);
  const canManage = user.permissions.has("lending:manage");
  const canLink = user.permissions.has("members:read");
  const returnTo = currentPath(c.req.url);

  const sorted = [...loans].sort((a, b) => (b.plannedFrom ?? b.pickedUpAt ?? "").localeCompare(a.plannedFrom ?? a.pickedUpAt ?? ""));

  return c.html(
    <Layout title={item.inventoryItem.name} user={user} activeNav="inventory">
      <div class="mb-4">
        <a href="/inventory/lending" class="link link-hover text-sm opacity-70">{t("lending.loans.backToList")}</a>
        <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{item.inventoryItem.name}</h1>
      </div>

      {item.inventoryItem.retiredAt && (
        <div class="alert alert-warning max-w-2xl mb-4">{t("lending.retired.notice")}</div>
      )}

      {!item.inventoryItem.retiredAt && canManage && (
        <div class="mb-6">
          <LoanForm action={`/inventory/lending/${item.id}/loans`} item={item} maxQuantity={maxQuantity} />
        </div>
      )}

      <h2 class="text-lg font-semibold mb-2">{t("lending.loans.title")}</h2>
      <table class="table table-zebra w-full">
        <thead>
          <tr>
            <th>{t("lending.loans.table.borrower")}</th>
            {!item.individualTracking && <th>{t("lending.loans.table.quantity")}</th>}
            <th>{t("lending.loans.table.plannedFrom")}</th>
            <th>{t("lending.loans.table.plannedTo")}</th>
            <th>{t("lending.loans.table.pickedUpAt")}</th>
            <th>{t("lending.loans.table.returnedAt")}</th>
            {canManage && <th />}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colspan={(item.individualTracking ? 5 : 6) + (canManage ? 1 : 0)} class="text-center opacity-50 py-8">{t("lending.loans.table.empty")}</td></tr>
          ) : sorted.map((l) => {
            const overdue = Boolean(l.plannedTo && l.plannedTo < today && !l.returnedAt);
            const borrower = borrowerLabel(l);
            return (
              <tr key={l.id} class={overdue ? "text-error font-semibold" : ""}>
                <td><MemberLink memberId={l.borrowerMember?.id} canLink={canLink}>{borrower}</MemberLink><MemberMark memberId={l.borrowerMember?.id} canLink={canLink} />{overdue && <span class="badge badge-error badge-sm ml-1">{t("lending.loans.overdue")}</span>}</td>
                {!item.individualTracking && <td>{l.quantity}</td>}
                <td>{formatDate(l.plannedFrom)}</td>
                <td>{formatDate(l.plannedTo)}</td>
                <td>{formatDate(l.pickedUpAt)}</td>
                <td>{formatDate(l.returnedAt)}</td>
                {canManage && (
                  <td class="text-right">
                    <button type="button" class="btn btn-ghost btn-sm" {...loanDialogTrigger(l.id, returnTo)}>{t("lending.loans.actions.open")}</button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {canManage && <LoanDialog />}
    </Layout>
  );
});

// Verfügbarkeitsprüfung beim Anlegen — hart blockierend, siehe Backlog-Doc
// "Verfügbarkeitsprüfung". Einzel-Tracking: jede Überschneidung blockiert.
// Stückzahl: Summe der Mengen überlappender Vorgänge + neue Anfrage gegen
// quantity - retiredQuantity.
function checkAvailability(
  item: LendingItemWithRelations,
  existingLoans: LoanWithBorrower[],
  candidate: { plannedFrom: string | null; plannedTo: string | null; pickedUpAt: string | null; returnedAt: string | null; quantity: number },
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

// Gemeinsamer Anlage-Pfad für /:id/loans (Item im Pfad) und /loans (Item aus
// dem Formular, fromList). Unterschied nur: Fehlerseite und Redirect-Ziel.
async function createLoan(c: Context<{ Variables: Variables }>, itemId: string, fromList: boolean) {
  const item = itemId ? await fetchLendingItem(itemId) : undefined;
  if (!item && !fromList) return c.notFound();
  if (item?.inventoryItem.retiredAt) return c.notFound();

  const body = await c.req.parseBody();
  const borrowerType = trimmed(body, "borrowerType") || "member";
  const borrowerMemberId = borrowerType === "member" ? trimmed(body, "borrowerMemberId") : "";
  const borrowerName = borrowerType === "external" ? trimmed(body, "borrowerName") : "";
  const borrowerContact = borrowerType === "external" ? trimmed(body, "borrowerContact") : "";
  const plannedFrom = trimmed(body, "plannedFrom") || null;
  const plannedTo = trimmed(body, "plannedTo") || null;
  const pickedUpAt = trimmed(body, "pickedUpAt") || null;
  const returnedAt = trimmed(body, "returnedAt") || null;
  // Server erzwingt 1 bei Einzel-Tracking, auch falls im Formular manipuliert.
  const quantity = item?.individualTracking ? 1 : Math.max(1, Math.round(Number(trimmed(body, "quantity"))) || 1);

  const errors: Record<string, string> = {};
  if (!item) errors.item = t("lending.loans.error.itemRequired");
  if (!borrowerMemberId && !borrowerName) errors.borrower = t("lending.loans.error.borrowerRequired");
  if (item && !item.individualTracking && (!Number.isInteger(quantity) || quantity < 1)) errors.quantity = t("lending.loans.error.invalidQuantity");
  const dateError = validateLoanDates({ pickedUpAt, returnedAt });
  if (dateError) errors.dates = t(`lending.loans.error.${dateError}`);

  if (item) {
    const existingLoans = await fetchLoans(item.id);
    const conflict = checkAvailability(item, existingLoans, { plannedFrom, plannedTo, pickedUpAt, returnedAt, quantity });
    if (conflict) errors.conflict = conflict;
  }

  if (Object.keys(errors).length > 0) {
    const user = c.get("user")!;
    let memberName: string | undefined;
    if (borrowerMemberId) {
      const m = await db.query.members.findFirst({ where: eq(members.id, borrowerMemberId), with: { person: true } });
      memberName = m ? `${(m as any).person.firstName} ${(m as any).person.lastName}` : undefined;
    }
    const values = { quantity: String(quantity), plannedFrom: plannedFrom ?? "", plannedTo: plannedTo ?? "", pickedUpAt: pickedUpAt ?? "", returnedAt: returnedAt ?? "", borrowerMemberId, borrowerName, borrowerContact };
    if (fromList) {
      return c.html(
        <Layout title={t("lending.newLoan.title")} user={user} activeNav="inventory">
          <NewLoanHeader />
          <LoanForm action="/inventory/lending/loans" item={item} items={await fetchLendableItems()} values={values} errors={errors} memberName={memberName} />
        </Layout>,
        422
      );
    }
    const maxQuantity = Math.max(1, item!.inventoryItem.quantity - item!.inventoryItem.retiredQuantity);
    return c.html(
      <Layout title={item!.inventoryItem.name} user={user} activeNav="inventory">
        <div class="mb-4">
          <a href="/inventory/lending" class="link link-hover text-sm opacity-70">{t("lending.loans.backToList")}</a>
          <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{item!.inventoryItem.name}</h1>
        </div>
        <LoanForm action={`/inventory/lending/${item!.id}/loans`} item={item} maxQuantity={maxQuantity} values={values} errors={errors} memberName={memberName} />
      </Layout>,
      422
    );
  }

  await db.insert(lendingLoans).values({
    lendingItemId: item!.id,
    quantity,
    borrowerMemberId: borrowerMemberId || null,
    borrowerName: borrowerName || null,
    borrowerContact: borrowerContact || null,
    plannedFrom,
    plannedTo,
    pickedUpAt,
    returnedAt,
  });

  setFlash(c, t("lending.loans.flash.created"), "success");
  return c.redirect(fromList ? "/inventory/lending" : `/inventory/lending/${item!.id}/loans`);
}

function NewLoanHeader() {
  return (
    <div class="mb-4">
      <a href="/inventory/lending" class="link link-hover text-sm opacity-70">{t("lending.loans.backToList")}</a>
      <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{t("lending.newLoan.title")}</h1>
    </div>
  );
}

// GET /inventory/lending/loans/new?item=<lendingItemId> — Einstieg aus der Vorgangsliste
// (kein Item) und aus /inventory (Item vorausgewählt).
lendingRoutes.get("/loans/new", requireAuth("lending:manage"), async (c) => {
  const user = c.get("user")!;
  const items = await fetchLendableItems();
  const selected = items.find((li) => li.id === c.req.query("item"));
  return c.html(
    <Layout title={t("lending.newLoan.title")} user={user} activeNav="inventory">
      <NewLoanHeader />
      <LoanForm action="/inventory/lending/loans" item={selected} items={items} />
    </Layout>
  );
});

lendingRoutes.post("/loans", requireAuth("lending:manage"), async (c) => {
  const body = await c.req.parseBody();
  return createLoan(c, trimmed(body, "lendingItemId"), true);
});

lendingRoutes.post("/:id/loans", requireAuth("lending:manage"), (c) => createLoan(c, c.req.param("id"), false));

const isHtmx = (c: Context) => c.req.header("HX-Request") === "true";

// Erfolg: HTMX-Formulare im Popup folgen keinem 302 sinnvoll, daher HX-Redirect.
function finish(c: Context, returnTo: string) {
  if (isHtmx(c)) {
    c.header("HX-Redirect", returnTo);
    return c.body(null, 200);
  }
  return c.redirect(returnTo);
}

async function loadLoanWithItem(loanId: string) {
  const loan = await fetchLoan(loanId);
  const item = loan ? await fetchLendingItem(loan.lendingItemId) : undefined;
  return loan && item ? { loan, item } : undefined;
}

// GET /inventory/lending/loans/:loanId/:view — Popup-Fragment (HTMX).
lendingRoutes.get("/loans/:loanId/:view", requireAuth("lending:manage"), async (c) => {
  const view = c.req.param("view") as LoanDialogView;
  if (!LOAN_DIALOG_VIEWS.includes(view)) return c.notFound();
  const found = await loadLoanWithItem(c.req.param("loanId"));
  if (!found) return c.notFound();
  const returnTo = safeReturnTo(c.req.query("returnTo"), `/inventory/lending/${found.item.id}/loans`);
  return c.html(<LoanDialogContent {...found} returnTo={returnTo} view={view} />);
});

// Gemeinsamer Schreibpfad für Abholen, Zurückgeben und Bearbeiten. Datumsregeln
// gelten immer; die Verfügbarkeit nur, wenn sich Plan oder Menge ändern
// (Abholung/Rückgabe sind Tatsachen und werden nie blockiert).
async function saveLoan(c: Context<{ Variables: Variables }>, loanId: string, view: "pickup" | "return" | "edit") {
  const found = await loadLoanWithItem(loanId);
  if (!found) return c.notFound();
  const { loan, item } = found;

  const body = await c.req.parseBody();
  const returnTo = safeReturnTo(trimmed(body, "returnTo"), `/inventory/lending/${item.id}/loans`);
  const pick = (key: "plannedFrom" | "plannedTo" | "pickedUpAt" | "returnedAt") =>
    key in body ? trimmed(body, key) || null : loan[key];

  const patch =
    view === "pickup" ? { pickedUpAt: trimmed(body, "pickedUpAt") || null }
    : view === "return" ? { returnedAt: trimmed(body, "returnedAt") || null }
    : {
        plannedFrom: pick("plannedFrom"),
        plannedTo: pick("plannedTo"),
        pickedUpAt: pick("pickedUpAt"),
        returnedAt: pick("returnedAt"),
        quantity: item.individualTracking ? 1 : "quantity" in body ? Math.max(1, Math.round(Number(trimmed(body, "quantity"))) || 1) : loan.quantity,
      };
  const next = { ...loan, ...patch };

  let error: string | null = null;
  const dateError = validateLoanDates(next);
  if (dateError) error = t(`lending.loans.error.${dateError}`);
  else if (next.plannedFrom !== loan.plannedFrom || next.plannedTo !== loan.plannedTo || next.quantity !== loan.quantity) {
    error = checkAvailability(item, await fetchLoans(item.id), next, loan.id);
  }

  if (error) {
    if (!isHtmx(c)) {
      setFlash(c, error, "error");
      return c.redirect(returnTo);
    }
    // Status 200: HTMX tauscht 4xx-Antworten nicht ein, der Dialog soll offen bleiben.
    const values = { date: String(view === "pickup" ? next.pickedUpAt ?? "" : next.returnedAt ?? ""), quantity: String(next.quantity), plannedFrom: next.plannedFrom ?? "", plannedTo: next.plannedTo ?? "", pickedUpAt: next.pickedUpAt ?? "", returnedAt: next.returnedAt ?? "" };
    return c.html(<LoanDialogContent loan={loan} item={item} returnTo={returnTo} view={view} values={values} error={error} />);
  }

  await db.update(lendingLoans).set(patch).where(eq(lendingLoans.id, loan.id));
  setFlash(c, t("lending.loans.flash.updated"), "success");
  return finish(c, returnTo);
}

lendingRoutes.post("/loans/:loanId", requireAuth("lending:manage"), (c) => saveLoan(c, c.req.param("loanId"), "edit"));
lendingRoutes.post("/loans/:loanId/pickup", requireAuth("lending:manage"), (c) => saveLoan(c, c.req.param("loanId"), "pickup"));
lendingRoutes.post("/loans/:loanId/return", requireAuth("lending:manage"), (c) => saveLoan(c, c.req.param("loanId"), "return"));

lendingRoutes.post("/loans/:loanId/delete", requireAuth("lending:manage"), async (c) => {
  const found = await loadLoanWithItem(c.req.param("loanId"));
  if (!found) return c.notFound();
  const body = await c.req.parseBody();
  await db.delete(lendingLoans).where(eq(lendingLoans.id, found.loan.id));
  setFlash(c, t("lending.loans.flash.deleted"), "success");
  return finish(c, safeReturnTo(trimmed(body, "returnTo"), `/inventory/lending/${found.item.id}/loans`));
});
