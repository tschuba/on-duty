import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { inventoryItems, inventoryItemTags, inventoryItemAssignments, lendingItems, members } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { formatDate } from "../lib/format.js";
import { trimmed, parseTags } from "../lib/forms.js";
import { buildListUrl } from "../lib/list-query.js";
import { generateInspectionDueItems, countOverdueInspectionItems, type InventoryCategory } from "../lib/inventory.js";
import { countOverdueLoans } from "../lib/lending.js";
import { deriveMemberStatus } from "../lib/status.js";
import { env } from "../env.js";
import { SEARCH_DEBOUNCE_MS } from "../lib/constants.js";

export const inventoryRoutes = new Hono<{ Variables: Variables }>();

// ── Types ────────────────────────────────────────────────────────────────────

type InventoryItemRow = typeof inventoryItems.$inferSelect;
type Tag = typeof inventoryItemTags.$inferSelect;
type MemberRow = typeof members.$inferSelect;
type Person = { firstName: string; lastName: string };
type AssignmentWithMember = typeof inventoryItemAssignments.$inferSelect & { member: MemberRow & { person: Person } };
type ItemWithRelations = InventoryItemRow & { tags: Tag[]; assignments: AssignmentWithMember[] };

// Which categories may be entered as a batch ("30 Helme" instead of one item per
// piece). A plain list, not scattered if/category checks, so a future category
// opts in with one line here.
const CATEGORY_CONFIG: { category: InventoryCategory; batchCapable: boolean }[] = [
  { category: "vehicle", batchCapable: false },
  { category: "scba", batchCapable: false },
  { category: "equipment", batchCapable: true },
  { category: "ppe", batchCapable: true },
  { category: "other", batchCapable: true },
];
export const CATEGORIES: InventoryCategory[] = CATEGORY_CONFIG.map((c) => c.category);
const BATCH_CAPABLE_CATEGORIES = new Set(CATEGORY_CONFIG.filter((c) => c.batchCapable).map((c) => c.category));

export const CATEGORY_LABELS: Record<InventoryCategory, string> = {
  vehicle: t("inventory.category.vehicle"),
  scba: t("inventory.category.scba"),
  equipment: t("inventory.category.equipment"),
  ppe: t("inventory.category.ppe"),
  other: t("inventory.category.other"),
};

// Fixed color per category (styleguide doesn't cover badges yet) — success/warning/
// error stay reserved for the inspection-due status, no double meaning of color.
const CATEGORY_BADGE: Record<InventoryCategory, string> = {
  vehicle: "badge badge-primary",
  scba: "badge badge-info",
  equipment: "badge badge-secondary",
  ppe: "badge badge-accent",
  other: "badge badge-neutral",
};

// Only members who can actually carry PSA get offered in the assignment picker.
const ASSIGNABLE_MEMBER_STATUSES = new Set(["aktiv", "jugend"]);

export function InventoryTabs({ active, overdueCount, overdueLoanCount, showLending }: {
  active: "stock" | "inspections" | "lending";
  overdueCount: number;
  overdueLoanCount?: number;
  showLending?: boolean;
}) {
  return (
    <div role="tablist" class="tabs tabs-lifted mb-6">
      <a href="/inventory" role="tab" class={`tab${active === "stock" ? " tab-active" : ""}`}>
        {t("inventory.tabs.stock")}
      </a>
      <a href="/inventory/inspections" role="tab" class={`tab${active === "inspections" ? " tab-active" : ""}`}>
        {t("inventory.tabs.inspections")}
        {overdueCount > 0 && <span class="badge badge-sm badge-error ml-1">{overdueCount}</span>}
      </a>
      {showLending && (
        <a href="/inventory/lending" role="tab" class={`tab${active === "lending" ? " tab-active" : ""}`}>
          {t("inventory.tabs.lending")}
          {(overdueLoanCount ?? 0) > 0 && <span class="badge badge-sm badge-error ml-1">{overdueLoanCount}</span>}
        </a>
      )}
    </div>
  );
}

export function CategoryBadge({ category }: { category: InventoryCategory }) {
  return <span class={`${CATEGORY_BADGE[category]} badge-sm`}>{CATEGORY_LABELS[category]}</span>;
}

// ── Form field parsing ───────────────────────────────────────────────────────

type AssignmentInput = { memberId: string; name: string; quantity: number };

export type InventoryFieldValues = {
  name: string;
  category: string;
  purchaseDate: string;
  purchasePrice: string;
  notes: string;
  tagsList?: string[];
  licensePlate: string;
  yearOfManufacture: string;
  vehicleInspectionDue: string;
  serialNumber: string;
  nextInspectionDue: string;
  lastInspectionDate: string;
  quantity: string;
  // Single-item mode (quantity 1): one optional assignment, same UI as before.
  assignedMemberId: string;
  // Batch mode (quantity > 1): JSON-encoded AssignmentInput[], synced from the
  // chip list by client-side JS (same pattern as the tags hidden field).
  assignments: string;
};

export function parseInventoryFields(body: Record<string, any>): { values: InventoryFieldValues; errors: Record<string, string> } {
  const values: InventoryFieldValues = {
    name: trimmed(body, "name"),
    category: trimmed(body, "category"),
    purchaseDate: trimmed(body, "purchaseDate"),
    purchasePrice: trimmed(body, "purchasePrice"),
    notes: trimmed(body, "notes"),
    licensePlate: trimmed(body, "licensePlate"),
    yearOfManufacture: trimmed(body, "yearOfManufacture"),
    vehicleInspectionDue: trimmed(body, "vehicleInspectionDue"),
    serialNumber: trimmed(body, "serialNumber"),
    nextInspectionDue: trimmed(body, "nextInspectionDue"),
    lastInspectionDate: trimmed(body, "lastInspectionDate"),
    quantity: trimmed(body, "quantity") || "1",
    assignedMemberId: trimmed(body, "assignedMemberId"),
    assignments: trimmed(body, "assignments") || "[]",
  };

  const errors: Record<string, string> = {};
  if (!values.name) errors.name = t("common.required");
  if (!(CATEGORIES as string[]).includes(values.category)) errors.category = t("common.required");
  if (values.purchasePrice && !Number.isFinite(Number(values.purchasePrice.replace(",", ".")))) {
    errors.purchasePrice = t("inventory.form.invalidNumber");
  }
  if (values.yearOfManufacture && !/^\d{4}$/.test(values.yearOfManufacture)) {
    errors.yearOfManufacture = t("inventory.form.invalidYear");
  }
  const quantityNum = Number(values.quantity);
  if (!Number.isInteger(quantityNum) || quantityNum < 1) {
    errors.quantity = t("inventory.form.invalidQuantity");
  }
  return { values, errors };
}

// Batch mode (quantity > 1, only for BATCH_CAPABLE_CATEGORIES): an assignment is
// "member holds N of the quantity", built from the client-side chip list.
function parseBatchAssignments(json: string): AssignmentInput[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof (r as any).memberId === "string" && (r as any).memberId)
    .map((r) => ({
      memberId: r.memberId as string,
      name: typeof r.name === "string" ? r.name : "",
      quantity: Math.max(1, Math.round(Number(r.quantity)) || 1),
    }));
}

// Resolves the submitted assignment(s) against quantity/retiredQuantity. Single-
// item mode (quantity 1) keeps the old ppe-only, one-member behaviour; batch mode
// (quantity > 1, only possible for BATCH_CAPABLE_CATEGORIES) allows several
// members each holding a stated quantity, capped by what's left after retiring.
function resolveAssignments(
  values: InventoryFieldValues,
  category: InventoryCategory,
  quantity: number,
  retiredQuantity = 0,
): { assignments: { memberId: string; quantity: number }[]; error?: string } {
  if (BATCH_CAPABLE_CATEGORIES.has(category) && quantity > 1) {
    const assignments = parseBatchAssignments(values.assignments).map(({ memberId, quantity }) => ({ memberId, quantity }));
    const assignedTotal = assignments.reduce((sum, a) => sum + a.quantity, 0);
    if (assignedTotal + retiredQuantity > quantity) return { assignments, error: t("inventory.form.assignedExceedsQuantity") };
    return { assignments };
  }
  if (category === "ppe" && values.assignedMemberId) return { assignments: [{ memberId: values.assignedMemberId, quantity: 1 }] };
  return { assignments: [] };
}

// category=ppe is the only category allowed to carry an assignment in single-item
// mode — anything else submitted for another category is dropped server-side,
// not just hidden client-side (see backlog doc's "nur App-Validierung" note). In
// batch mode (quantity > 1) any BATCH_CAPABLE_CATEGORIES category may assign.
export function toInsertValues(values: InventoryFieldValues) {
  const category = values.category as InventoryCategory;
  const quantity = Math.max(1, Math.round(Number(values.quantity)) || 1);
  const isBatch = BATCH_CAPABLE_CATEGORIES.has(category) && quantity > 1;
  return {
    name: values.name,
    category,
    purchaseDate: values.purchaseDate || null,
    purchasePrice: values.purchasePrice ? values.purchasePrice.replace(",", ".") : null,
    notes: values.notes || null,
    quantity,
    licensePlate: category === "vehicle" ? values.licensePlate || null : null,
    yearOfManufacture: category === "vehicle" && values.yearOfManufacture ? Number(values.yearOfManufacture) : null,
    vehicleInspectionDue: category === "vehicle" ? values.vehicleInspectionDue || null : null,
    // A batch's serial number doesn't identify one piece — dropped once quantity > 1.
    serialNumber: (category === "scba" || category === "equipment" || category === "ppe") && !isBatch ? values.serialNumber || null : null,
    nextInspectionDue: category === "scba" || category === "equipment" || category === "ppe" ? values.nextInspectionDue || null : null,
    lastInspectionDate: category === "scba" ? values.lastInspectionDate || null : null,
  };
}

// ── Tag input (chip UI over a comma-joined hidden field) ────────────────────

export function TagInput({ tags }: { tags?: string[] }) {
  const list = tags ?? [];
  return (
    <div class="form-control">
      <label class="label"><span class="label-text">{t("inventory.form.tags")}</span></label>
      <div id="tag-input" class="input input-bordered w-full h-auto min-h-10 py-1.5 flex flex-wrap items-center gap-1">
        {list.map((tag) => (
          <span class="badge badge-outline gap-1" data-tag={tag}>
            {tag}
            <button type="button" class="tag-remove" aria-label={t("common.remove")}>×</button>
          </span>
        ))}
        <input type="text" class="grow min-w-24 outline-none bg-transparent" placeholder={t("inventory.form.tagsPlaceholder")} />
      </div>
      <input type="hidden" id="tag-input-value" name="tags" value={list.join(",")} />
      <script dangerouslySetInnerHTML={{ __html: `
        if (!window.__tagInputBound) {
          window.__tagInputBound = true;
          function syncTagInput() {
            var el = document.getElementById('tag-input');
            if (!el) return;
            var tags = Array.from(el.querySelectorAll('[data-tag]')).map(function(s){return s.dataset.tag});
            document.getElementById('tag-input-value').value = tags.join(',');
          }
          document.body.addEventListener('keydown', function(e) {
            if (e.key !== 'Enter' && e.key !== ',') return;
            var input = e.target.closest('#tag-input input[type=text]');
            if (!input) return;
            e.preventDefault();
            var value = input.value.trim().replace(/,$/, '');
            if (!value) return;
            var el = document.getElementById('tag-input');
            if (Array.from(el.querySelectorAll('[data-tag]')).some(function(s){return s.dataset.tag.toLowerCase() === value.toLowerCase()})) { input.value = ''; return; }
            var chip = document.createElement('span');
            chip.className = 'badge badge-outline gap-1';
            chip.dataset.tag = value;
            chip.textContent = value;
            var remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'tag-remove';
            remove.textContent = '×';
            chip.appendChild(remove);
            el.insertBefore(chip, input);
            input.value = '';
            syncTagInput();
          });
          document.body.addEventListener('click', function(e) {
            if (e.target.closest('.tag-remove')) {
              e.target.closest('[data-tag]').remove();
              syncTagInput();
            }
          });
        }
      ` }} />
    </div>
  );
}

// ── Assigned-member picker(s) (search existing aktiv/jugend members, no create) ─
// Single-item mode (quantity 1, ppe only): one member, same simple UI as before.
// Batch mode (quantity > 1): a list, each member with how many of the batch they hold.

function MemberPickerFields({ memberId, memberName }: { memberId?: string; memberName?: string }) {
  const showSelected = Boolean(memberId);
  return (
    <div class="form-control" data-show-cats="ppe" data-show-batch="false">
      <label class="label"><span class="label-text">{t("inventory.form.assignedMember")}</span></label>
      <div id="member-picker-search" class={showSelected ? "hidden" : ""}>
        <input
          type="text"
          name="q"
          autocomplete="off"
          placeholder={t("inventory.form.assignedMemberSearchPlaceholder")}
          class="input input-bordered w-full"
          hx-get="/inventory/search-members"
          hx-trigger={`input changed delay:${SEARCH_DEBOUNCE_MS}ms`}
          hx-target="#member-picker-results"
        />
        <div id="member-picker-results" class="mt-1 border border-base-300 rounded-box divide-y empty:border-none" />
      </div>
      <input type="hidden" id="assignedMemberId" name="assignedMemberId" value={memberId ?? ""} />
      <div id="member-picker-selected" class={showSelected ? "flex items-center gap-2" : "hidden flex items-center gap-2"}>
        <span id="member-picker-selected-name">{memberName ?? ""}</span>
        <button type="button" class="btn btn-ghost btn-sm member-picker-change">{t("inventory.form.assignedMemberChangeSelection")}</button>
      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        if (!window.__memberPickerBound) {
          window.__memberPickerBound = true;
          document.body.addEventListener('click', function(e) {
            var resEl = e.target.closest('#member-picker-results .member-result');
            if (resEl) {
              document.getElementById('assignedMemberId').value = resEl.dataset.id;
              document.getElementById('member-picker-selected-name').textContent = resEl.dataset.name;
              document.getElementById('member-picker-selected').classList.remove('hidden');
              document.getElementById('member-picker-search').classList.add('hidden');
              return;
            }
            if (e.target.closest('.member-picker-change')) {
              document.getElementById('assignedMemberId').value = '';
              document.getElementById('member-picker-selected').classList.add('hidden');
              document.getElementById('member-picker-search').classList.remove('hidden');
              document.getElementById('member-picker-results').innerHTML = '';
              var input = document.querySelector('#member-picker-search input[type=text]');
              if (input) { input.value = ''; input.focus(); }
            }
          });
        }
      ` }} />
    </div>
  );
}

function BatchAssignmentFields({ assignments }: { assignments: AssignmentInput[] }) {
  const serialized = JSON.stringify(assignments.map(({ memberId, quantity }) => ({ memberId, quantity })));
  return (
    <div class="form-control" data-show-cats={[...BATCH_CAPABLE_CATEGORIES].join(",")} data-show-batch="true">
      <label class="label"><span class="label-text">{t("inventory.form.assignedMembers")}</span></label>
      <div id="batch-assign-list" class="space-y-1 mb-2 empty:mb-0">
        {assignments.map((a) => (
          <div class="flex items-center gap-2 border border-base-300 rounded-box px-2 py-1" data-assignment data-member-id={a.memberId} data-member-name={a.name}>
            <span class="flex-1 text-sm">{a.name}</span>
            <input type="number" min="1" value={a.quantity} class="input input-bordered input-sm w-20 assignment-qty" />
            <button type="button" class="btn btn-ghost btn-sm assignment-remove" aria-label={t("common.remove")}>×</button>
          </div>
        ))}
      </div>
      <div id="batch-assign-search">
        <input
          type="text"
          name="q"
          autocomplete="off"
          placeholder={t("inventory.form.assignedMemberSearchPlaceholder")}
          class="input input-bordered w-full"
          hx-get="/inventory/search-members"
          hx-trigger={`input changed delay:${SEARCH_DEBOUNCE_MS}ms`}
          hx-target="#batch-assign-results"
        />
        <div id="batch-assign-results" class="mt-1 border border-base-300 rounded-box divide-y empty:border-none" />
      </div>
      <input type="hidden" id="inventory-assignments" name="assignments" value={serialized} />
      <script dangerouslySetInnerHTML={{ __html: `
        if (!window.__batchAssignBound) {
          window.__batchAssignBound = true;
          function syncBatchAssignments() {
            var rows = document.querySelectorAll('#batch-assign-list [data-assignment]');
            var list = Array.from(rows).map(function(row) {
              return { memberId: row.dataset.memberId, quantity: Math.max(1, parseInt(row.querySelector('.assignment-qty').value, 10) || 1) };
            });
            document.getElementById('inventory-assignments').value = JSON.stringify(list);
          }
          document.body.addEventListener('click', function(e) {
            var resEl = e.target.closest('#batch-assign-results .member-result');
            if (resEl) {
              var list = document.getElementById('batch-assign-list');
              if (list.querySelector('[data-member-id="' + resEl.dataset.id + '"]')) return;
              var row = document.createElement('div');
              row.className = 'flex items-center gap-2 border border-base-300 rounded-box px-2 py-1';
              row.setAttribute('data-assignment', '');
              row.dataset.memberId = resEl.dataset.id;
              row.dataset.memberName = resEl.dataset.name;
              row.innerHTML = '<span class="flex-1 text-sm"></span>' +
                '<input type="number" min="1" value="1" class="input input-bordered input-sm w-20 assignment-qty" />' +
                '<button type="button" class="btn btn-ghost btn-sm assignment-remove" aria-label="${t("common.remove")}">×</button>';
              row.querySelector('span').textContent = resEl.dataset.name;
              list.appendChild(row);
              document.getElementById('batch-assign-results').innerHTML = '';
              var input = document.querySelector('#batch-assign-search input[type=text]');
              if (input) { input.value = ''; }
              syncBatchAssignments();
              return;
            }
            if (e.target.closest('.assignment-remove')) {
              e.target.closest('[data-assignment]').remove();
              syncBatchAssignments();
            }
          });
          document.body.addEventListener('input', function(e) {
            if (e.target.classList.contains('assignment-qty')) syncBatchAssignments();
          });
        }
      ` }} />
    </div>
  );
}

// ── Category-dependent form fields ──────────────────────────────────────────

// No precedent in the code for dynamic show/hide of form fields — plain client-side
// classList toggle (same idea as the pagination <select> inline script in
// members.tsx), not an HTMX round-trip for a purely visual switch. Two toggles
// compose here: which category is selected, and (for BATCH_CAPABLE_CATEGORIES)
// whether the batch checkbox is on — data-show-cats/data-show-batch express both
// without duplicating any input's `name` across categories (duplicate names would
// silently clobber each other in FormData on submit).
const CATEGORY_TOGGLE_SCRIPT = `
  var __inventoryBatchCats = ${JSON.stringify([...BATCH_CAPABLE_CATEGORIES])};
  function updateInventoryFormVisibility() {
    var cat = document.querySelector('input[name=category]:checked')?.value || '';
    var batchToggle = document.getElementById('inventory-batch-toggle');
    var isBatch = Boolean(batchToggle && batchToggle.checked);
    document.querySelectorAll('[data-show-cats]').forEach(function(el) {
      var cats = el.dataset.showCats.split(',');
      var catOk = cats.indexOf(cat) >= 0;
      var batchAttr = el.dataset.showBatch;
      var batchOk = batchAttr === undefined || (batchAttr === 'true') === isBatch;
      el.classList.toggle('hidden', !(catOk && batchOk));
    });
    var qtyInput = document.getElementById('inventory-quantity');
    if (qtyInput && !(isBatch && __inventoryBatchCats.indexOf(cat) >= 0)) qtyInput.value = '1';
  }
  updateInventoryFormVisibility();
`;

export function InventoryFormFields({ values, errors, assignedMemberName, assignments }: {
  values?: Partial<InventoryFieldValues>;
  errors?: Record<string, string>;
  assignedMemberName?: string;
  assignments?: AssignmentInput[];
}) {
  const v = values ?? {};
  const quantity = Number(v.quantity) || 1;
  const isBatch = quantity > 1;
  return (
    <>
      <div class="form-control">
        <label class="label"><span class="label-text">{t("inventory.form.name")}<span class="text-error ml-1">*</span></span></label>
        <input type="text" name="name" value={v.name ?? ""} class={`input input-bordered w-full${errors?.name ? " input-error" : ""}`} />
        {errors?.name && <span class="text-error text-sm mt-1">{errors.name}</span>}
      </div>

      <div class="form-control">
        <label class="label"><span class="label-text">{t("inventory.form.category")}<span class="text-error ml-1">*</span></span></label>
        <div class="join">
          {CATEGORIES.map((cat) => (
            <label class="join-item btn has-[:checked]:btn-outline has-[:checked]:btn-primary">
              <input
                type="radio"
                name="category"
                value={cat}
                checked={v.category === cat}
                class="hidden"
                onchange="updateInventoryFormVisibility()"
              />
              {CATEGORY_LABELS[cat]}
            </label>
          ))}
        </div>
        {errors?.category && <span class="text-error text-sm mt-1">{errors.category}</span>}
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="form-control">
          <label class="label"><span class="label-text">{t("inventory.form.purchaseDate")}</span></label>
          <input type="date" name="purchaseDate" value={v.purchaseDate ?? ""} class="input input-bordered w-full" />
        </div>
        <div class="form-control">
          <label class="label"><span class="label-text">{t("inventory.form.purchasePrice")}</span></label>
          <input type="text" inputmode="decimal" name="purchasePrice" value={v.purchasePrice ?? ""} class={`input input-bordered w-full${errors?.purchasePrice ? " input-error" : ""}`} />
          {errors?.purchasePrice && <span class="text-error text-sm mt-1">{errors.purchasePrice}</span>}
          <span class="label-text-alt opacity-60 mt-1" data-show-cats={[...BATCH_CAPABLE_CATEGORIES].join(",")} data-show-batch="true">{t("inventory.form.quantityTotalHint")}</span>
        </div>
      </div>

      <div class="form-control">
        <label class="label"><span class="label-text">{t("inventory.form.notes")}</span></label>
        <textarea name="notes" class="textarea textarea-bordered w-full" rows={3}>{v.notes ?? ""}</textarea>
      </div>

      <TagInput tags={v.tagsList} />

      <div data-show-cats="vehicle" class="space-y-4">
        <div class="divider">{CATEGORY_LABELS.vehicle}</div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="form-control">
            <label class="label"><span class="label-text">{t("inventory.form.licensePlate")}</span></label>
            <input type="text" name="licensePlate" value={v.licensePlate ?? ""} class="input input-bordered w-full" />
          </div>
          <div class="form-control">
            <label class="label"><span class="label-text">{t("inventory.form.yearOfManufacture")}</span></label>
            <input type="text" inputmode="numeric" name="yearOfManufacture" value={v.yearOfManufacture ?? ""} class={`input input-bordered w-full${errors?.yearOfManufacture ? " input-error" : ""}`} />
            {errors?.yearOfManufacture && <span class="text-error text-sm mt-1">{errors.yearOfManufacture}</span>}
          </div>
          <div class="form-control">
            <label class="label"><span class="label-text">{t("inventory.form.vehicleInspectionDue")}</span></label>
            <input type="date" name="vehicleInspectionDue" value={v.vehicleInspectionDue ?? ""} class="input input-bordered w-full" />
          </div>
        </div>
      </div>

      <div data-show-cats="scba,equipment,ppe" class="space-y-4">
        <div class="divider">{t("inventory.form.serialNumber")} / {t("inventory.form.nextInspectionDue")}</div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="form-control" data-show-cats="scba,equipment,ppe" data-show-batch="false">
            <label class="label"><span class="label-text">{t("inventory.form.serialNumber")}</span></label>
            <input type="text" name="serialNumber" value={v.serialNumber ?? ""} class="input input-bordered w-full" />
          </div>
          <div class="form-control" data-show-cats="scba">
            <label class="label"><span class="label-text">{t("inventory.form.lastInspectionDate")}</span></label>
            <input type="date" name="lastInspectionDate" value={v.lastInspectionDate ?? ""} class="input input-bordered w-full" />
          </div>
          <div class="form-control">
            <label class="label"><span class="label-text">{t("inventory.form.nextInspectionDue")}</span></label>
            <input type="date" name="nextInspectionDue" value={v.nextInspectionDue ?? ""} class="input input-bordered w-full" />
          </div>
        </div>
      </div>

      <div data-show-cats={[...BATCH_CAPABLE_CATEGORIES].join(",")} class="space-y-4">
        <div class="divider">{t("inventory.form.batchToggle")}</div>
        <label class="label cursor-pointer justify-start gap-2 w-fit">
          <input type="checkbox" id="inventory-batch-toggle" checked={isBatch} class="checkbox" onchange="updateInventoryFormVisibility()" />
          <span class="label-text">{t("inventory.form.batchToggle")}</span>
        </label>
        <div class="form-control max-w-40" data-show-cats={[...BATCH_CAPABLE_CATEGORIES].join(",")} data-show-batch="true">
          <label class="label"><span class="label-text">{t("inventory.form.quantity")}</span></label>
          <input
            type="number"
            id="inventory-quantity"
            name="quantity"
            min="1"
            value={v.quantity ?? "1"}
            class={`input input-bordered w-full${errors?.quantity ? " input-error" : ""}`}
          />
          {errors?.quantity && <span class="text-error text-sm mt-1">{errors.quantity}</span>}
        </div>
      </div>

      <MemberPickerFields memberId={v.assignedMemberId} memberName={assignedMemberName} />
      <BatchAssignmentFields assignments={assignments ?? []} />

      <script dangerouslySetInnerHTML={{ __html: CATEGORY_TOGGLE_SCRIPT }} />
    </>
  );
}

// ── Data access ──────────────────────────────────────────────────────────────

async function fetchItems(): Promise<ItemWithRelations[]> {
  return db.query.inventoryItems.findMany({
    with: { tags: true, assignments: { with: { member: { with: { person: true } } } } },
    orderBy: (items, { asc }) => [asc(items.name)],
  }) as unknown as Promise<ItemWithRelations[]>;
}

async function fetchItem(id: string): Promise<ItemWithRelations | undefined> {
  return db.query.inventoryItems.findFirst({
    where: eq(inventoryItems.id, id),
    with: { tags: true, assignments: { with: { member: { with: { person: true } } } } },
  }) as unknown as Promise<ItemWithRelations | undefined>;
}

// Resolves a submitted assignment list (memberId/quantity only) back to display
// names, for re-rendering the batch chip list after a validation error.
async function resolveAssignmentNames(assignments: { memberId: string; quantity: number }[]): Promise<AssignmentInput[]> {
  if (assignments.length === 0) return [];
  const rows = await db.query.members.findMany({ with: { person: true } });
  const byId = new Map(rows.map((m: any) => [m.id, `${m.person.firstName} ${m.person.lastName}`]));
  return assignments.map((a) => ({ ...a, name: byId.get(a.memberId) ?? "" }));
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /inventory — list, category pills + tag checkbox-dropdown + archive toggle.
// Loads everything and filters in JS, same reasoning as donations.tsx: the full
// set is small and the tag filter needs the joined tags anyway.
inventoryRoutes.get("/", requireAuth("inventory:read"), async (c) => {
  const user = c.get("user")!;
  const q = c.req.query();
  const category = q.category ?? "";
  const tagFilter = c.req.queries("tag") ?? [];
  const showArchived = q.archived === "1";

  const all = await fetchItems();
  const allTags = [...new Set(all.flatMap((item) => item.tags.map((t) => t.tag)))].sort((a, b) => a.localeCompare(b, "de"));

  const filtered = all.filter((item) => {
    if (!showArchived && item.retiredAt) return false;
    if (category && item.category !== category) return false;
    if (tagFilter.length > 0 && !tagFilter.every((wanted) => item.tags.some((t) => t.tag === wanted))) return false;
    return true;
  });

  const qs = (extra: Record<string, string | string[] | undefined>) =>
    buildListUrl("/inventory", { category, tag: tagFilter, archived: showArchived ? "1" : undefined }, extra);

  return c.html(
    <Layout title={t("inventory.title")} user={user} activeNav="inventory">
      <InventoryTabs
        active="stock"
        overdueCount={await countOverdueInspectionItems()}
        overdueLoanCount={user.permissions.has("lending:read") ? await countOverdueLoans() : 0}
        showLending={user.permissions.has("lending:read")}
      />
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">{t("inventory.title")}</h1>
        {user.permissions.has("inventory:manage") && <a href="/inventory/new" class="btn btn-primary">{t("inventory.newItem")}</a>}
      </div>

      <div class="flex flex-wrap items-center gap-3 mb-4">
        <div class="join">
          <a href={qs({ category: undefined })} class={`join-item btn ${category === "" ? "btn-outline btn-primary" : ""}`}>{t("inventory.filter.allCategories")}</a>
          {CATEGORIES.map((cat) => (
            <a href={qs({ category: cat })} class={`join-item btn ${category === cat ? "btn-outline btn-primary" : ""}`}>{CATEGORY_LABELS[cat]}</a>
          ))}
        </div>

        <details id="tag-filter-dropdown" class="dropdown" ontoggle="if(!this.open)applyTagFilter()">
          <summary class="btn btn-ghost m-0">
            {tagFilter.length === 0 ? t("inventory.filter.allTags") : t("inventory.filter.tagCount", { count: tagFilter.length })} ▾
          </summary>
          <div class="dropdown-content z-10 bg-base-100 border border-base-300 rounded-box shadow-lg w-64 p-2 mt-1">
            <input
              type="text"
              placeholder={t("common.searchPlaceholder")}
              class="input input-bordered w-full mb-2"
              oninput="var v=this.value.toLowerCase();document.querySelectorAll('#tag-filter-list li').forEach(function(li){li.hidden=!li.dataset.tag.includes(v)})"
            />
            <ul id="tag-filter-list" class="space-y-0.5 max-h-64 overflow-y-auto">
              {allTags.length === 0 && <li class="text-sm opacity-50 px-2 py-1">{t("inventory.filter.noTags")}</li>}
              {allTags.map((tag) => (
                <li data-tag={tag.toLowerCase()}>
                  <label class="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-base-200">
                    <input type="checkbox" class="checkbox checkbox-xs" value={tag} checked={tagFilter.includes(tag)} />
                    <span class="text-sm flex-1">{tag}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div class="flex gap-1 mt-2">
              <button
                class="btn btn-sm btn-primary flex-1"
                onclick="document.getElementById('tag-filter-dropdown').removeAttribute('open')"
              >
                {t("common.apply")}
              </button>
              {tagFilter.length > 0 && (
                <button
                  class="btn btn-sm btn-ghost"
                  onclick="document.querySelectorAll('#tag-filter-list input[type=checkbox]').forEach(function(cb){cb.checked=false});document.getElementById('tag-filter-dropdown').removeAttribute('open')"
                >
                  {t("common.reset")}
                </button>
              )}
            </div>
          </div>
          <script dangerouslySetInnerHTML={{ __html: `
            function applyTagFilter() {
              var checked = Array.from(document.querySelectorAll('#tag-filter-list input[type=checkbox]:checked')).map(function(el){return el.value});
              var url = new URL(window.location.href);
              var current = url.searchParams.getAll('tag').slice().sort().join(',');
              var next = checked.slice().sort().join(',');
              if (current === next) return;
              url.searchParams.delete('tag');
              checked.forEach(function(v){ url.searchParams.append('tag', v) });
              url.searchParams.set('page', '1');
              window.location.href = url.toString();
            }
            document.addEventListener('click', function(e) {
              var dd = document.getElementById('tag-filter-dropdown');
              if (dd && dd.open && !dd.contains(e.target)) dd.removeAttribute('open');
            });
          ` }} />
        </details>

        <a href={qs({ archived: showArchived ? undefined : "1" })} class={`btn ${showArchived ? "btn-outline btn-primary" : "btn-ghost"}`}>
          {t("inventory.filter.showArchived")}
        </a>
      </div>

      <table class="table table-zebra w-full">
        <thead>
          <tr>
            <th>{t("inventory.table.name")}</th>
            <th>{t("inventory.table.category")}</th>
            <th>{t("inventory.table.dueDate")}</th>
            <th>{t("inventory.table.tags")}</th>
            <th>{t("inventory.table.status")}</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr><td colspan={5} class="text-center opacity-50 py-8">{t("inventory.table.empty")}</td></tr>
          ) : filtered.map((item) => {
            const due = item.category === "vehicle" ? item.vehicleInspectionDue : item.nextInspectionDue;
            return (
              <tr key={item.id} class="cursor-pointer hover" onclick={`window.location='/inventory/${item.id}/edit'`}>
                <td>{item.name}</td>
                <td><CategoryBadge category={item.category as InventoryCategory} /></td>
                <td>{due ? formatDate(due) : "—"}</td>
                <td>
                  <div class="flex flex-wrap gap-1">
                    {item.tags.map((tag) => <span class="badge badge-ghost badge-sm">{tag.tag}</span>)}
                  </div>
                </td>
                <td>
                  {item.retiredAt
                    ? <span class="badge badge-neutral badge-sm">{t("inventory.status.retired")}</span>
                    : <span class="badge badge-success badge-sm">{t("inventory.status.active")}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Layout>
  );
});

// Flat display list for an item's assignments — batch chip list and the single-
// item picker's selected name both read from this.
function assignmentDisplayList(item: ItemWithRelations): AssignmentInput[] {
  return item.assignments.map((a) => ({
    memberId: a.memberId,
    quantity: a.quantity,
    name: `${a.member.person.firstName} ${a.member.person.lastName}`,
  }));
}

function InventoryForm({ title, action, values, errors, formId, assignedMemberName, assignments, extraActions }: {
  title: string;
  action: string;
  values?: Partial<InventoryFieldValues>;
  errors?: Record<string, string>;
  formId: string;
  assignedMemberName?: string;
  assignments?: AssignmentInput[];
  extraActions?: any;
}) {
  return (
    <>
      <div class="mb-4">
        <a href="/inventory" class="link link-hover text-sm opacity-70">{t("common.backToList")}</a>
        <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{title}</h1>
        <p class="text-sm opacity-60 mt-1">{t("common.requiredLegend")}</p>
      </div>
      <form id={formId} method="post" action={action} class="space-y-4 max-w-2xl">
        <InventoryFormFields values={values} errors={errors} assignedMemberName={assignedMemberName} assignments={assignments} />
      </form>
      <div class="flex gap-2 pt-4 max-w-2xl">
        <button type="submit" form={formId} class="btn btn-primary">{t("common.save")}</button>
        {extraActions}
        <a href="/inventory" class="btn btn-ghost">{t("common.cancel")}</a>
      </div>
    </>
  );
}

// GET /inventory/new
inventoryRoutes.get("/new", requireAuth("inventory:manage"), async (c) => {
  const user = c.get("user")!;
  return c.html(
    <Layout title={t("inventory.newItem")} user={user} activeNav="inventory">
      <InventoryForm title={t("inventory.newItem")} action="/inventory" formId="inventory-new-form" />
    </Layout>
  );
});

// POST /inventory
inventoryRoutes.post("/", requireAuth("inventory:manage"), async (c) => {
  const user = c.get("user")!;
  const body = await c.req.parseBody();
  const { values, errors } = parseInventoryFields(body);
  const tags = parseTags(body, "tags");
  const category = values.category as InventoryCategory;
  const insertValues = toInsertValues(values);
  const { assignments, error: assignmentError } = resolveAssignments(values, category, insertValues.quantity);
  if (assignmentError) errors.assignments = assignmentError;

  if (Object.keys(errors).length > 0) {
    const assignmentNames = await resolveAssignmentNames(assignments);
    return c.html(
      <Layout title={t("inventory.newItem")} user={user} activeNav="inventory">
        <InventoryForm
          title={t("inventory.newItem")}
          action="/inventory"
          formId="inventory-new-form"
          values={{ ...values, tagsList: tags }}
          errors={errors}
          assignedMemberName={assignmentNames[0]?.name}
          assignments={assignmentNames}
        />
      </Layout>,
      422
    );
  }

  await db.transaction(async (tx) => {
    const [item] = await tx.insert(inventoryItems).values(insertValues).returning();
    if (tags.length > 0) {
      await tx.insert(inventoryItemTags).values(tags.map((tag) => ({ inventoryItemId: item.id, tag })));
    }
    if (assignments.length > 0) {
      await tx.insert(inventoryItemAssignments).values(assignments.map((a) => ({ inventoryItemId: item.id, memberId: a.memberId, quantity: a.quantity })));
    }
  });

  setFlash(c, t("inventory.flash.created"), "success");
  return c.redirect("/inventory");
});

// GET /inventory/:id/edit — also where a completed inspection is recorded (no
// inline quick-action, see backlog doc: every date is free-form anyway).
inventoryRoutes.get("/:id/edit", requireAuth("inventory:manage"), async (c) => {
  const user = c.get("user")!;
  const item = await fetchItem(c.req.param("id"));
  if (!item) return c.notFound();

  const assignmentList = assignmentDisplayList(item);
  const isBatch = item.quantity > 1;
  const lendingItem = await db.query.lendingItems.findFirst({ where: eq(lendingItems.inventoryItemId, item.id) });

  const values: Partial<InventoryFieldValues> & { tagsList?: string[] } = {
    name: item.name,
    category: item.category,
    purchaseDate: item.purchaseDate ?? "",
    purchasePrice: item.purchasePrice ?? "",
    notes: item.notes ?? "",
    licensePlate: item.licensePlate ?? "",
    yearOfManufacture: item.yearOfManufacture ? String(item.yearOfManufacture) : "",
    vehicleInspectionDue: item.vehicleInspectionDue ?? "",
    serialNumber: item.serialNumber ?? "",
    nextInspectionDue: item.nextInspectionDue ?? "",
    lastInspectionDate: item.lastInspectionDate ?? "",
    quantity: String(item.quantity),
    assignedMemberId: !isBatch ? (assignmentList[0]?.memberId ?? "") : "",
    tagsList: item.tags.map((tg) => tg.tag),
  };

  const assignedTotal = assignmentList.reduce((sum, a) => sum + a.quantity, 0);
  const availableToRetire = item.quantity - item.retiredQuantity - assignedTotal;

  const enableLendingAction = !lendingItem && !item.retiredAt && user.permissions.has("lending:manage") && (
    <form method="post" action={`/inventory/${item.id}/enable-lending`}>
      <button type="submit" class="btn btn-outline">{t("inventory.enableLending.button")}</button>
    </form>
  );

  const retireAction = item.retiredAt ? (
    <form method="post" action={`/inventory/${item.id}/reactivate`} onsubmit={`return confirm('${t("inventory.reactivate.confirm")}')`}>
      <button type="submit" class="btn btn-outline">{t("inventory.reactivate.button")}</button>
    </form>
  ) : (
    <>
      <button type="button" class="btn btn-outline btn-warning" onclick="document.getElementById('retire-modal').showModal()">{t("inventory.retire.button")}</button>
      <dialog id="retire-modal" class="modal">
        <div class="modal-box">
          <h3 class="font-bold text-lg">{t("inventory.retire.confirmTitle")}</h3>
          <p class="py-2 opacity-70">{t("inventory.retire.confirmBody", { name: item.name })}</p>
          <form method="post" action={`/inventory/${item.id}/retire`} class="space-y-2">
            {isBatch && (
              <div class="form-control">
                <label class="label"><span class="label-text">{t("inventory.retire.quantityLabel")}</span></label>
                <input type="number" name="retireQuantity" min="1" max={Math.max(1, availableToRetire)} value={Math.max(1, availableToRetire)} class="input input-bordered w-full" />
                <span class="label-text-alt opacity-60 mt-1">{t("inventory.retire.quantityHint", { available: availableToRetire, quantity: item.quantity })}</span>
              </div>
            )}
            <label class="label"><span class="label-text">{t("inventory.retire.reasonLabel")}</span></label>
            <input type="text" name="retiredReason" class="input input-bordered w-full" />
            <div class="modal-action">
              <button type="button" class="btn" onclick="document.getElementById('retire-modal').close()">{t("common.cancel")}</button>
              <button type="submit" class="btn btn-warning">{t("inventory.retire.button")}</button>
            </div>
          </form>
        </div>
        <form method="dialog" class="modal-backdrop"><button>{t("common.close")}</button></form>
      </dialog>
    </>
  );

  return c.html(
    <Layout title={item.name} user={user} activeNav="inventory">
      {item.retiredAt && (
        <div class="alert alert-warning max-w-2xl mb-4">
          {t("inventory.retire.retiredNotice", { date: formatDate(item.retiredAt) })}{item.retiredReason ? ` — ${item.retiredReason}` : ""}
        </div>
      )}
      {!item.retiredAt && item.retiredQuantity > 0 && (
        <div class="alert alert-warning max-w-2xl mb-4">
          {t("inventory.retire.partialNotice", { retired: item.retiredQuantity, quantity: item.quantity })}{item.retiredReason ? ` — ${item.retiredReason}` : ""}
        </div>
      )}
      <InventoryForm
        title={item.name}
        action={`/inventory/${item.id}`}
        formId="inventory-edit-form"
        values={values}
        assignedMemberName={!isBatch ? assignmentList[0]?.name : undefined}
        assignments={isBatch ? assignmentList : []}
        extraActions={<>{enableLendingAction}{retireAction}</>}
      />
    </Layout>
  );
});

inventoryRoutes.post("/:id", requireAuth("inventory:manage"), async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const existing = await fetchItem(id);
  if (!existing) return c.notFound();

  const body = await c.req.parseBody();
  const { values, errors } = parseInventoryFields(body);
  const tags = parseTags(body, "tags");
  const category = values.category as InventoryCategory;
  const insertValues = toInsertValues(values);
  const { assignments, error: assignmentError } = resolveAssignments(values, category, insertValues.quantity, existing.retiredQuantity);
  if (assignmentError) errors.assignments = assignmentError;

  if (Object.keys(errors).length > 0) {
    const assignmentNames = await resolveAssignmentNames(assignments);
    return c.html(
      <Layout title={existing.name} user={user} activeNav="inventory">
        <InventoryForm
          title={existing.name}
          action={`/inventory/${id}`}
          formId="inventory-edit-form"
          values={{ ...values, tagsList: tags }}
          errors={errors}
          assignedMemberName={assignmentNames[0]?.name}
          assignments={assignmentNames}
        />
      </Layout>,
      422
    );
  }

  await db.transaction(async (tx) => {
    await tx.update(inventoryItems).set(insertValues).where(eq(inventoryItems.id, id));
    await tx.delete(inventoryItemTags).where(eq(inventoryItemTags.inventoryItemId, id));
    if (tags.length > 0) {
      await tx.insert(inventoryItemTags).values(tags.map((tag) => ({ inventoryItemId: id, tag })));
    }
    await tx.delete(inventoryItemAssignments).where(eq(inventoryItemAssignments.inventoryItemId, id));
    if (assignments.length > 0) {
      await tx.insert(inventoryItemAssignments).values(assignments.map((a) => ({ inventoryItemId: id, memberId: a.memberId, quantity: a.quantity })));
    }
  });

  setFlash(c, t("inventory.flash.saved"), "success");
  return c.redirect("/inventory");
});

// POST /inventory/:id/retire — soft-delete; for a batch, retires `retireQuantity`
// more pieces (default: everything not yet assigned/retired). The item is fully
// archived (retiredAt set, same as before) once retiredQuantity reaches quantity.
inventoryRoutes.post("/:id/retire", requireAuth("inventory:manage"), async (c) => {
  const id = c.req.param("id");
  const item = await fetchItem(id);
  if (!item) return c.notFound();

  const body = await c.req.parseBody();
  const reason = trimmed(body, "retiredReason");
  const assignedTotal = item.assignments.reduce((sum, a) => sum + a.quantity, 0);
  const available = item.quantity - item.retiredQuantity - assignedTotal;
  const requested = item.quantity > 1 ? Math.max(1, Math.round(Number(trimmed(body, "retireQuantity"))) || 1) : 1;
  const retireQuantity = Math.min(Math.max(requested, 1), Math.max(available, 1));
  const retiredQuantity = Math.min(item.quantity, item.retiredQuantity + retireQuantity);

  await db.update(inventoryItems).set({
    retiredQuantity,
    retiredAt: retiredQuantity >= item.quantity ? new Date().toISOString().slice(0, 10) : null,
    retiredReason: reason || null,
  }).where(eq(inventoryItems.id, id));
  setFlash(c, t("inventory.flash.retired"), "success");
  return c.redirect(`/inventory/${id}/edit`);
});

// POST /inventory/:id/reactivate — undo the retirement entirely, low effort, keeps
// the soft-delete character of this feature consistent.
inventoryRoutes.post("/:id/reactivate", requireAuth("inventory:manage"), async (c) => {
  const id = c.req.param("id");
  await db.update(inventoryItems).set({ retiredAt: null, retiredReason: null, retiredQuantity: 0 }).where(eq(inventoryItems.id, id));
  setFlash(c, t("inventory.flash.reactivated"), "success");
  return c.redirect(`/inventory/${id}/edit`);
});

// POST /inventory/:id/enable-lending — Markiert ein bestehendes Inventar-Item als
// verleihbar (inventory_items ist weiter die einzige Bestandswahrheit, siehe
// db/schema/lending.ts). individualTracking aus quantity abgeleitet (gleiches
// isBatch-Muster wie beim Retire-Formular), kein Formular nötig.
inventoryRoutes.post("/:id/enable-lending", requireAuth(["inventory:manage", "lending:manage"]), async (c) => {
  const id = c.req.param("id");
  const item = await fetchItem(id);
  if (!item || item.retiredAt) return c.notFound();

  const existing = await db.query.lendingItems.findFirst({ where: eq(lendingItems.inventoryItemId, id) });
  if (existing) return c.redirect(`/inventory/lending/${existing.id}/loans`);

  const [lendingItem] = await db.insert(lendingItems).values({ inventoryItemId: id, individualTracking: item.quantity <= 1 }).returning();
  setFlash(c, t("lending.flash.created"), "success");
  return c.redirect(`/inventory/lending/${lendingItem.id}/loans`);
});

// GET /inventory/inspections — Prüffristen-Übersicht, filter-UX identisch zu /anniversaries.
inventoryRoutes.get("/inspections", requireAuth("inventory:read"), async (c) => {
  const user = c.get("user")!;
  const today = new Date().toISOString().slice(0, 10);
  const addMonths = (dateStr: string, months: number) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1 + months, d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  };

  const start = c.req.query("start") || today;
  const end = c.req.query("end") || addMonths(today, 12);
  const category = c.req.query("category") || "";

  const all = await fetchItems();
  // Überfällige Posten immer anzeigen, unabhängig vom Zeitraum-Filter — sonst
  // verschwinden sie aus der Liste, sobald "start" nicht mehr in der Vergangenheit liegt.
  const overdueItems = generateInspectionDueItems(all, "0000-01-01", today);
  const dueInRange = generateInspectionDueItems(all, start, end);
  const seen = new Set(overdueItems.map((d) => d.id));
  let due = [...overdueItems, ...dueInRange.filter((d) => !seen.has(d.id))].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name, "de"),
  );
  if (category) due = due.filter((d) => d.category === category);

  const qs = (extra: Record<string, string | undefined>) => buildListUrl("/inventory/inspections", { start, end, category: category || undefined }, extra);
  const quickLink = (months: number) => qs({ start: today, end: addMonths(today, months) });
  const thisYear = today.slice(0, 4);
  const nextYear = String(Number(thisYear) + 1);

  return c.html(
    <Layout title={t("inventory.inspections.title")} user={user} activeNav="inventory">
      <InventoryTabs
        active="inspections"
        overdueCount={await countOverdueInspectionItems()}
        overdueLoanCount={user.permissions.has("lending:read") ? await countOverdueLoans() : 0}
        showLending={user.permissions.has("lending:read")}
      />
      <h1 class="text-2xl font-bold mb-4" style="font-family: var(--font-heading)">{t("inventory.inspections.title")}</h1>

      <div class="flex flex-wrap items-center gap-3 mb-4">
        <form method="get" class="flex items-end gap-2">
          <input type="hidden" name="category" value={category} />
          <div class="form-control">
            <label class="label py-0"><span class="label-text text-xs">{t("donations.filter.from")}</span></label>
            <input type="date" name="start" value={start} class="input input-bordered" />
          </div>
          <div class="form-control">
            <label class="label py-0"><span class="label-text text-xs">{t("donations.filter.to")}</span></label>
            <input type="date" name="end" value={end} class="input input-bordered" />
          </div>
          <button type="submit" class="btn">{t("common.show")}</button>
        </form>
        <div class="join self-end">
          <a href={quickLink(3)} class="join-item btn">{t("anniversaries.quick.3months")}</a>
          <a href={quickLink(6)} class="join-item btn">{t("anniversaries.quick.6months")}</a>
          <a href={quickLink(12)} class="join-item btn">{t("anniversaries.quick.12months")}</a>
          <a href={qs({ start: `${thisYear}-01-01`, end: `${thisYear}-12-31` })} class="join-item btn">{t("anniversaries.quick.thisYear")}</a>
          <a href={qs({ start: `${nextYear}-01-01`, end: `${nextYear}-12-31` })} class="join-item btn">{t("anniversaries.quick.nextYear")}</a>
        </div>
        <div class="join self-end">
          <a href={qs({ category: undefined })} class={`join-item btn ${category === "" ? "btn-outline btn-primary" : ""}`}>{t("inventory.filter.allCategories")}</a>
          {CATEGORIES.filter((c) => c !== "other").map((cat) => (
            <a href={qs({ category: cat })} class={`join-item btn ${category === cat ? "btn-outline btn-primary" : ""}`}>{CATEGORY_LABELS[cat]}</a>
          ))}
        </div>
      </div>

      {due.length === 0 ? (
        <p class="text-base-content/60 py-8">{t("inventory.inspections.empty")}</p>
      ) : (
        <table class="table table-zebra w-full">
          <thead>
            <tr>
              <th>{t("inventory.inspections.table.item")}</th>
              <th>{t("inventory.inspections.table.category")}</th>
              <th>{t("inventory.inspections.table.dueDate")}</th>
            </tr>
          </thead>
          <tbody>
            {due.map((d) => {
              const overdue = d.dueDate < today;
              return (
                <tr key={d.id} class="cursor-pointer hover" onclick={`window.location='/inventory/${d.id}/edit'`}>
                  <td class={overdue ? "text-error font-semibold" : ""}>{d.name}</td>
                  <td><CategoryBadge category={d.category} /></td>
                  <td class={overdue ? "text-error font-semibold" : ""}>{formatDate(d.dueDate)} {overdue && <span class="badge badge-error badge-sm ml-1">{t("inventory.inspections.overdue")}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Layout>
  );
});

// GET /inventory/search-members — debounced live search for the PSA assignment
// picker and (scope=all) the Verleih-Ausleiher-Picker. Own route (not /members'
// search) so the aktiv/jugend filter is enforced by the query itself. Status is
// derived app-side (not stored), so every candidate's assignments are loaded to
// compute it — same approach as anniversaries.tsx.
// scope=active (default, PSA-Picker): nur aktiv/jugend. scope=all (Verleih-
// Picker): ungefiltert — auch Passive/Ehemalige können etwas ausleihen.
inventoryRoutes.get("/search-members", requireAuth(["inventory:manage", "lending:manage"]), async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.html("");
  const scope = c.req.query("scope") === "all" ? "all" : "active";

  // Status is derived app-side (not stored), so every candidate's assignments are
  // loaded to compute it — same approach as anniversaries.tsx. Member counts stay
  // small enough that this full scan is fine.
  const all = await db.query.members.findMany({ with: { person: true, assignments: { with: { role: true } } } });
  const matches = all.filter((m: any) => `${m.person.firstName} ${m.person.lastName}`.toLowerCase().includes(q.toLowerCase()));

  const results = matches
    .map((m: any) => ({
      id: m.id,
      firstName: m.person.firstName,
      lastName: m.person.lastName,
      status: deriveMemberStatus(m, m.assignments, env.CHILDREN_AGE_LIMIT, env.YOUTH_AGE_LIMIT),
    }))
    .filter((m) => scope === "all" || ASSIGNABLE_MEMBER_STATUSES.has(m.status))
    .sort((a, b) => a.lastName.localeCompare(b.lastName, "de"))
    .slice(0, 10);

  if (results.length === 0) {
    return c.html(<p class="p-2 text-sm opacity-60">{t("inventory.form.assignedMemberNoResults")}</p>);
  }

  return c.html(
    <>
      {results.map((m) => (
        <div
          key={m.id}
          class="member-result p-2 hover:bg-base-200 cursor-pointer text-sm"
          data-id={m.id}
          data-name={`${m.firstName} ${m.lastName}`}
        >
          {m.firstName} {m.lastName}
        </div>
      ))}
    </>
  );
});
