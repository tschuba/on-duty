import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { inventoryItems, inventoryItemTags, lendingItems, lendingLoans, members } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { formatDate } from "../lib/format.js";
import { trimmed, parseTags } from "../lib/forms.js";
import { buildListUrl } from "../lib/list-query.js";
import { effectiveRange, rangesOverlap, countOverdueLoans, loanStatus, type LoanRange, type LoanStatus } from "../lib/lending.js";
import { InventoryTabs, CATEGORIES, CATEGORY_LABELS, CategoryBadge, InventoryFormFields, TagInput, parseInventoryFields, toInsertValues, type InventoryFieldValues } from "./inventory.js";
import { countOverdueInspectionItems, type InventoryCategory } from "../lib/inventory.js";
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

// Verfügbare Menge zum heutigen Tag — siehe Backlog-Doc "Einzel-Tracking vs.
// Stückzahl": verfügbar = quantity - retiredQuantity - Σ(menge aller zeitlich
// überlappenden, noch laufenden Vorgänge).
function availableNow(item: LendingItemWithRelations, loans: LoanWithBorrower[]): number {
  const today = new Date().toISOString().slice(0, 10);
  const todayRange = { from: today, to: today };
  const overlapping = loans.filter((l) => {
    const range = effectiveRange(l);
    return range && rangesOverlap(range, todayRange);
  });
  const usedNow = overlapping.reduce((sum, l) => sum + l.quantity, 0);
  return item.inventoryItem.quantity - item.inventoryItem.retiredQuantity - usedNow;
}

// ── Lending-Liste (GET /inventory/lending) ──────────────────────────────────

lendingRoutes.get("/", requireAuth("lending:read"), async (c) => {
  const user = c.get("user")!;
  const q = c.req.query();
  const category = q.category ?? "";
  const tagFilter = c.req.queries("tag") ?? [];

  // Nur aktive (nicht ausgemusterte) Items — siehe Backlog-Doc "Ausmustern".
  const all = (await fetchLendingItems()).filter((li) => !li.inventoryItem.retiredAt);
  const allTags = [...new Set(all.flatMap((li) => li.inventoryItem.tags.map((tg) => tg.tag)))].sort((a, b) => a.localeCompare(b, "de"));

  const filtered = all.filter((li) => {
    if (category && li.inventoryItem.category !== category) return false;
    if (tagFilter.length > 0 && !tagFilter.every((wanted) => li.inventoryItem.tags.some((tg) => tg.tag === wanted))) return false;
    return true;
  });

  const availability = new Map<string, number>();
  for (const li of filtered) {
    availability.set(li.id, availableNow(li, await fetchLoans(li.id)));
  }

  const qs = (extra: Record<string, string | string[] | undefined>) =>
    buildListUrl("/inventory/lending", { category, tag: tagFilter }, extra);

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
        {user.permissions.has("lending:manage") && <a href="/inventory/lending/new" class="btn btn-primary">{t("lending.newItem")}</a>}
      </div>

      <div class="flex flex-wrap items-center gap-3 mb-4">
        <div class="join">
          <a href={qs({ category: undefined })} class={`join-item btn ${category === "" ? "btn-outline btn-primary" : ""}`}>{t("lending.filter.allCategories")}</a>
          {CATEGORIES.map((cat) => (
            <a href={qs({ category: cat })} class={`join-item btn ${category === cat ? "btn-outline btn-primary" : ""}`}>{CATEGORY_LABELS[cat]}</a>
          ))}
        </div>
      </div>

      <table class="table table-zebra w-full">
        <thead>
          <tr>
            <th>{t("lending.table.name")}</th>
            <th>{t("lending.table.category")}</th>
            <th>{t("lending.table.tracking")}</th>
            <th>{t("lending.table.available")}</th>
            <th>{t("lending.table.tags")}</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr><td colspan={5} class="text-center opacity-50 py-8">{t("lending.table.empty")}</td></tr>
          ) : filtered.map((li) => (
            <tr key={li.id} class="cursor-pointer hover" onclick={`window.location='/inventory/lending/${li.id}/loans'`}>
              <td>{li.inventoryItem.name}</td>
              <td><CategoryBadge category={li.inventoryItem.category as InventoryCategory} /></td>
              <td>{li.individualTracking ? t("lending.tracking.individual") : t("lending.tracking.batch")}</td>
              <td>{availability.get(li.id)}</td>
              <td>
                <div class="flex flex-wrap gap-1">
                  {li.inventoryItem.tags.map((tag) => <span class="badge badge-ghost badge-sm">{tag.tag}</span>)}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
});

// ── Übersicht aller Vorgänge (GET /inventory/lending/overview) ─────────────
// Analog zu routes/anniversaries.tsx: flache, zeitlich sortierte Sicht quer
// über alle Items statt Item-für-Item. Kein Kategorie/Tag-Filter (YAGNI,
// Hauptnutzen ist die Zeitachse, nicht Objektfilterung).

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

lendingRoutes.get("/overview", requireAuth("lending:read"), async (c) => {
  const user = c.get("user")!;
  const today = new Date().toISOString().slice(0, 10);
  const start = c.req.query("start") ?? "";
  const end = c.req.query("end") ?? "";
  const rangeMode = Boolean(start || end);

  const all = await fetchAllLoans();

  const filtered = rangeMode
    ? all.filter((l) => {
        const date = l.plannedFrom ?? l.pickedUpAt ?? l.plannedTo ?? l.returnedAt ?? "";
        return (!start || date >= start) && (!end || date <= end);
      })
    : all.filter((l) => {
        if (!l.returnedAt) return true;
        const nearDate = l.plannedFrom ?? l.pickedUpAt ?? "";
        return nearDate >= addDays(today, -14) && nearDate <= addDays(today, 30);
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

  const qs = (extra: Record<string, string | undefined>) => buildListUrl("/inventory/lending/overview", { start, end }, extra);

  return c.html(
    <Layout title={t("lending.overview.title")} user={user} activeNav="inventory">
      <InventoryTabs
        active="lending-overview"
        overdueCount={await countOverdueInspectionItems()}
        overdueLoanCount={await countOverdueLoans()}
        showLending
      />
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">{t("lending.overview.title")}</h1>
      </div>

      <form method="get" action="/inventory/lending/overview" class="flex gap-2 items-center flex-wrap mb-4">
        <input type="date" name="start" value={start} class="input input-bordered w-36" placeholder={t("lending.overview.rangeStart")} />
        <span class="text-base-content/50">–</span>
        <input type="date" name="end" value={end} class="input input-bordered w-36" placeholder={t("lending.overview.rangeEnd")} />
        <button type="submit" class="btn btn-outline">{t("lending.overview.rangeApply")}</button>
        {rangeMode && <a href={qs({ start: undefined, end: undefined })} class="btn btn-ghost">{t("lending.overview.rangeReset")}</a>}
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
                    const status = loanStatus(l, today);
                    const borrower = l.borrowerMember ? `${l.borrowerMember.person.firstName} ${l.borrowerMember.person.lastName}` : l.borrowerName || "—";
                    const date = l.plannedFrom ?? l.pickedUpAt ?? "";
                    const border = idx > 0 ? " border-t border-base-300" : "";
                    return (
                      <tr key={l.id} class={`cursor-pointer hover${status === "overdue" ? " text-error" : ""}`} onclick={`window.location='/inventory/lending/${l.lendingItem.id}/loans'`}>
                        <td class={`whitespace-nowrap text-sm pl-6${border}`}>{formatDate(date)}</td>
                        <td class={border}>{l.lendingItem.inventoryItem.name}</td>
                        <td class={border}>{borrower}</td>
                        <td class={border}><span class={LOAN_STATUS_BADGE[status]}>{LOAN_STATUS_LABEL[status]}</span></td>
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

// ── Convenience-Formular: inventory_items + lending_items in einem Schritt ──

function LendingNewForm({ values, errors, individualTracking }: {
  values?: Partial<InventoryFieldValues>;
  errors?: Record<string, string>;
  individualTracking?: boolean;
}) {
  return (
    <>
      <div class="mb-4">
        <a href="/inventory/lending" class="link link-hover text-sm opacity-70">{t("common.backToList")}</a>
        <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{t("lending.newItem")}</h1>
        <p class="text-sm opacity-60 mt-1">{t("common.requiredLegend")}</p>
      </div>
      <form id="lending-new-form" method="post" action="/inventory/lending/new" class="space-y-4 max-w-2xl">
        <InventoryFormFields values={values} errors={errors} />
        <div class="form-control">
          <label class="label cursor-pointer justify-start gap-2 w-fit">
            <input type="checkbox" name="individualTracking" value="1" checked={individualTracking ?? true} class="checkbox" />
            <span class="label-text">{t("lending.form.individualTracking")}</span>
          </label>
          <span class="label-text-alt opacity-60 mt-1">{t("lending.form.individualTrackingHint")}</span>
        </div>
      </form>
      <div class="flex gap-2 pt-4 max-w-2xl">
        <button type="submit" form="lending-new-form" class="btn btn-primary">{t("common.save")}</button>
        <a href="/inventory/lending" class="btn btn-ghost">{t("common.cancel")}</a>
      </div>
    </>
  );
}

lendingRoutes.get("/new", requireAuth("lending:manage"), async (c) => {
  const user = c.get("user")!;
  return c.html(
    <Layout title={t("lending.newItem")} user={user} activeNav="inventory">
      <LendingNewForm />
    </Layout>
  );
});

lendingRoutes.post("/new", requireAuth("lending:manage"), async (c) => {
  const user = c.get("user")!;
  const body = await c.req.parseBody();
  const { values, errors } = parseInventoryFields(body);
  const tags = parseTags(body, "tags");
  const individualTracking = trimmed(body, "individualTracking") === "1";
  const insertValues = toInsertValues(values);

  if (Object.keys(errors).length > 0) {
    return c.html(
      <Layout title={t("lending.newItem")} user={user} activeNav="inventory">
        <LendingNewForm values={{ ...values, tagsList: tags }} errors={errors} individualTracking={individualTracking} />
      </Layout>,
      422
    );
  }

  await db.transaction(async (tx) => {
    const [item] = await tx.insert(inventoryItems).values(insertValues).returning();
    if (tags.length > 0) {
      await tx.insert(inventoryItemTags).values(tags.map((tag) => ({ inventoryItemId: item.id, tag })));
    }
    await tx.insert(lendingItems).values({ inventoryItemId: item.id, individualTracking });
  });

  setFlash(c, t("lending.flash.created"), "success");
  return c.redirect("/inventory/lending");
});

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

function LoanForm({ action, item, values, errors, maxQuantity, memberName }: {
  action: string;
  item: LendingItemWithRelations;
  values?: Partial<{ quantity: string; plannedFrom: string; plannedTo: string; pickedUpAt: string; returnedAt: string; borrowerMemberId: string; borrowerName: string; borrowerContact: string }>;
  errors?: Record<string, string>;
  maxQuantity: number;
  memberName?: string;
}) {
  const v = values ?? {};
  return (
    <form method="post" action={action} class="space-y-4 max-w-xl border border-base-300 rounded-box p-4">
      <BorrowerPickerFields memberId={v.borrowerMemberId} memberName={memberName} name={v.borrowerName} contact={v.borrowerContact} />
      {errors?.borrower && <span class="text-error text-sm">{errors.borrower}</span>}

      {!item.individualTracking && (
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

      {!item.inventoryItem.retiredAt && user.permissions.has("lending:manage") && (
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
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colspan={item.individualTracking ? 5 : 6} class="text-center opacity-50 py-8">{t("lending.loans.table.empty")}</td></tr>
          ) : sorted.map((l) => {
            const overdue = Boolean(l.plannedTo && l.plannedTo < today && !l.returnedAt);
            const borrower = l.borrowerMember ? `${l.borrowerMember.person.firstName} ${l.borrowerMember.person.lastName}` : l.borrowerName || "—";
            return (
              <tr key={l.id} class={overdue ? "text-error font-semibold" : ""}>
                <td>{borrower}{overdue && <span class="badge badge-error badge-sm ml-1">{t("lending.loans.overdue")}</span>}</td>
                {!item.individualTracking && <td>{l.quantity}</td>}
                <td>{formatDate(l.plannedFrom)}</td>
                <td>{formatDate(l.plannedTo)}</td>
                <td>{formatDate(l.pickedUpAt)}</td>
                <td>{formatDate(l.returnedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
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

lendingRoutes.post("/:id/loans", requireAuth("lending:manage"), async (c) => {
  const item = await fetchLendingItem(c.req.param("id"));
  if (!item) return c.notFound();
  if (item.inventoryItem.retiredAt) return c.notFound();

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
  const quantity = item.individualTracking ? 1 : Math.max(1, Math.round(Number(trimmed(body, "quantity"))) || 1);

  const errors: Record<string, string> = {};
  if (!borrowerMemberId && !borrowerName) errors.borrower = t("lending.loans.error.borrowerRequired");
  if (!item.individualTracking && (!Number.isInteger(quantity) || quantity < 1)) errors.quantity = t("lending.loans.error.invalidQuantity");

  const existingLoans = await fetchLoans(item.id);
  const conflict = checkAvailability(item, existingLoans, { plannedFrom, plannedTo, pickedUpAt, returnedAt, quantity });
  if (conflict) errors.conflict = conflict;

  if (Object.keys(errors).length > 0) {
    const user = c.get("user")!;
    const maxQuantity = Math.max(1, item.inventoryItem.quantity - item.inventoryItem.retiredQuantity);
    let memberName: string | undefined;
    if (borrowerMemberId) {
      const m = await db.query.members.findFirst({ where: eq(members.id, borrowerMemberId), with: { person: true } });
      memberName = m ? `${(m as any).person.firstName} ${(m as any).person.lastName}` : undefined;
    }
    return c.html(
      <Layout title={item.inventoryItem.name} user={user} activeNav="inventory">
        <div class="mb-4">
          <a href="/inventory/lending" class="link link-hover text-sm opacity-70">{t("lending.loans.backToList")}</a>
          <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{item.inventoryItem.name}</h1>
        </div>
        <LoanForm
          action={`/inventory/lending/${item.id}/loans`}
          item={item}
          maxQuantity={maxQuantity}
          values={{ quantity: String(quantity), plannedFrom: plannedFrom ?? "", plannedTo: plannedTo ?? "", pickedUpAt: pickedUpAt ?? "", returnedAt: returnedAt ?? "", borrowerMemberId, borrowerName, borrowerContact }}
          errors={errors}
          memberName={memberName}
        />
      </Layout>,
      422
    );
  }

  await db.insert(lendingLoans).values({
    lendingItemId: item.id,
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
  return c.redirect(`/inventory/lending/${item.id}/loans`);
});

// POST /inventory/lending/loans/:loanId — Ab-/Rückgabedatum eintragen, Plandatum
// übernehmen (clientseitig). Re-prüft Verfügbarkeit gegen die übrigen Vorgänge.
lendingRoutes.post("/loans/:loanId", requireAuth("lending:manage"), async (c) => {
  const loanId = c.req.param("loanId");
  const loan = await db.query.lendingLoans.findFirst({ where: eq(lendingLoans.id, loanId) });
  if (!loan) return c.notFound();
  const item = await fetchLendingItem(loan.lendingItemId);
  if (!item) return c.notFound();

  const body = await c.req.parseBody();
  const plannedFrom = trimmed(body, "plannedFrom") || null;
  const plannedTo = trimmed(body, "plannedTo") || null;
  const pickedUpAt = trimmed(body, "pickedUpAt") || null;
  const returnedAt = trimmed(body, "returnedAt") || null;
  const quantity = item.individualTracking ? 1 : Math.max(1, Math.round(Number(trimmed(body, "quantity"))) || 1);

  const errors: Record<string, string> = {};
  const existingLoans = await fetchLoans(item.id);
  const conflict = checkAvailability(item, existingLoans, { plannedFrom, plannedTo, pickedUpAt, returnedAt, quantity }, loan.id);
  if (conflict) errors.conflict = conflict;

  if (Object.keys(errors).length > 0) {
    setFlash(c, conflict!, "error");
    return c.redirect(`/inventory/lending/${item.id}/loans`);
  }

  await db.update(lendingLoans).set({ plannedFrom, plannedTo, pickedUpAt, returnedAt, quantity }).where(eq(lendingLoans.id, loanId));
  setFlash(c, t("lending.loans.flash.updated"), "success");
  return c.redirect(`/inventory/lending/${item.id}/loans`);
});
