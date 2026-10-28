import { Hono } from "hono";
import { ToggleFilter } from "../components/toggle-filter.js";
import { Field, ViewField, ViewGrid } from "../components/field.js";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { inventoryItems, inventoryItemTags, inventoryItemNumbers, inventoryItemSerials, inventoryItemAssignments, lendingItems, lendingLoans, members } from "../db/schema/index.js";
import { Icon } from "../components/icon.js";
import { ImpressumHint } from "../components/impressum-hint.js";
import type { IconName } from "../components/icons.generated.js";
import { DetailActions, FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { formatDate } from "../lib/format.js";
import { ChipInput } from "../components/chip-input.js";
import { trimmed, parseTags, parseList } from "../lib/forms.js";
import { tagVocabulary, canonicalizeTags, TAG_SUGGESTIONS_ID, tagSuggestionsJson } from "../lib/tags.js";
import { buildListUrl, parseMulti, parsePagination, PAGE_SIZE_OPTIONS } from "../lib/list-query.js";
import { QuickRangeFilter } from "../components/quick-range-filter.js";
import { addMonths, parseRange, rangeParams, rangePresets } from "../lib/quick-range.js";
import { Pager } from "../components/pager.js";
import { MultiSelectFilter } from "../components/multi-select-filter.js";
import { generateInspectionDueItems, type InventoryCategory } from "../lib/inventory.js";
import { availableQuantity, itemStatus } from "../lib/lending.js";
import { deriveMemberStatus } from "../lib/status.js";
import { env } from "../env.js";
import { SEARCH_DEBOUNCE_MS } from "../lib/constants.js";

export const inventoryRoutes = new Hono<{ Variables: Variables }>();

// ── Types ────────────────────────────────────────────────────────────────────

type InventoryItemRow = typeof inventoryItems.$inferSelect;
type Tag = typeof inventoryItemTags.$inferSelect;
type ItemNumber = typeof inventoryItemNumbers.$inferSelect;
type ItemSerial = typeof inventoryItemSerials.$inferSelect;
type MemberRow = typeof members.$inferSelect;
type Person = { firstName: string; lastName: string };
type AssignmentWithMember = typeof inventoryItemAssignments.$inferSelect & { member: MemberRow & { person: Person } };
type ItemWithRelations = InventoryItemRow & { tags: Tag[]; numbers: ItemNumber[]; serials: ItemSerial[]; assignments: AssignmentWithMember[] };

// Which categories may be entered as a batch ("30 Helme" instead of one item per
// piece). A plain list, not scattered if/category checks, so a future category
// opts in with one line here.
const CATEGORY_CONFIG: { category: InventoryCategory; batchCapable: boolean; icon: IconName }[] = [
  { category: "vehicle", batchCapable: false, icon: "firetruck" },
  { category: "scba", batchCapable: false, icon: "shield-check" },
  { category: "equipment", batchCapable: true, icon: "wrench-screwdriver" },
  { category: "ppe", batchCapable: true, icon: "jacket" },
  { category: "other", batchCapable: true, icon: "squares-2x2" },
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
const ASSIGNABLE_MEMBER_STATUSES = new Set(["active", "youth"]);

export function CategoryBadge({ category }: { category: InventoryCategory }) {
  return <span class={`${CATEGORY_BADGE[category]} badge-sm`}>{CATEGORY_LABELS[category]}</span>;
}

// ── Form field parsing ───────────────────────────────────────────────────────

type AssignmentInput = { memberId: string; name: string; quantity: number };

export type InventoryFieldValues = {
  name: string;
  category: string;
  commissionedAt: string;
  numbersList?: string[];
  purchasePrice: string;
  notes: string;
  tagsList?: string[];
  licensePlate: string;
  yearOfManufacture: string;
  vehicleInspectionDue: string;
  serialsList?: string[];
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
    commissionedAt: trimmed(body, "commissionedAt"),
    purchasePrice: trimmed(body, "purchasePrice"),
    notes: trimmed(body, "notes"),
    licensePlate: trimmed(body, "licensePlate"),
    yearOfManufacture: trimmed(body, "yearOfManufacture"),
    vehicleInspectionDue: trimmed(body, "vehicleInspectionDue"),
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
    commissionedAt: values.commissionedAt || null,
    purchasePrice: values.purchasePrice ? values.purchasePrice.replace(",", ".") : null,
    notes: values.notes || null,
    quantity,
    licensePlate: category === "vehicle" ? values.licensePlate || null : null,
    yearOfManufacture: category === "vehicle" && values.yearOfManufacture ? Number(values.yearOfManufacture) : null,
    vehicleInspectionDue: category === "vehicle" ? values.vehicleInspectionDue || null : null,
    // A batch's serial number doesn't identify one piece — dropped once quantity > 1.
    nextInspectionDue: category === "scba" || category === "equipment" || category === "ppe" ? values.nextInspectionDue || null : null,
    lastInspectionDate: category === "scba" ? values.lastInspectionDate || null : null,
  };
}

// ── Inventory numbers ────────────────────────────────────────────────────────

const NUMBER_MAX_LENGTH = 100;

const natural = (a: string, b: string) => a.localeCompare(b, "de", { numeric: true });

export function sortedNumbers(item: { numbers?: { number: string }[] }): string[] {
  return (item.numbers ?? []).map((n) => n.number).sort(natural);
}

export function sortedSerials(item: { serials?: { serial: string }[] }): string[] {
  return (item.serials ?? []).map((n) => n.serial).sort(natural);
}

const SERIAL_CATEGORIES = new Set<string>(["scba", "equipment", "ppe"]);

// Seriennummern: höchstens eine pro Stück, nicht global eindeutig. Andere Kategorien ignorieren sie.
function validateSerials(serials: string[], quantity: number): string | undefined {
  if (serials.length > quantity) return t("inventory.form.serialsTooMany", { max: quantity });
  // eslint-disable-next-line no-control-regex
  if (serials.some((n) => n.length > NUMBER_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(n))) return t("inventory.form.numberInvalid");
  return undefined;
}

// Returns an error message or undefined. Numbers are globally unique and case-sensitive;
// numbers of archived items stay taken. A race past this check hits the unique index.
async function validateNumbers(numbers: string[], quantity: number, selfId?: string): Promise<string | undefined> {
  if (numbers.length > quantity) return t("inventory.form.numbersTooMany", { max: quantity });
  // eslint-disable-next-line no-control-regex
  if (numbers.some((n) => n.length > NUMBER_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(n))) return t("inventory.form.numberInvalid");
  if (numbers.length === 0) return undefined;
  const rows = await db.query.inventoryItemNumbers.findMany({ where: inArray(inventoryItemNumbers.number, numbers), with: { item: true } });
  const taken = rows.find((r: any) => r.inventoryItemId !== selfId);
  if (!taken) return undefined;
  const item = (taken as any).item;
  return t("inventory.form.numberTaken", { number: taken.number, item: item.name, archived: item.retiredAt ? ` ${t("inventory.form.archivedSuffix")}` : "" });
}

// Postgres unique_violation (23505) — z. B. wenn zwischen Vorabprüfung und Insert jemand
// dieselbe Inventarnummer vergibt. Drizzle kann den Fehler in `cause` verpacken.
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

// Menge 1: einfaches Textfeld; ab Menge 2: ChipInput. Beide tragen denselben Feldnamen,
// das jeweils verborgene Feld ist disabled (wird nicht gesendet) — Umschalten per Skript.
function NumberListField({ name, label, labelSingle, placeholder, placeholderSingle, values, quantity, error }: {
  name: string; label: string; labelSingle: string; placeholder: string; placeholderSingle: string;
  values?: string[]; quantity: number; error?: string;
}) {
  const multi = quantity > 1;
  const list = values ?? [];
  return (
    <div data-numlist>
      <div data-numlist-single class={multi ? "hidden" : ""}>
        <Field label={labelSingle}>
          <input type="text" name={name} value={list[0] ?? ""} placeholder={placeholderSingle} disabled={multi} maxlength={NUMBER_MAX_LENGTH}
            class={`input w-full${error ? " input-error" : ""}`} />
        </Field>
      </div>
      <div data-numlist-multi class={multi ? "" : "hidden"}>
        <ChipInput name={name} label={label} placeholder={placeholder} values={multi ? list : []} maxFrom="#inventory-quantity" max={quantity}
          hint={t("inventory.form.numbersCounter")} />
      </div>
      {error && <span class="text-error text-sm">{error}</span>}
      <script dangerouslySetInnerHTML={{ __html: `
        if (!window.__numListBound) {
          window.__numListBound = true;
          function syncNumLists() {
            var qf = document.getElementById('inventory-quantity');
            var multi = (parseInt(qf && qf.value, 10) || 1) > 1;
            document.querySelectorAll('[data-numlist]').forEach(function(root) {
              var was = root.dataset.mode;
              var mode = multi ? 'multi' : 'single';
              if (was === mode) return;
              root.dataset.mode = mode;
              var single = root.querySelector('[data-numlist-single] input');
              var chipRoot = root.querySelector('[data-chip-input]');
              root.querySelector('[data-numlist-single]').classList.toggle('hidden', multi);
              root.querySelector('[data-numlist-multi]').classList.toggle('hidden', !multi);
              single.disabled = multi;
              chipRoot.querySelectorAll('[data-chip] input[type=hidden]').forEach(function(h){ h.disabled = !multi; });
              if (was && !multi && !single.value) { var first = chipRoot.querySelector('[data-chip]'); if (first) single.value = first.dataset.chip; }
              if (was && multi && single.value.trim()) chipAdd(chipRoot, single.value);
              chipRefresh(chipRoot);
            });
          }
          document.addEventListener('input', syncNumLists);
          document.addEventListener('DOMContentLoaded', syncNumLists);
        }
        if (typeof syncNumLists === 'function') syncNumLists();
      ` }} />
    </div>
  );
}

// ── Tag input (thin wrapper over the generic ChipInput) ─────────────────────

export async function TagSuggestions() {
  return <script type="application/json" id={TAG_SUGGESTIONS_ID} dangerouslySetInnerHTML={{ __html: tagSuggestionsJson(await tagVocabulary()) }} />;
}

export function TagInput({ tags }: { tags?: string[] }) {
  return (
    <>
      <TagSuggestions />
      <ChipInput name="tags" label={t("inventory.form.tags")} placeholder={t("inventory.form.tagsPlaceholder")} values={tags} splitOnComma caseSensitive={false} suggestionsFrom={`#${TAG_SUGGESTIONS_ID}`} />
    </>
  );
}

// ── Assigned-member picker(s) (search existing aktiv/jugend members, no create) ─
// Single-item mode (quantity 1, ppe only): one member, same simple UI as before.
// Batch mode (quantity > 1): a list, each member with how many of the batch they hold.

function MemberPickerFields({ memberId, memberName }: { memberId?: string; memberName?: string }) {
  const showSelected = Boolean(memberId);
  return (
    <div class="flex flex-col" data-show-cats="ppe" data-show-batch="false">
      <p class="fieldset-legend">{t("inventory.form.assignedMember")}</p>
      <div id="member-picker-search" class={showSelected ? "hidden" : ""}>
        <label class="input flex items-center gap-2 w-full">
          <Icon name="magnifying-glass" class="w-4 h-4 opacity-60" />
          <input
            type="text"
            name="q"
            autocomplete="off"
            placeholder={t("inventory.form.assignedMemberSearchPlaceholder")}
            class="grow min-w-0"
            hx-get="/inventory/search-members"
            hx-trigger={`input changed delay:${SEARCH_DEBOUNCE_MS}ms`}
            hx-target="#member-picker-results"
          />
        </label>
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
    <div class="flex flex-col" data-show-cats={[...BATCH_CAPABLE_CATEGORIES].join(",")} data-show-batch="true">
      <p class="fieldset-legend">{t("inventory.form.assignedMembers")}</p>
      <div id="batch-assign-list" class="space-y-1 mb-2 empty:mb-0">
        {assignments.map((a) => (
          <div class="flex items-center gap-2 border border-base-300 rounded-box px-2 py-1" data-assignment data-member-id={a.memberId} data-member-name={a.name}>
            <span class="flex-1 text-sm">{a.name}</span>
            <input type="number" min="1" value={a.quantity} class="input-sm w-20 assignment-qty" />
            <button type="button" class="btn btn-ghost btn-sm assignment-remove" aria-label={t("common.remove")}>×</button>
          </div>
        ))}
      </div>
      <div id="batch-assign-search">
        <label class="input flex items-center gap-2 w-full">
          <Icon name="magnifying-glass" class="w-4 h-4 opacity-60" />
          <input
            type="text"
            name="q"
            autocomplete="off"
            placeholder={t("inventory.form.assignedMemberSearchPlaceholder")}
            class="grow min-w-0"
            hx-get="/inventory/search-members"
            hx-trigger={`input changed delay:${SEARCH_DEBOUNCE_MS}ms`}
            hx-target="#batch-assign-results"
          />
        </label>
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
                '<input type="number" min="1" value="1" class="input-sm w-20 assignment-qty" />' +
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
    // batch mode is derived from quantity > 1 server-side; a batch of 1 would silently save as single item
    if (qtyInput && isBatch && __inventoryBatchCats.indexOf(cat) >= 0 && Number(qtyInput.value) < 2) {
      qtyInput.value = '2';
      qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (qtyInput && !(isBatch && __inventoryBatchCats.indexOf(cat) >= 0) && qtyInput.value !== '1') {
      qtyInput.value = '1';
      // programmatic changes fire no event; ChipInput listens for it to refresh label/counter/limit
      qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
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
      <Field label={t("inventory.form.name")} required>
        <input type="text" name="name" value={v.name ?? ""} class={`input w-full${errors?.name ? " input-error" : ""}`} placeholder={t("inventory.form.name")} />
        {errors?.name && <span class="text-error text-sm mt-1">{errors.name}</span>}
      </Field>

      <Field label={t("inventory.form.category")} required floating={false}>
        {/* Radios stay the only submitted source; the nameless <select> mirrors them on narrow containers. */}
        <div class="@container">
          <select
            id="inventory-category-select"
            class="select w-full @sm:hidden"
            onchange="document.querySelector('input[name=category][value=' + this.value + ']').checked = true; updateInventoryFormVisibility()"
          >
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="" disabled selected={!v.category} hidden></option>
            {CATEGORY_CONFIG.map(({ category, icon }) => (
              <option value={category} selected={v.category === category}>
                <Icon name={icon} class="size-5" />
                {CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
          <div class="join hidden @sm:inline-flex">
            {CATEGORY_CONFIG.map(({ category, icon }) => (
              <label class="join-item btn has-[:checked]:btn-outline has-[:checked]:btn-primary" title={CATEGORY_LABELS[category]}>
                <input
                  type="radio"
                  name="category"
                  value={category}
                  checked={v.category === category}
                  class="hidden"
                  onchange="document.getElementById('inventory-category-select').value = this.value; updateInventoryFormVisibility()"
                />
                <Icon name={icon} class="size-5" />
                <span class="sr-only @xl:not-sr-only">{CATEGORY_LABELS[category]}</span>
              </label>
            ))}
          </div>
        </div>
        {errors?.category && <span class="text-error text-sm mt-1">{errors.category}</span>}
      </Field>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t("inventory.form.commissionedAt")}>
          <input type="date" name="commissionedAt" value={v.commissionedAt ?? ""} class="input w-full" />
        </Field>
        <Field label={t("inventory.form.purchasePrice")} after={<span class="block text-xs opacity-60 mt-1" data-show-cats={[...BATCH_CAPABLE_CATEGORIES].join(",")} data-show-batch="true">{t("inventory.form.quantityTotalHint")}</span>}>
          <input type="text" inputmode="decimal" name="purchasePrice" value={v.purchasePrice ?? ""} class={`input w-full${errors?.purchasePrice ? " input-error" : ""}`} placeholder={t("inventory.form.purchasePrice")} />
          {errors?.purchasePrice && <span class="text-error text-sm mt-1">{errors.purchasePrice}</span>}
        </Field>
      </div>

      <Field label={t("inventory.form.notes")}>
        <textarea name="notes" class="textarea w-full" rows={3} placeholder={t("inventory.form.notes")}>{v.notes ?? ""}</textarea>
      </Field>

      <TagInput tags={v.tagsList} />

      <div data-show-cats="vehicle" class="space-y-4">
        <div class="divider">{CATEGORY_LABELS.vehicle}</div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label={t("inventory.form.licensePlate")}>
            <input type="text" name="licensePlate" value={v.licensePlate ?? ""} class="input w-full" placeholder={t("inventory.form.licensePlate")} />
          </Field>
          <Field label={t("inventory.form.yearOfManufacture")}>
            <input type="text" inputmode="numeric" name="yearOfManufacture" value={v.yearOfManufacture ?? ""} class={`input w-full${errors?.yearOfManufacture ? " input-error" : ""}`} placeholder={t("inventory.form.yearOfManufacture")} />
            {errors?.yearOfManufacture && <span class="text-error text-sm mt-1">{errors.yearOfManufacture}</span>}
          </Field>
          <Field label={t("inventory.form.vehicleInspectionDue")}>
            <input type="date" name="vehicleInspectionDue" value={v.vehicleInspectionDue ?? ""} class="input w-full" />
          </Field>
        </div>
      </div>

      <div data-show-cats="scba,equipment,ppe" class="space-y-4">
        <div class="divider">{t("inventory.form.sectionInspection")}</div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label={t("inventory.form.lastInspectionDate")}>
            <input type="date" name="lastInspectionDate" value={v.lastInspectionDate ?? ""} class="input w-full" />
          </Field>
          <Field label={t("inventory.form.nextInspectionDue")}>
            <input type="date" name="nextInspectionDue" value={v.nextInspectionDue ?? ""} class="input w-full" />
          </Field>
        </div>
      </div>

      <div data-show-cats={[...BATCH_CAPABLE_CATEGORIES].join(",")} class="space-y-4">
        <div class="divider">{t("inventory.form.batchToggle")}</div>
        <label class="label cursor-pointer justify-start gap-2 w-fit">
          <input type="checkbox" id="inventory-batch-toggle" checked={isBatch} class="checkbox" onchange="updateInventoryFormVisibility()" />
          <span class="text-sm">{t("inventory.form.batchToggle")}</span>
        </label>
        <div data-show-cats={[...BATCH_CAPABLE_CATEGORIES].join(",")} data-show-batch="true">
        <Field label={t("inventory.form.quantity")} class="max-w-40">
          <input
            type="number"
            id="inventory-quantity"
            name="quantity"
            min="1"
            value={v.quantity ?? "1"}
            class={`input w-full${errors?.quantity ? " input-error" : ""}`} placeholder={t("inventory.form.quantity")}
          />
          {errors?.quantity && <span class="text-error text-sm mt-1">{errors.quantity}</span>}
        </Field>
        </div>
      </div>

      <NumberListField
        name="numbers"
        label={t("inventory.form.inventoryNumbers")}
        labelSingle={t("inventory.form.inventoryNumber")}
        placeholder={t("inventory.form.inventoryNumbersPlaceholder")}
        placeholderSingle={t("inventory.form.inventoryNumberPlaceholder")}
        values={v.numbersList}
        quantity={quantity}
        error={errors?.numbers}
      />

      <div data-show-cats="scba,equipment,ppe">
        <NumberListField
          name="serials"
          label={t("inventory.form.serialNumbers")}
          labelSingle={t("inventory.form.serialNumber")}
          placeholder={t("inventory.form.serialNumbersPlaceholder")}
          placeholderSingle={t("inventory.form.serialNumberPlaceholder")}
          values={v.serialsList}
          quantity={quantity}
          error={errors?.serials}
        />
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
    with: { tags: true, numbers: true, serials: true, assignments: { with: { member: { with: { person: true } } } } },
    orderBy: (items, { asc }) => [asc(items.name)],
  }) as unknown as Promise<ItemWithRelations[]>;
}

async function fetchItem(id: string): Promise<ItemWithRelations | undefined> {
  return db.query.inventoryItems.findFirst({
    where: eq(inventoryItems.id, id),
    with: { tags: true, numbers: true, serials: true, assignments: { with: { member: { with: { person: true } } } } },
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
  const categoryFilter = parseMulti(c.req.queries("category"), CATEGORIES);
  const tagFilter = c.req.queries("tag") ?? [];
  const search = (q.q ?? "").trim();
  const showArchived = q.archived === "1";
  const canSeeLending = user.permissions.has("lending:read");
  const canLend = user.permissions.has("lending:manage");
  const lendableOnly = canSeeLending && q.lendable === "1";

  const all = await fetchItems();

  // Verleihstatus pro Item (nur mit lending:read): lending_items-Id + Verfügbarkeit heute.
  const lendingByItem = new Map<string, { id: string; available: number; publicRequestable: boolean }>();
  if (canSeeLending) {
    const today = new Date().toISOString().slice(0, 10);
    const byId = new Map(all.map((item) => [item.id, item]));
    const lendingRows = await db.query.lendingItems.findMany({ with: { loans: true } });
    for (const row of lendingRows) {
      const item = byId.get(row.inventoryItemId);
      if (item) lendingByItem.set(item.id, { id: row.id, available: availableQuantity(item, row.loans, today), publicRequestable: row.publicRequestable });
    }
  }
  const allTags = [...new Set(all.flatMap((item) => item.tags.map((t) => t.tag)))].sort((a, b) => a.localeCompare(b, "de"));

  const filtered = all.filter((item) => {
    if (!showArchived && item.retiredAt) return false;
    if (categoryFilter.length > 0 && !categoryFilter.includes(item.category)) return false;
    if (tagFilter.length > 0 && !tagFilter.every((wanted) => item.tags.some((t) => t.tag === wanted))) return false;
    if (lendableOnly && !lendingByItem.has(item.id)) return false;
    if (search) {
      const needle = search.toLowerCase();
      const hay = [item.name, ...item.serials.map((n) => n.serial), ...item.numbers.map((n) => n.number)];
      if (!hay.some((h) => h.toLowerCase().includes(needle))) return false;
    }
    return true;
  });

  const { page: reqPage, pageSize } = parsePagination(q);
  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(reqPage, totalPages);
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);
  const pageUrl = (p: number) => buildListUrl("/inventory", { q: search, category: categoryFilter, tag: tagFilter, archived: showArchived ? "1" : undefined, lendable: lendableOnly ? "1" : undefined, pageSize }, { page: p });

  const qs = (extra: Record<string, string | string[] | undefined>) =>
    buildListUrl("/inventory", { q: search, category: categoryFilter, tag: tagFilter, archived: showArchived ? "1" : undefined, lendable: lendableOnly ? "1" : undefined }, extra);
  const columnCount = 6 + (canLend ? 1 : 0);

  return c.html(
    <Layout title={t("inventory.title")} user={user}>
      <PageHeader title={t("inventory.title")} actions={<>
        {user.permissions.has("import:run") && <HeaderAction icon="arrow-up-tray" label={t("import.action")} href="/import?kind=inventory" />}
        {user.permissions.has("inventory:manage") && <HeaderAction variant="primary" icon="plus" label={t("inventory.newItem")} href="/inventory/new" class="btn-primary" />}
      </>} />

      <div class="filter-bar flex flex-wrap items-center gap-3 mb-4">
        <form method="get" action="/inventory" class="contents">
          <label class="input flex items-center gap-2 w-72">
            <Icon name="magnifying-glass" class="w-4 h-4 opacity-60" />
            <input
              type="search"
              name="q"
              value={search}
              autocomplete="off"
              placeholder={t("inventory.search.placeholder")}
              class="grow min-w-0"
              hx-get="/inventory"
              hx-include="closest form"
              hx-trigger={`input changed delay:${SEARCH_DEBOUNCE_MS}ms`}
              hx-target="#inventory-results"
              hx-select="#inventory-results"
              hx-swap="outerHTML"
              hx-push-url="true"
            />
          </label>
          {categoryFilter.map((v) => <input type="hidden" name="category" value={v} />)}
          {tagFilter.map((v) => <input type="hidden" name="tag" value={v} />)}
          {showArchived && <input type="hidden" name="archived" value="1" />}
          {lendableOnly && <input type="hidden" name="lendable" value="1" />}
        </form>
        <MultiSelectFilter
          param="category"
          autoApply
          options={CATEGORIES.map((cat) => ({ value: cat, label: CATEGORY_LABELS[cat] }))}
          selected={categoryFilter}
          allLabel={t("inventory.filter.allCategories")}
          countLabel={(count) => t("inventory.filter.categoryCount", { count })}
          applyLabel={t("common.apply")}
          resetLabel={t("common.reset")}
        />
        <MultiSelectFilter
          param="tag"
          autoApply
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

        <ToggleFilter items={[
          { label: t("inventory.filter.showArchived"), checked: showArchived, href: qs({ archived: showArchived ? undefined : "1" }) },
          ...(canSeeLending ? [{ label: t("inventory.filter.lendable"), checked: lendableOnly, href: qs({ lendable: lendableOnly ? undefined : "1" }) }] : []),
        ]} />
      </div>

      <div id="inventory-results">
      <div class="overflow-x-auto">
      <table class="table table-zebra w-full">
        <thead>
          <tr>
            <th>{t("inventory.table.name")}</th>
            <th>{t("inventory.table.category")}</th>
            <th class="hidden md:table-cell">{t("inventory.table.dueDate")}</th>
            <th class="hidden lg:table-cell">{t("inventory.table.tags")}</th>
            <th>{t("inventory.table.status")}</th>
            <th class="hidden md:table-cell">{t("inventory.table.quantity")}</th>
            {canLend && <th></th>}
          </tr>
        </thead>
        <tbody>
          {pageItems.length === 0 ? (
            <tr><td colspan={columnCount} class="text-center opacity-50 py-8">{t("inventory.table.empty")}</td></tr>
          ) : pageItems.map((item) => {
            const due = item.category === "vehicle" ? item.vehicleInspectionDue : item.nextInspectionDue;
            const lending = lendingByItem.get(item.id);
            const status = itemStatus(item, !!lending);
            return (
              <tr key={item.id} class="cursor-pointer hover" onclick={`window.location='/inventory/${item.id}'`}>
                <td>{item.name}</td>
                <td><CategoryBadge category={item.category as InventoryCategory} /></td>
                <td class="hidden md:table-cell">{due ? formatDate(due) : "—"}</td>
                <td class="hidden lg:table-cell">
                  <div class="flex flex-wrap gap-1">
                    {item.tags.map((tag) => <span class="badge badge-ghost badge-sm">{tag.tag}</span>)}
                  </div>
                </td>
                <td>
                  {status === "retired" && <span class="badge badge-neutral badge-sm">{t("inventory.status.retired")}</span>}
                  {status === "lendable" && <span class="badge badge-info badge-sm">{t("inventory.status.lendable")}</span>}
                  {status === "active" && <span class="badge badge-success badge-sm">{t("inventory.status.active")}</span>}
                  {lending?.publicRequestable && <span class="badge badge-ghost badge-sm ml-1">{t("lend.form.publicBadge")}</span>}
                </td>
                <td class="hidden md:table-cell">
                  {lending
                    ? <span class={`badge badge-sm ${lending.available <= 0 ? "badge-warning" : "badge-outline"}`}>{t("inventory.lending.available", { count: lending.available })}</span>
                    : item.quantity > 1 && <span class="badge badge-outline badge-sm">{item.quantity - item.retiredQuantity}</span>}
                </td>
                {canLend && (
                  <td>
                    {lending && !item.retiredAt && (
                      <a href={`/inventory/lending/loans/new?item=${lending.id}`} class="btn btn-ghost btn-sm" onclick="event.stopPropagation()">
                        {t("inventory.lending.lend")}
                      </a>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <Pager
        countLabel={t("inventory.table.count", { count: totalCount })}
        page={page}
        totalPages={totalPages}
        pageUrl={pageUrl}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        pageSizeStorageKey="inventory_pageSize"
      />
      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          const saved = localStorage.getItem('inventory_pageSize');
          const url = new URL(window.location.href);
          if (saved && !url.searchParams.has('pageSize')) {
            url.searchParams.set('pageSize', saved);
            url.searchParams.set('page', '1');
            window.location.replace(url.toString());
          }
        })();
      ` }} />
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

type LendableField = {
  checked: boolean; editable: boolean; locked: boolean; error?: string;
  individualTracking: boolean;
  publicRequestable: boolean; maxRequestQuantity: number; timesRequired: boolean;
  requestLink?: string;
  errors?: { maxRequestQuantity?: string };
};

function lendableField(
  user: { permissions: Set<string> },
  checked: boolean,
  opts: {
    editable?: boolean; locked?: boolean; error?: string;
    individualTracking?: boolean;
    publicRequestable?: boolean; maxRequestQuantity?: number; timesRequired?: boolean;
    requestLink?: string;
    errors?: { maxRequestQuantity?: string };
  } = {},
): LendableField | undefined {
  if (!user.permissions.has("lending:read")) return undefined;
  return {
    checked, editable: user.permissions.has("lending:manage") && (opts.editable ?? true), locked: opts.locked ?? false, error: opts.error,
    individualTracking: opts.individualTracking ?? false,
    publicRequestable: opts.publicRequestable ?? false,
    maxRequestQuantity: opts.maxRequestQuantity ?? 0,
    timesRequired: opts.timesRequired ?? false,
    requestLink: opts.requestLink,
    errors: opts.errors,
  };
}

function InventoryForm({ title, action, values, errors, formId, assignedMemberName, assignments, extraActions, lendable, cancelHref }: {
  title: string;
  action: string;
  values?: Partial<InventoryFieldValues>;
  errors?: Record<string, string>;
  formId: string;
  assignedMemberName?: string;
  assignments?: AssignmentInput[];
  extraActions?: any;
  lendable?: LendableField;
  cancelHref?: string;
}) {
  return (
    <>
      <PageHeader title={title} backHref={cancelHref ?? "/inventory"} subtitle={t("common.requiredLegend")} actions={<>{extraActions}<FormActions formId={formId} cancelHref={cancelHref} /></>} />
      <form id={formId} method="post" action={action} class="space-y-4 max-w-2xl">
        <InventoryFormFields values={values} errors={errors} assignedMemberName={assignedMemberName} assignments={assignments} />
        {lendable && (
          <fieldset class="card card-border bg-base-100 border-base-300">
            <div class="card-body gap-4 p-4">
              <legend class="sr-only">{t("inventory.form.lendSection")}</legend>
              <div>
                <h2 class="font-semibold">{t("inventory.form.lendSection")}</h2>
                <p class="text-sm opacity-70">{t("inventory.form.lendSectionHint")}</p>
              </div>
              <label class="flex items-start gap-3 cursor-pointer pointer-coarse:min-h-11">
                <input type="checkbox" name="lendable" value="1" checked={lendable.checked}
                  disabled={!lendable.editable || lendable.locked} onchange="document.getElementById('lendable-config').hidden=!this.checked" class="toggle toggle-success mt-0.5" />
                <span class="flex flex-col">
                  <span class="font-medium">{t("inventory.form.lendable")}</span>
                  <span class="text-sm opacity-70">{t("inventory.form.lendableHint")}</span>
                </span>
              </label>
              {/* Gesperrte Checkbox wird nicht gesendet — Hidden-Feld hält den Wert, damit "gesetzt" nicht als Abwahl gilt. */}
              {lendable.editable && lendable.locked && <input type="hidden" name="lendable" value="1" />}
              {lendable.locked && <p class="text-sm opacity-70">{t("inventory.form.lendableLocked")}</p>}
              {!lendable.editable && <p class="text-sm opacity-70">{t("inventory.form.lendableReadonly")}</p>}
              {lendable.error && <p class="text-error text-sm">{lendable.error}</p>}
              {lendable.editable && (
                <div id="lendable-config" hidden={!lendable.checked}>
                <div class="flex flex-col gap-4 border-t border-base-300 pt-4">
                  <label class="flex items-start gap-3 cursor-pointer pointer-coarse:min-h-11">
                    <input type="checkbox" name="publicRequestable" value="1" checked={lendable.publicRequestable} class="toggle toggle-success mt-0.5" />
                    <span class="flex flex-col">
                      <span class="font-medium">{t("lend.form.publicRequestable")}</span>
                      <span class="text-sm opacity-70">{t("lend.form.publicRequestableHint")}</span>
                    </span>
                  </label>
                  {lendable.publicRequestable && <ImpressumHint />}
                  {lendable.publicRequestable && lendable.requestLink && (
                    <div class="flex flex-col gap-1">
                      <span class="text-sm font-medium">{t("lend.form.requestLink")}</span>
                      <div class="flex items-center gap-2">
                        <input type="text" readonly value={lendable.requestLink} class="input input-sm flex-1" />
                        <button type="button" class="btn min-h-11 min-w-11" aria-label={t("common.copy")} title={t("common.copy")} onclick="navigator.clipboard.writeText(this.previousElementSibling.value)">
                          <Icon name="document-duplicate" class="h-5 w-5 shrink-0" />
                          <span class="max-sm:hidden">{t("common.copy")}</span>
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Server ignoriert maxRequestQuantity für individualTracking-Artikel (fix seit Anlage, siehe unten) — Feld dann gar nicht erst anzeigen. */}
                  {!lendable.individualTracking && (
                  <div data-show-cats={[...BATCH_CAPABLE_CATEGORIES].join(",")} data-show-batch="true">
                    <label class="flex items-start gap-3 cursor-pointer pointer-coarse:min-h-11">
                      <input type="checkbox" name="maxRequestLimited" value="1" checked={lendable.maxRequestQuantity > 0 || Boolean(lendable.errors?.maxRequestQuantity)} class="toggle toggle-success mt-0.5"
                        onchange="document.getElementById('max-request-quantity').hidden = !this.checked" />
                      <span class="font-medium">{t("lend.form.maxRequestQuantity")}</span>
                    </label>
                    <div id="max-request-quantity" hidden={lendable.maxRequestQuantity <= 0 && !lendable.errors?.maxRequestQuantity} class="mt-2">
                      <Field label={t("lend.form.maxRequestQuantity")} class="max-w-40" hint={t("lend.form.maxRequestQuantityHint")}
                        after={lendable.errors?.maxRequestQuantity && <p class="text-error text-sm mt-1">{lendable.errors.maxRequestQuantity}</p>}>
                        <input type="number" name="maxRequestQuantity" min="1" value={lendable.maxRequestQuantity > 0 ? String(lendable.maxRequestQuantity) : ""} placeholder=" " class={`input w-full${lendable.errors?.maxRequestQuantity ? " input-error" : ""}`} />
                      </Field>
                    </div>
                  </div>
                  )}
                  <script dangerouslySetInnerHTML={{ __html: "updateInventoryFormVisibility()" }} />
                  <label class="flex items-start gap-3 cursor-pointer pointer-coarse:min-h-11">
                    <input type="checkbox" name="timesRequired" value="1" checked={lendable.timesRequired} class="toggle toggle-success mt-0.5" />
                    <span class="flex flex-col">
                      <span class="font-medium">{t("lend.form.timesRequired")}</span>
                      <span class="text-sm opacity-70">{t("lend.form.timesRequiredHint")}</span>
                    </span>
                  </label>
                </div>
                </div>
              )}
            </div>
          </fieldset>
        )}
      </form>
    </>
  );
}

// GET /inventory/new
inventoryRoutes.get("/new", requireAuth("inventory:manage"), async (c) => {
  const user = c.get("user")!;
  return c.html(
    <Layout title={t("inventory.newItem")} user={user}>
      <InventoryForm title={t("inventory.newItem")} action="/inventory" formId="inventory-new-form" lendable={lendableField(user, false, {})} />
    </Layout>
  );
});

// POST /inventory
inventoryRoutes.post("/", requireAuth("inventory:manage"), async (c) => {
  const user = c.get("user")!;
  const body = await c.req.parseBody({ all: true });
  const { values, errors } = parseInventoryFields(body);
  const tags = canonicalizeTags(parseTags(body, "tags"), await tagVocabulary());
  const numbers = parseList(body, "numbers");
  const serials = SERIAL_CATEGORIES.has(values.category) ? parseList(body, "serials") : [];
  const category = values.category as InventoryCategory;
  const insertValues = toInsertValues(values);
  const { assignments, error: assignmentError } = resolveAssignments(values, category, insertValues.quantity);
  if (assignmentError) errors.assignments = assignmentError;
  const numbersError = await validateNumbers(numbers, insertValues.quantity);
  if (numbersError) errors.numbers = numbersError;
  const serialsError = validateSerials(serials, insertValues.quantity);
  if (serialsError) errors.serials = serialsError;
  const wantsLendable = trimmed(body, "lendable") === "1";
  const canManageLending = user.permissions.has("lending:manage");
  const publicRequestable = canManageLending && trimmed(body, "publicRequestable") === "1";
  const timesRequired = canManageLending && trimmed(body, "timesRequired") === "1";
  let maxRequestQuantity = 0;
  let maxRequestQuantityError: string | undefined;
  if (canManageLending && wantsLendable && insertValues.quantity > 1) {
    const limited = trimmed(body, "maxRequestLimited") === "1";
    if (limited) maxRequestQuantity = Number(trimmed(body, "maxRequestQuantity"));
    if (limited && (!Number.isInteger(maxRequestQuantity) || maxRequestQuantity < 1 || maxRequestQuantity > insertValues.quantity)) maxRequestQuantityError = t("lending.loans.error.invalidQuantity");
  }

  if (Object.keys(errors).length > 0 || maxRequestQuantityError) {
    const assignmentNames = await resolveAssignmentNames(assignments);
    return c.html(
      <Layout title={t("inventory.newItem")} user={user}>
        <InventoryForm
          title={t("inventory.newItem")}
          action="/inventory"
          formId="inventory-new-form"
          values={{ ...values, tagsList: tags, numbersList: numbers, serialsList: serials }}
          errors={errors}
          assignedMemberName={assignmentNames[0]?.name}
          assignments={assignmentNames}
          lendable={lendableField(user, wantsLendable, { publicRequestable, maxRequestQuantity, timesRequired, errors: { maxRequestQuantity: maxRequestQuantityError } })}
        />
      </Layout>,
      422
    );
  }

  let newId = "";
  try {
  await db.transaction(async (tx) => {
    const [item] = await tx.insert(inventoryItems).values(insertValues).returning();
    newId = item.id;
    if (tags.length > 0) {
      await tx.insert(inventoryItemTags).values(tags.map((tag) => ({ inventoryItemId: item.id, tag })));
    }
    if (numbers.length > 0) {
      await tx.insert(inventoryItemNumbers).values(numbers.map((number) => ({ inventoryItemId: item.id, number })));
    }
    if (serials.length > 0) {
      await tx.insert(inventoryItemSerials).values(serials.map((serial) => ({ inventoryItemId: item.id, serial })));
    }
    // Serverseitig erzwungen: ohne lending:manage wird das Flag ignoriert, egal was gesendet wird.
    // ponytail: Einzel-Tracking aus quantity abgeleitet und danach fix — späteres Erhöhen der Menge ändert den Modus nicht.
    if (wantsLendable && user.permissions.has("lending:manage")) {
      await tx.insert(lendingItems).values({ inventoryItemId: item.id, individualTracking: item.quantity <= 1, publicRequestable, maxRequestQuantity, timesRequired });
    }
    if (assignments.length > 0) {
      await tx.insert(inventoryItemAssignments).values(assignments.map((a) => ({ inventoryItemId: item.id, memberId: a.memberId, quantity: a.quantity })));
    }
  });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    errors.numbers = t("inventory.form.numberRace");
    const assignmentNames = await resolveAssignmentNames(assignments);
    return c.html(
      <Layout title={t("inventory.newItem")} user={user}>
        <InventoryForm title={t("inventory.newItem")} action="/inventory" formId="inventory-new-form"
          values={{ ...values, tagsList: tags, numbersList: numbers, serialsList: serials }} errors={errors}
          assignedMemberName={assignmentNames[0]?.name} assignments={assignmentNames} lendable={lendableField(user, wantsLendable, { publicRequestable, maxRequestQuantity, timesRequired })} />
      </Layout>,
      422
    );
  }

  setFlash(c, t("inventory.flash.created"), "success");
  return c.redirect(`/inventory/${newId}`);
});

// GET /inventory/:id/edit — also where a completed inspection is recorded (no
// inline quick-action, see backlog doc: every date is free-form anyway).
function RetireAction({ item, isBatch, availableToRetire }: { item: ItemWithRelations; isBatch: boolean; availableToRetire: number }) {
  return (
    item.retiredAt ? (
      <form method="post" action={`/inventory/${item.id}/reactivate`} onsubmit={`return confirm('${t("inventory.reactivate.confirm")}')`}>
        <HeaderAction type="submit" icon="check" label={t("inventory.reactivate.button")} class="btn-outline" />
      </form>
    ) : (
      <>
        <HeaderAction icon="no-symbol" label={t("inventory.retire.button")} class="btn-outline btn-warning" onclick="document.getElementById('retire-modal').showModal()" />
        <dialog id="retire-modal" class="modal">
          <div class="modal-box">
            <h3 class="font-bold text-lg">{t("inventory.retire.confirmTitle")}</h3>
            <p class="py-2 opacity-70">{t("inventory.retire.confirmBody", { name: item.name })}</p>
            <form method="post" action={`/inventory/${item.id}/retire`} class="space-y-2">
              {isBatch && (
                <Field label={t("inventory.retire.quantityLabel")}>
                  <input type="number" name="retireQuantity" min="1" max={Math.max(1, availableToRetire)} value={Math.max(1, availableToRetire)} class="input w-full" placeholder={t("inventory.retire.quantityLabel")} />
                  <span class="text-xs opacity-60 mt-1">{t("inventory.retire.quantityHint", { available: availableToRetire, quantity: item.quantity })}</span>
                </Field>
              )}
              <Field label={t("inventory.retire.reasonLabel")}>
                <input type="text" name="retiredReason" placeholder={t("inventory.retire.reasonLabel")} class="input w-full" />
              </Field>
              <div class="modal-action">
                <button type="button" class="btn" onclick="document.getElementById('retire-modal').close()">{t("common.cancel")}</button>
                <button type="submit" class="btn btn-warning">{t("inventory.retire.button")}</button>
              </div>
            </form>
          </div>
          <form method="dialog" class="modal-backdrop"><button>{t("common.close")}</button></form>
        </dialog>
      </>
    )
  );
}

inventoryRoutes.get("/:id/edit", requireAuth("inventory:read"), async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  if (!user.permissions.has("inventory:manage")) return c.redirect(`/inventory/${id}`);
  const item = await fetchItem(id);
  if (!item) return c.notFound();

  const assignmentList = assignmentDisplayList(item);
  const isBatch = item.quantity > 1;
  const lendingItem = await db.query.lendingItems.findFirst({ where: eq(lendingItems.inventoryItemId, item.id) });

  const values: Partial<InventoryFieldValues> & { tagsList?: string[] } = {
    name: item.name,
    category: item.category,
    commissionedAt: item.commissionedAt ?? "",
    purchasePrice: item.purchasePrice ?? "",
    notes: item.notes ?? "",
    licensePlate: item.licensePlate ?? "",
    yearOfManufacture: item.yearOfManufacture ? String(item.yearOfManufacture) : "",
    vehicleInspectionDue: item.vehicleInspectionDue ?? "",
    serialsList: sortedSerials(item),
    nextInspectionDue: item.nextInspectionDue ?? "",
    lastInspectionDate: item.lastInspectionDate ?? "",
    quantity: String(item.quantity),
    assignedMemberId: !isBatch ? (assignmentList[0]?.memberId ?? "") : "",
    tagsList: item.tags.map((tg) => tg.tag),
    numbersList: sortedNumbers(item),
  };

  // Zurücknehmen ist nur ohne Vorgänge möglich (Cascade würde die Historie löschen).
  const hasLoans = lendingItem
    ? Boolean(await db.query.lendingLoans.findFirst({ where: eq(lendingLoans.lendingItemId, lendingItem.id) }))
    : false;

  return c.html(
    <Layout title={item.name} user={user}>
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
        cancelHref={`/inventory/${item.id}`}
        values={values}
        assignedMemberName={!isBatch ? assignmentList[0]?.name : undefined}
        assignments={isBatch ? assignmentList : []}
        lendable={lendableField(user, Boolean(lendingItem), {
          editable: Boolean(lendingItem) || !item.retiredAt, locked: hasLoans,
          // s.o. in POST /:id: Einzel-Tracking folgt der Menge, solange kein Verleihvorgang existiert.
          individualTracking: lendingItem && hasLoans ? lendingItem.individualTracking : item.quantity <= 1,
          publicRequestable: lendingItem?.publicRequestable, maxRequestQuantity: lendingItem?.maxRequestQuantity, timesRequired: lendingItem?.timesRequired,
          requestLink: lendingItem ? new URL(`/lend/${lendingItem.id}`, env.OIDC_APP_URL).toString() : undefined,
        })}
      />
    </Layout>
  );
});

inventoryRoutes.post("/:id", requireAuth("inventory:manage"), async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const existing = await fetchItem(id);
  if (!existing) return c.notFound();

  const body = await c.req.parseBody({ all: true });
  const { values, errors } = parseInventoryFields(body);
  const tags = canonicalizeTags(parseTags(body, "tags"), await tagVocabulary());
  const numbers = parseList(body, "numbers");
  const serials = SERIAL_CATEGORIES.has(values.category) ? parseList(body, "serials") : [];
  const category = values.category as InventoryCategory;
  const insertValues = toInsertValues(values);
  const { assignments, error: assignmentError } = resolveAssignments(values, category, insertValues.quantity, existing.retiredQuantity);
  if (assignmentError) errors.assignments = assignmentError;
  const numbersError = await validateNumbers(numbers, insertValues.quantity, id);
  if (numbersError) errors.numbers = numbersError;
  const serialsError = validateSerials(serials, insertValues.quantity);
  if (serialsError) errors.serials = serialsError;

  // Verleih-Flag: nur mit lending:manage, serverseitig geprüft (UI-Disabled ist nur Komfort).
  const wantsLendable = trimmed(body, "lendable") === "1";
  const canManageLending = user.permissions.has("lending:manage");
  const lendingItem = canManageLending ? await db.query.lendingItems.findFirst({ where: eq(lendingItems.inventoryItemId, id) }) : undefined;
  const lendingHasLoans = lendingItem ? Boolean(await db.query.lendingLoans.findFirst({ where: eq(lendingLoans.lendingItemId, lendingItem.id) })) : false;
  let lendingChange: "enable" | "disable" | null = null;
  let lendableError: string | undefined;
  if (canManageLending) {
    if (wantsLendable && !lendingItem) {
      if (existing.retiredAt) lendableError = t("inventory.form.lendableRetired");
      else lendingChange = "enable";
    } else if (!wantsLendable && lendingItem) {
      if (lendingHasLoans) lendableError = t("inventory.form.lendableLocked");
      else lendingChange = "disable";
    }
  }
  if (lendableError) errors.lendable = lendableError;

  // Einzel-Tracking folgt der Menge, solange kein Verleihvorgang existiert — sonst würde eine
  // nachträgliche Mengenänderung die laufende Verleih-Historie inkonsistent machen (fix ab erstem Vorgang).
  const individualTracking = lendingItem && lendingHasLoans ? lendingItem.individualTracking : insertValues.quantity <= 1;
  const publicRequestable = canManageLending && trimmed(body, "publicRequestable") === "1";
  const timesRequired = canManageLending && trimmed(body, "timesRequired") === "1";
  let maxRequestQuantity = 0;
  let maxRequestQuantityError: string | undefined;
  if (canManageLending && !individualTracking) {
    const limited = trimmed(body, "maxRequestLimited") === "1";
    if (limited) maxRequestQuantity = Number(trimmed(body, "maxRequestQuantity"));
    if (limited && (!Number.isInteger(maxRequestQuantity) || maxRequestQuantity < 1 || maxRequestQuantity > insertValues.quantity)) maxRequestQuantityError = t("lending.loans.error.invalidQuantity");
  }

  if (Object.keys(errors).length > 0 || maxRequestQuantityError) {
    const assignmentNames = await resolveAssignmentNames(assignments);
    return c.html(
      <Layout title={existing.name} user={user}>
        <InventoryForm
          title={existing.name}
          action={`/inventory/${id}`}
          formId="inventory-edit-form"
          cancelHref={`/inventory/${id}`}
          values={{ ...values, tagsList: tags, numbersList: numbers, serialsList: serials }}
          errors={errors}
          assignedMemberName={assignmentNames[0]?.name}
          assignments={assignmentNames}
          lendable={lendableField(user, wantsLendable, {
            error: lendableError, individualTracking, publicRequestable, maxRequestQuantity, timesRequired,
            errors: { maxRequestQuantity: maxRequestQuantityError },
          })}
        />
      </Layout>,
      422
    );
  }

  try {
  await db.transaction(async (tx) => {
    await tx.update(inventoryItems).set(insertValues).where(eq(inventoryItems.id, id));
    await tx.delete(inventoryItemTags).where(eq(inventoryItemTags.inventoryItemId, id));
    if (tags.length > 0) {
      await tx.insert(inventoryItemTags).values(tags.map((tag) => ({ inventoryItemId: id, tag })));
    }
    await tx.delete(inventoryItemNumbers).where(eq(inventoryItemNumbers.inventoryItemId, id));
    if (numbers.length > 0) {
      await tx.insert(inventoryItemNumbers).values(numbers.map((number) => ({ inventoryItemId: id, number })));
    }
    await tx.delete(inventoryItemSerials).where(eq(inventoryItemSerials.inventoryItemId, id));
    if (serials.length > 0) {
      await tx.insert(inventoryItemSerials).values(serials.map((serial) => ({ inventoryItemId: id, serial })));
    }
    await tx.delete(inventoryItemAssignments).where(eq(inventoryItemAssignments.inventoryItemId, id));
    if (assignments.length > 0) {
      await tx.insert(inventoryItemAssignments).values(assignments.map((a) => ({ inventoryItemId: id, memberId: a.memberId, quantity: a.quantity })));
    }
    if (lendingChange === "enable") {
      // ponytail: Einzel-Tracking aus quantity abgeleitet und danach fix — späteres Erhöhen der Menge ändert den Modus nicht.
      await tx.insert(lendingItems).values({ inventoryItemId: id, individualTracking: insertValues.quantity <= 1, publicRequestable, maxRequestQuantity, timesRequired });
    } else if (lendingChange === "disable" && lendingItem) {
      await tx.delete(lendingItems).where(eq(lendingItems.id, lendingItem.id));
    } else if (lendingItem) {
      await tx.update(lendingItems).set({ publicRequestable, maxRequestQuantity, timesRequired }).where(eq(lendingItems.id, lendingItem.id));
    }
  });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    errors.numbers = t("inventory.form.numberRace");
    const assignmentNames = await resolveAssignmentNames(assignments);
    return c.html(
      <Layout title={existing.name} user={user}>
        <InventoryForm title={existing.name} action={`/inventory/${id}`} formId="inventory-edit-form"
          values={{ ...values, tagsList: tags, numbersList: numbers, serialsList: serials }} errors={errors}
          assignedMemberName={assignmentNames[0]?.name} assignments={assignmentNames}
          lendable={lendableField(user, wantsLendable, { error: lendableError })} />
      </Layout>,
      422
    );
  }

  setFlash(c, t("inventory.flash.saved"), "success");
  return c.redirect(`/inventory/${id}`);
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
  return c.redirect(`/inventory/${id}`);
});

// POST /inventory/:id/reactivate — undo the retirement entirely, low effort, keeps
// the soft-delete character of this feature consistent.
inventoryRoutes.post("/:id/reactivate", requireAuth("inventory:manage"), async (c) => {
  const id = c.req.param("id");
  await db.update(inventoryItems).set({ retiredAt: null, retiredReason: null, retiredQuantity: 0 }).where(eq(inventoryItems.id, id));
  setFlash(c, t("inventory.flash.reactivated"), "success");
  return c.redirect(`/inventory/${id}`);
});

// GET /inventory/inspections — Prüffristen-Übersicht, filter-UX identisch zu /anniversaries.
inventoryRoutes.get("/inspections", requireAuth("inventory:read"), async (c) => {
  const user = c.get("user")!;
  const today = new Date().toISOString().slice(0, 10);

  const range = parseRange(c.req.query(), today, "future", { start: today, end: addMonths(today, 12) });
  const { start, end } = range;
  const categoryFilter = parseMulti(c.req.queries("category"), CATEGORIES);

  const all = await fetchItems();
  // Überfällige Posten immer anzeigen, unabhängig vom Zeitraum-Filter — sonst
  // verschwinden sie aus der Liste, sobald "start" nicht mehr in der Vergangenheit liegt.
  const overdueItems = generateInspectionDueItems(all, "0000-01-01", today);
  const dueInRange = generateInspectionDueItems(all, start, end);
  const seen = new Set(overdueItems.map((d) => d.id));
  let due = [...overdueItems, ...dueInRange.filter((d) => !seen.has(d.id))].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name, "de"),
  );
  if (categoryFilter.length > 0) due = due.filter((d) => categoryFilter.includes(d.category));

  const qs = (extra: Record<string, string | undefined>) => buildListUrl("/inventory/inspections", { ...rangeParams(range), category: categoryFilter }, extra);
  const presets = rangePresets(today, "future");

  return c.html(
    <Layout title={t("inventory.inspections.title")} user={user}>
      <PageHeader title={t("inventory.inspections.title")} />

      <div class="filter-bar flex flex-wrap items-center gap-3 mb-4">
        <QuickRangeFilter presets={presets} range={range} dir="future" action="/inventory/inspections"
          hidden={categoryFilter.map((cat): [string, string] => ["category", cat])} href={(p) => qs(p)} />
        <div class="self-end">
          <MultiSelectFilter
            param="category"
            autoApply
            options={CATEGORIES.filter((c) => c !== "other").map((cat) => ({ value: cat, label: CATEGORY_LABELS[cat] }))}
            selected={categoryFilter}
            allLabel={t("inventory.filter.allCategories")}
            countLabel={(count) => t("inventory.filter.categoryCount", { count })}
            applyLabel={t("common.apply")}
            resetLabel={t("common.reset")}
          />
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
                <tr key={d.id} class="cursor-pointer hover" onclick={`window.location='/inventory/${d.id}'`}>
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
      status: deriveMemberStatus(m, m.assignments, env.CHILDREN_AGE_LIMIT, env.YOUTH_AGE_LIMIT, env.ACTIVE_AGE_LIMIT),
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

// Muss nach den statischen Pfaden (/inspections, /search-members) stehen.
inventoryRoutes.get("/:id", requireAuth("inventory:read"), async (c) => {
  const user = c.get("user")!;
  const item = await fetchItem(c.req.param("id"));
  if (!item) return c.notFound();
  const canManage = user.permissions.has("inventory:manage");

  const lending = user.permissions.has("lending:read")
    ? await db.query.lendingItems.findFirst({ where: eq(lendingItems.inventoryItemId, item.id) })
    : undefined;
  const status = itemStatus(item, !!lending);
  const assigned = assignmentDisplayList(item);
  const cat = item.category as InventoryCategory;
  const availableToRetire = item.quantity - item.retiredQuantity - assigned.reduce((sum, x) => sum + x.quantity, 0);
  const retireAction = canManage ? <RetireAction item={item} isBatch={item.quantity > 1} availableToRetire={availableToRetire} /> : undefined;
  const price = item.purchasePrice ? `${item.purchasePrice} €` : null;
  return c.html(
    <Layout title={item.name} user={user}>
      <PageHeader title={<>{item.name} <CategoryBadge category={cat} /> <span class={`badge badge-sm ${status === "retired" ? "badge-neutral" : status === "lendable" ? "badge-info" : "badge-success"}`}>{t(`inventory.status.${status}`)}</span></>} backHref="/inventory" actions={<DetailActions editHref={canManage ? `/inventory/${item.id}/edit` : undefined} remove={retireAction} />} />
      {item.retiredAt && (
        <div class="alert alert-warning max-w-2xl mb-4">
          {t("inventory.retire.retiredNotice", { date: formatDate(item.retiredAt) })}{item.retiredReason ? ` — ${item.retiredReason}` : ""}
        </div>
      )}
      <ViewGrid>
        <ViewField label={t("inventory.form.commissionedAt")} value={item.commissionedAt ? formatDate(item.commissionedAt) : null} />
        <ViewField label={t("inventory.form.purchasePrice")} value={price} />
        {item.numbers.length > 0 && (
          <div class="sm:col-span-2">
            <div class="text-sm opacity-60">{t(item.quantity > 1 ? "inventory.form.inventoryNumbers" : "inventory.form.inventoryNumber")}</div>
            <div class="flex flex-wrap gap-1 mt-1">{sortedNumbers(item).map((n) => <span class="badge badge-outline">{n}</span>)}</div>
          </div>
        )}
        {SERIAL_CATEGORIES.has(cat) && item.serials.length > 0 && (
          <div class="sm:col-span-2">
            <div class="text-sm opacity-60">{t(item.quantity > 1 ? "inventory.form.serialNumbers" : "inventory.form.serialNumber")}</div>
            <div class="flex flex-wrap gap-1 mt-1">{sortedSerials(item).map((n) => <span class="badge badge-outline">{n}</span>)}</div>
          </div>
        )}
        {cat === "vehicle" && <>
          <ViewField label={t("inventory.form.licensePlate")} value={item.licensePlate} />
          <ViewField label={t("inventory.form.yearOfManufacture")} value={item.yearOfManufacture ? String(item.yearOfManufacture) : null} />
          <ViewField label={t("inventory.form.vehicleInspectionDue")} value={item.vehicleInspectionDue ? formatDate(item.vehicleInspectionDue) : null} />
        </>}
        {(cat === "scba" || cat === "equipment" || cat === "ppe") && <>
          {cat === "scba" && <ViewField label={t("inventory.form.lastInspectionDate")} value={item.lastInspectionDate ? formatDate(item.lastInspectionDate) : null} />}
          <ViewField label={t("inventory.form.nextInspectionDue")} value={item.nextInspectionDue ? formatDate(item.nextInspectionDue) : null} />
        </>}
        {item.quantity > 1 && <ViewField label={t("inventory.form.quantity")} value={String(item.quantity)} />}
        <ViewField
          label={t("inventory.form.assignedMember")}
          value={assigned.map((a) => (item.quantity > 1 ? `${a.name} (${a.quantity}×)` : a.name)).join(", ") || null}
        />
      </ViewGrid>
      {item.notes && <div class="mt-6 max-w-2xl"><ViewField label={t("inventory.form.notes")} value={item.notes} /></div>}
      {item.tags.length > 0 && (
        <div class="mt-6 flex flex-wrap gap-1">
          {item.tags.map((tg) => <span class="badge badge-ghost badge-sm">{tg.tag}</span>)}
        </div>
      )}
    </Layout>
  );
});
