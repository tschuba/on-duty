import { Hono, type Context } from "hono";
import { and, asc, eq, exists, ilike, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { inventoryItems, inventoryItemTags, lendingItems, lendingLoans, members, persons } from "../db/schema/index.js";
import { Icon } from "../components/icon.js";
import { FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
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
import { effectiveRange, rangesOverlap, countOverdueLoans, loanStatus, validateLoanDates, type LoanRange, type LoanStatus } from "../lib/lending.js";
import { InventoryTabs, CATEGORIES, CATEGORY_LABELS } from "./inventory.js";
import { countOverdueInspectionItems } from "../lib/inventory.js";
import { SEARCH_DEBOUNCE_MS } from "../lib/constants.js";

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

function personName(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

function borrowerLabel(l: LoanWithBorrower): string {
  return personName(l.borrower) || "—";
}

lendingRoutes.get("/", requireAuth("lending:read"), async (c) => {
  const user = c.get("user")!;
  const today = new Date().toISOString().slice(0, 10);
  const search = (c.req.query("q") ?? "").trim();
  const statusFilter = parseMulti(c.req.queries("status"), Object.keys(LOAN_STATUS_LABEL)) as LoanStatus[];
  const categoryFilter = parseMulti(c.req.queries("category"), CATEGORIES);
  // Ohne start/end in der URL gilt das Standardfenster; leere Felder heben es auf.
  const start = c.req.query("start") ?? addDays(today, -14);
  const end = c.req.query("end") ?? addDays(today, 30);
  const itemFilter = c.req.query("item") ?? "";
  const member = c.req.query("member") === "yes" || c.req.query("member") === "no" ? c.req.query("member")! : "";
  const canLink = user.permissions.has("members:read");
  const needle = search.toLowerCase();

  const all = await fetchAllLoans();

  const filtered = all.filter((l) => {
    if (start || end) {
      // Überlappung mit dem Filterzeitraum; Vorgänge ganz ohne Datum fallen raus.
      // Überfällige sind noch draußen: offenes Ende statt plannedTo.
      const r = effectiveRange(l);
      if (r && loanStatus(l, today) === "overdue") r.to = "9999-12-31";
      if (!r || !rangesOverlap(r, { from: start || "0000-01-01", to: end || "9999-12-31" })) return false;
    }
    if (itemFilter && l.lendingItem.id !== itemFilter) return false;
    if (statusFilter.length > 0 && !statusFilter.includes(loanStatus(l, today))) return false;
    if (categoryFilter.length > 0 && !categoryFilter.includes(l.lendingItem.inventoryItem.category)) return false;
    if (member && Boolean(l.borrower.member) !== (member === "yes")) return false;
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
    const date = l.plannedFrom ?? l.pickedUpAt ?? l.plannedTo ?? l.returnedAt ?? "";
    const key = date.slice(0, 7);
    let bucket = groups.get(key);
    if (!bucket) { bucket = []; groups.set(key, bucket); }
    bucket.push(l);
  }

  const presets = rangePresets(today, "future");
  const hasFilter = Boolean(itemFilter || search || statusFilter.length || categoryFilter.length || member || start !== addDays(today, -14) || end !== addDays(today, 30));
  const canManage = user.permissions.has("lending:manage");

  return c.html(
    <Layout title={t("lending.title")} user={user} activeNav="inventory">
      <InventoryTabs
        active="lending"
        overdueCount={await countOverdueInspectionItems()}
        overdueLoanCount={await countOverdueLoans()}
        showLending
      />
      <PageHeader title={t("lending.title")} actions={user.permissions.has("lending:manage") && <HeaderAction variant="primary" icon="plus" label={t("lending.newLoan")} href="/inventory/lending/loans/new" class="btn-primary" />} />

      <form method="get" action="/inventory/lending" class="flex gap-2 items-center flex-wrap mb-4">
        <label class="input input-bordered flex items-center gap-2 w-56"><Icon name="magnifying-glass" class="w-4 h-4 opacity-60" /><input type="search" name="q" value={search} placeholder={t("lending.filter.searchPlaceholder")} class="grow min-w-0" /></label>
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
        <input type="hidden" name="item" value={itemFilter} />
        {itemFilter && <a href={buildListUrl("/inventory/lending", { q: search, status: statusFilter, category: categoryFilter, member, start, end })} class="badge badge-neutral gap-1">{all.find((l) => l.lendingItem.id === itemFilter)?.lendingItem.inventoryItem.name ?? "?"} ✕</a>}
        <MemberFilter
          value={member}
          options={[{ value: "", label: t("common.filter.all") }, { value: "yes", label: t("common.filter.members") }, { value: "no", label: t("common.filter.external") }]}
          href={(m) => buildListUrl("/inventory/lending", { item: itemFilter, q: search, status: statusFilter, category: categoryFilter, start, end }, { member: m })}
        />
        <QuickRangeFilter presets={presets} start={start} end={end} href={(p) => buildListUrl("/inventory/lending", { item: itemFilter, q: search, status: statusFilter, category: categoryFilter, member }, { start: p.start, end: p.end })} />
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
          {canManage && <p class="text-sm text-base-content/60 mb-2">{t("lending.overview.editHint")}</p>}
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
                        class={`${canManage ? "cursor-pointer hover" : ""}${loanState === "overdue" ? " text-error" : ""}`}
                        {...(canManage ? { onclick: `window.location='/inventory/lending/loans/${l.id}'` } : {})}
                      >
                        <td class={`whitespace-nowrap text-sm pl-6${border}`}>{formatDate(date)}</td>
                        <td class={border}>{l.lendingItem.inventoryItem.name}</td>
                        <td class={border}><MemberLink memberId={l.borrower.member?.id} canLink={canLink}>{borrowerLabel(l)}</MemberLink><MemberMark memberId={l.borrower.member?.id} canLink={canLink} /><BorrowerContact person={l.borrower} /></td>
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
      <PageHeader title={item.inventoryItem.name} backHref="/inventory/lending" backLabel={t("lending.loans.backToList")} actions={<>
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
            <div class="form-control max-w-32">
              <label class="label"><span class="label-text">{t("lending.loans.form.quantity")}</span></label>
              <input type="number" name="quantity" min="1" max={maxQuantity} value={String(loan.quantity)} class="input input-bordered w-full" />
            </div>
          )}
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(["plannedFrom", "plannedTo", "pickedUpAt", "returnedAt"] as const).map((f) => (
              <div class="form-control">
                <label class="label"><span class="label-text">{t(`lending.loans.form.${f}`)}</span></label>
                <input type="date" name={f} value={loan[f] ?? ""} class="input input-bordered w-full" />
              </div>
            ))}
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
type BorrowerValues = Partial<Record<"firstName" | "lastName" | "email" | "phone", string>>;

function BorrowerPickerFields({ personId, values, errors }: {
  personId?: string;
  values?: BorrowerValues;
  errors?: Record<string, string>;
}) {
  const v = values ?? {};
  const showFields = Boolean(personId) || Object.values(v).some(Boolean);
  const field = (name: keyof BorrowerValues, label: string, type = "text", required = false) => (
    <div class="form-control">
      <label class="label"><span class="label-text">{label}{required && <span class="text-error ml-1">*</span>}</span></label>
      <input type={type} id={`borrower-${name}`} name={name} value={v[name] ?? ""} class={`input input-bordered w-full${errors?.[name] ? " input-error" : ""}`} />
      {errors?.[name] && <span class="text-error text-sm mt-1">{errors[name]}</span>}
    </div>
  );
  return (
    <div class="space-y-3">
      <div id="borrower-picker-search" class={showFields ? "hidden" : ""}>
        <label class="label">
          <span class="label-text">{t("lending.loans.form.borrowerType")}<span class="text-error ml-1">*</span></span>
        </label>
        <label class={`input input-bordered flex items-center gap-2 w-full${errors?.borrower ? " input-error" : ""}`}>
          <Icon name="magnifying-glass" class="w-4 h-4 opacity-60" />
          <input
            type="text"
            name="q"
            autocomplete="off"
            placeholder={t("lending.loans.form.borrowerSearchPlaceholder")}
            class="grow min-w-0"
            hx-get="/inventory/lending/search-persons"
            hx-trigger={`input changed delay:${SEARCH_DEBOUNCE_MS}ms`}
            hx-target="#borrower-picker-results"
          />
        </label>
        <div id="borrower-picker-results" class="mt-1 border border-base-300 rounded-box divide-y empty:border-none" />
        {errors?.borrower && <p class="text-error text-sm mt-1">{errors.borrower}</p>}
      </div>
      <input type="hidden" id="borrower-personId" name="borrowerPersonId" value={personId ?? ""} />
      <div id="borrower-fields" class={`space-y-4${showFields ? "" : " hidden"}`}>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field("lastName", t("members.form.lastName"), "text", true)}
          {field("firstName", t("members.form.firstName"))}
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field("email", t("members.form.email"), "email")}
          {field("phone", t("members.form.phone"), "tel")}
        </div>
        {errors?.contact && <p class="text-error text-sm" role="alert">{errors.contact}</p>}
        <button type="button" class="btn btn-ghost borrower-change-selection">{t("lending.loans.form.borrowerChangeSelection")}</button>
      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        if (!window.__borrowerPickerBound) {
          window.__borrowerPickerBound = true;
          var fields = ['firstName', 'lastName', 'email', 'phone'];
          var $ = function(id) { return document.getElementById(id); };
          var fill = function(d) {
            $('borrower-personId').value = d.id || '';
            fields.forEach(function(f) { $('borrower-' + f).value = d[f] || ''; });
            $('borrower-fields').classList.remove('hidden');
            $('borrower-picker-search').classList.add('hidden');
          };
          document.body.addEventListener('click', function(e) {
            var resEl = e.target.closest('.borrower-result');
            if (resEl) { fill(resEl.dataset); return; }
            if (e.target.closest('.borrower-create-new')) { fill({}); $('borrower-lastName').focus(); return; }
            if (e.target.closest('.borrower-change-selection')) {
              $('borrower-personId').value = '';
              $('borrower-fields').classList.add('hidden');
              $('borrower-picker-search').classList.remove('hidden');
              $('borrower-picker-results').innerHTML = '';
              var input = document.querySelector('#borrower-picker-search input[name=q]');
              if (input) { input.value = ''; input.focus(); }
            }
          });
        }
      ` }} />
    </div>
  );
}

function LoanForm({ action, item, items, values, errors, maxQuantity }: {
  action: string;
  item?: LendingItemWithRelations;
  // Gesetzt = Gegenstand-Auswahl im Formular (Einstieg ohne Item im Pfad).
  items?: LendingItemWithRelations[];
  values?: Partial<{ quantity: string; plannedFrom: string; plannedTo: string; pickedUpAt: string; returnedAt: string; borrowerPersonId: string }> & BorrowerValues;
  errors?: Record<string, string>;
  maxQuantity?: number;
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
      <BorrowerPickerFields personId={v.borrowerPersonId} values={v} errors={errors} />

      {(items || !item?.individualTracking) && (
        <div class="form-control max-w-32">
          <label class="label"><span class="label-text">{t("lending.loans.form.quantity")}</span></label>
          <input type="number" name="quantity" min="1" max={maxQuantity} value={v.quantity ?? "1"} class={`input input-bordered w-full${errors?.quantity ? " input-error" : ""}`} />
          {errors?.quantity && <span class="text-error text-sm mt-1">{errors.quantity}</span>}
        </div>
      )}

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="form-control">
          <label class="label"><span class="label-text">{t("lending.loans.form.plannedFrom")}<span class="text-error ml-1">*</span></span></label>
          <input type="date" id="loan-plannedFrom" name="plannedFrom" value={v.plannedFrom ?? ""} required class={`input input-bordered w-full${errors?.plannedFrom ? " input-error" : ""}`} />
          {errors?.plannedFrom && <span class="text-error text-sm mt-1">{errors.plannedFrom}</span>}
        </div>
        <div class="form-control">
          <label class="label"><span class="label-text">{t("lending.loans.form.plannedTo")}<span class="text-error ml-1">*</span></span></label>
          <input type="date" id="loan-plannedTo" name="plannedTo" value={v.plannedTo ?? ""} required class={`input input-bordered w-full${errors?.plannedTo ? " input-error" : ""}`} />
          {errors?.plannedTo && <span class="text-error text-sm mt-1">{errors.plannedTo}</span>}
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
      {errors?.dates && <p class="text-error text-sm" role="alert">{errors.dates}</p>}
      {errors?.conflict && <p class="text-error text-sm" role="alert">{errors.conflict}</p>}

      <button type="submit" class="btn btn-primary">{t("lending.loans.form.save")}</button>
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

async function createLoan(c: Context<{ Variables: Variables }>, itemId: string) {
  const item = itemId ? await fetchLendingItem(itemId) : undefined;
  if (item?.inventoryItem.retiredAt) return c.notFound();

  const body = await c.req.parseBody();
  const borrowerPersonId = trimmed(body, "borrowerPersonId");
  const person = {
    firstName: trimmed(body, "firstName"),
    lastName: trimmed(body, "lastName"),
    email: trimmed(body, "email"),
    phone: trimmed(body, "phone"),
  };
  const plannedFrom = trimmed(body, "plannedFrom") || null;
  const plannedTo = trimmed(body, "plannedTo") || null;
  const pickedUpAt = trimmed(body, "pickedUpAt") || null;
  const returnedAt = trimmed(body, "returnedAt") || null;
  // Server erzwingt 1 bei Einzel-Tracking, auch falls im Formular manipuliert.
  const quantity = item?.individualTracking ? 1 : Math.max(1, Math.round(Number(trimmed(body, "quantity"))) || 1);

  const errors: Record<string, string> = {};
  if (!item) errors.item = t("lending.loans.error.itemRequired");
  const hasPerson = Boolean(borrowerPersonId || person.lastName || person.firstName);
  if (!hasPerson) errors.borrower = t("lending.loans.error.borrowerRequired");
  else if (!person.lastName) errors.lastName = t("common.required");
  // Neue Person: ohne Kontakt ist der Ausleiher nicht erreichbar. Bestehende (z.B. Mitglieder) bleiben ausgenommen.
  if (hasPerson && !borrowerPersonId && !person.email && !person.phone) errors.contact = t("lending.loans.error.contactRequired");
  if (item && !item.individualTracking && (!Number.isInteger(quantity) || quantity < 1)) errors.quantity = t("lending.loans.error.invalidQuantity");
  if (!plannedFrom) errors.plannedFrom = t("common.required");
  if (!plannedTo) errors.plannedTo = t("common.required");
  const dateError = validateLoanDates({ plannedFrom, plannedTo, pickedUpAt, returnedAt });
  // "noDates" ist durch die Pflicht für plannedFrom/plannedTo bereits abgedeckt.
  if (dateError && dateError !== "noDates") errors.dates = t(`lending.loans.error.${dateError}`);

  if (item) {
    const existingLoans = await fetchLoans(item.id);
    const conflict = checkAvailability(item, existingLoans, { plannedFrom, plannedTo, pickedUpAt, returnedAt, quantity });
    if (conflict) errors.conflict = conflict;
  }

  if (Object.keys(errors).length > 0) {
    const user = c.get("user")!;
    const values = { quantity: String(quantity), plannedFrom: plannedFrom ?? "", plannedTo: plannedTo ?? "", pickedUpAt: pickedUpAt ?? "", returnedAt: returnedAt ?? "", borrowerPersonId, ...person };
    return c.html(
      <Layout title={t("lending.newLoan.title")} user={user} activeNav="inventory">
        <NewLoanHeader />
        <LoanForm action="/inventory/lending/loans" item={item} items={await fetchLendableItems()} values={values} errors={errors} />
      </Layout>,
      422
    );
  }

  await db.transaction(async (tx) => {
    // Gewählte Person: Kontakt/Name wie im Spender-Formular direkt an der Person korrigieren.
    let personId = borrowerPersonId;
    const columns = { firstName: person.firstName, lastName: person.lastName, email: person.email || null, phone: person.phone || null };
    if (personId) await tx.update(persons).set(columns).where(eq(persons.id, personId));
    else [{ id: personId }] = await tx.insert(persons).values(columns).returning({ id: persons.id });
    await tx.insert(lendingLoans).values({
      lendingItemId: item!.id,
      quantity,
      borrowerPersonId: personId,
      plannedFrom,
      plannedTo,
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
    .select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName, email: persons.email, phone: persons.phone })
    .from(persons)
    .where(and(
      or(ilike(persons.firstName, needle), ilike(persons.lastName, needle)),
      or(
        exists(db.select({ x: members.id }).from(members).where(eq(members.personId, persons.id))),
        exists(db.select({ x: lendingLoans.id }).from(lendingLoans).where(eq(lendingLoans.borrowerPersonId, persons.id))),
      ),
    ))
    .orderBy(asc(persons.lastName))
    .limit(10);

  const createNew = (
    <div class="p-2">
      <button type="button" class="btn btn-ghost btn-sm borrower-create-new">{t("lending.loans.form.borrowerExternalNew")}</button>
    </div>
  );
  if (results.length === 0) {
    return c.html(
      <>
        <p class="p-2 text-sm opacity-60">{t("lending.loans.form.borrowerNoResults", { query: q })}</p>
        {createNew}
      </>
    );
  }
  return c.html(
    <>
      {results.map((p) => (
        <div
          key={p.id}
          class="borrower-result p-2 hover:bg-base-200 cursor-pointer text-sm"
          data-id={p.id}
          data-first-name={p.firstName}
          data-last-name={p.lastName}
          data-email={p.email ?? ""}
          data-phone={p.phone ?? ""}
        >
          <span class="font-medium">{personName(p)}</span>
          {(p.email || p.phone) && <span class="opacity-60">{" — "}{[p.email, p.phone].filter(Boolean).join(" · ")}</span>}
        </div>
      ))}
      {createNew}
    </>
  );
});

function NewLoanHeader() {
  return (
    <PageHeader title={t("lending.newLoan.title")} backHref="/inventory/lending" backLabel={t("lending.loans.backToList")} />
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
    <Layout title={found.item.inventoryItem.name} user={c.get("user")!} activeNav="inventory">
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
  const pick = (key: "plannedFrom" | "plannedTo" | "pickedUpAt" | "returnedAt") =>
    key in body ? trimmed(body, key) || null : loan[key];

  const patch = {
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
