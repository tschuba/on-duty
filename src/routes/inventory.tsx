import { Hono } from "hono";
import { ToggleFilter } from "../components/toggle-filter.js";
import { Field, ViewField, ViewGrid } from "../components/field.js";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { inventoryItems, inventoryTemplates, inventoryItemTags, inventoryItemNumbers, inventoryItemSerials, inventoryInspections, inventoryInspectionTemplates, inventoryItemAssignments, lendingItems, lendingLoans, members } from "../db/schema/index.js";
import { Icon } from "../components/icon.js";
import { ImpressumHint } from "../components/impressum-hint.js";
import { TagAvatar, TagBadges } from "../components/tag-badges.js";
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
import { addDays, addMonths, parseRange, rangeParams, rangePresets } from "../lib/quick-range.js";
import { Pager } from "../components/pager.js";
import { MultiSelectFilter } from "../components/multi-select-filter.js";
import { generateInspectionDueItems, isIsoDate, isUniqueViolation, isInspectionNameViolation, renamedInspectionIds, nextDueDate, parseInspectionRows, diffInspections, INSPECTION_NAME_MAX, type InspectionFormRow, type InspectionRowError, INVENTORY_FIELDS, type InventoryField, hasField, isFieldEmpty, validateLocation, normalizeFieldValue, type FieldDefType } from "../lib/inventory.js";
import { inventoryFieldDefs, inventoryFieldValues } from "../db/schema/index.js";
import { availableQuantity, itemStatus } from "../lib/lending.js";
import { deriveMemberStatus } from "../lib/status.js";
import { env } from "../env.js";
import { inventoryFieldRoutes } from "./inventory-fields.js";
import { inventoryInspectionTemplateRoutes } from "./inventory-inspection-templates.js";
import { inventoryTemplateRoutes } from "./inventory-templates.js";
import { SEARCH_DEBOUNCE_MS } from "../lib/constants.js";

export const inventoryRoutes = new Hono<{ Variables: Variables }>();
// Vor den /:id-Routen registrieren, sonst frisst /:id den Pfad.
inventoryRoutes.route("/fields", inventoryFieldRoutes);
inventoryRoutes.route("/inspection-templates", inventoryInspectionTemplateRoutes);
inventoryRoutes.route("/templates", inventoryTemplateRoutes);

// ── Types ────────────────────────────────────────────────────────────────────

type InventoryItemRow = typeof inventoryItems.$inferSelect;
type Tag = typeof inventoryItemTags.$inferSelect;
type ItemNumber = typeof inventoryItemNumbers.$inferSelect;
type ItemSerial = typeof inventoryItemSerials.$inferSelect;
type MemberRow = typeof members.$inferSelect;
type Person = { firstName: string; lastName: string };
type AssignmentWithMember = typeof inventoryItemAssignments.$inferSelect & { member: MemberRow & { person: Person } };
type FreeDef = typeof inventoryFieldDefs.$inferSelect;
type Inspection = typeof inventoryInspections.$inferSelect;
type ItemWithRelations = InventoryItemRow & { tags: Tag[]; numbers: ItemNumber[]; serials: ItemSerial[]; assignments: AssignmentWithMember[]; inspections: Inspection[]; fieldValues?: (typeof inventoryFieldValues.$inferSelect & { fieldDef: FreeDef })[] };

// Only members who can actually carry PSA get offered in the assignment picker.
const ASSIGNABLE_MEMBER_STATUSES = new Set(["active", "youth"]);

// ── Form field parsing ───────────────────────────────────────────────────────

type AssignmentInput = { memberId: string; name: string; quantity: number };

export type InventoryFieldValues = {
  name: string;
  commissionedAt: string;
  numbersList?: string[];
  purchasePrice: string;
  notes: string;
  tagsList?: string[];
  serialsList?: string[];
  // Prüfarten (Feld "inspection"): Zeilen roh fürs Rendern, Fehler je Zeilenindex, Vorschläge fürs <datalist>.
  inspectionRows?: InspectionFormRow[];
  inspectionErrors?: Record<number, InspectionRowError>;
  inspectionSuggestions?: { name: string; intervalMonths: number | null }[];
  quantity: string;
  // Single-item mode (quantity 1): one optional assignment, same UI as before.
  assignedMemberId: string;
  // Batch mode (quantity > 1): JSON-encoded AssignmentInput[], synced from the
  // chip list by client-side JS (same pattern as the tags hidden field).
  assignments: string;
  // "Feld hinzufügen": welche festen Felder dieser Posten hat (s. INVENTORY_FIELDS).
  enabledFieldsList?: InventoryField[];
  // Freie Felder: freeRaw[defId] vorhanden = am Posten aktiv (Wert roh, darf leer sein); freeDefs nur fürs Rendern.
  freeRaw?: Record<string, string>;
  freeDefs?: FreeDef[];
  locationText: string;
  latitude: string;
  longitude: string;
};

export function parseInventoryFields(body: Record<string, any>): { values: InventoryFieldValues; errors: Record<string, string> } {
  const enabledFieldsList = parseList(body, "enabledFields").filter((f): f is InventoryField => (INVENTORY_FIELDS as readonly string[]).includes(f));
  const values: InventoryFieldValues = {
    name: trimmed(body, "name"),
    commissionedAt: trimmed(body, "commissionedAt"),
    purchasePrice: trimmed(body, "purchasePrice"),
    notes: trimmed(body, "notes"),
    quantity: trimmed(body, "quantity") || "1",
    assignedMemberId: trimmed(body, "assignedMemberId"),
    assignments: trimmed(body, "assignments") || "[]",
    enabledFieldsList,
    freeRaw: Object.fromEntries(parseList(body, "freeFields").map((id) => [id, trimmed(body, `ff_${id}`)])),
    locationText: trimmed(body, "locationText"),
    latitude: trimmed(body, "latitude"),
    longitude: trimmed(body, "longitude"),
  };

  const errors: Record<string, string> = {};
  if (!values.name) errors.name = t("common.required");
  if (values.purchasePrice && !Number.isFinite(Number(values.purchasePrice.replace(",", ".")))) {
    errors.purchasePrice = t("inventory.form.invalidNumber");
  }
  const quantityNum = Number(values.quantity);
  if (hasField(enabledFieldsList, "quantity") && (!Number.isInteger(quantityNum) || quantityNum < 1)) {
    errors.quantity = t("inventory.form.invalidQuantity");
  }
  if (hasField(enabledFieldsList, "location")) {
    const locErrors = validateLocation(values.latitude, values.longitude);
    if (locErrors.latitude) errors.latitude = t("inventory.form.invalidCoordinate");
    if (locErrors.longitude) errors.longitude = t("inventory.form.invalidCoordinate");
  }
  return { values, errors };
}

// Batch mode (quantity > 1, only with the "quantity" field): an assignment is
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
// Single-item mode (quantity 1) keeps the one-member picker; batch mode (quantity > 1,
// only possible with "quantity" enabled) allows several members each holding a stated
// quantity, capped by what's left after retiring. Neither mode needs a specific category
// — gated purely by the "assignments" field (see 115_Inventar-Felder-Baukasten).
function resolveAssignments(
  values: InventoryFieldValues,
  enabledFields: readonly string[],
  quantity: number,
  retiredQuantity = 0,
): { assignments: { memberId: string; quantity: number }[]; error?: string } {
  if (!hasField(enabledFields, "assignments")) return { assignments: [] };
  if (hasField(enabledFields, "quantity") && quantity > 1) {
    const assignments = parseBatchAssignments(values.assignments).map(({ memberId, quantity }) => ({ memberId, quantity }));
    const assignedTotal = assignments.reduce((sum, a) => sum + a.quantity, 0);
    if (assignedTotal + retiredQuantity > quantity) return { assignments, error: t("inventory.form.assignedExceedsQuantity") };
    return { assignments };
  }
  if (values.assignedMemberId) return { assignments: [{ memberId: values.assignedMemberId, quantity: 1 }] };
  return { assignments: [] };
}

// Which fixed fields are visible/stored is purely enabledFields (see 115_Inventar-Felder-Baukasten).
export function toInsertValues(values: InventoryFieldValues) {
  const enabledFields = values.enabledFieldsList ?? [];
  const hasQuantity = hasField(enabledFields, "quantity");
  const quantity = hasQuantity ? Math.max(1, Math.round(Number(values.quantity)) || 1) : 1;
  const hasLocation = hasField(enabledFields, "location");
  return {
    name: values.name,
    commissionedAt: values.commissionedAt || null,
    purchasePrice: values.purchasePrice ? values.purchasePrice.replace(",", ".") : null,
    notes: values.notes || null,
    quantity,
    enabledFields: [...enabledFields],
    locationText: hasLocation ? values.locationText || null : null,
    latitude: hasLocation ? values.latitude || null : null,
    longitude: hasLocation ? values.longitude || null : null,
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

// Seriennummern: höchstens eine pro Stück, nicht global eindeutig. Nur mit dem Feld "serials".
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
    <div class="flex flex-col" data-field="assignments" data-show-batch="false">
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
    <div class="flex flex-col" data-field="assignments" data-show-batch="true">
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

// ── Field-dependent form sections ───────────────────────────────────────────

// No precedent in the code for dynamic show/hide of form fields — plain client-side
// classList toggle (same idea as the pagination <select> inline script in
// members.tsx), not an HTMX round-trip for a purely visual switch. Two toggles
// compose here: which fixed fields are checked, and whether quantity > 1 (batch) —
// data-field/data-show-batch express both without duplicating any input's `name`
// (duplicate names would silently clobber each other in FormData on submit).
const FORM_TOGGLE_SCRIPT = `
  function updateInventoryFormVisibility() {
    var on = {};
    document.querySelectorAll('input[name=enabledFields]:checked').forEach(function(c) { on[c.value] = true; });
    var qtyInput = document.getElementById('inventory-quantity');
    // quantity is only meaningful with the "quantity" field; without it a stale value must not leak into batch mode
    if (qtyInput && !on.quantity && qtyInput.value !== '1') {
      qtyInput.value = '1';
      // programmatic changes fire no event; ChipInput listens for it to refresh label/counter/limit
      qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var isBatch = Boolean(on.quantity && qtyInput && Number(qtyInput.value) > 1);
    document.querySelectorAll('[data-field]').forEach(function(el) {
      var fieldOk = Boolean(on[el.dataset.field]);
      var batchOk = el.dataset.showBatch === undefined || (el.dataset.showBatch === 'true') === isBatch;
      el.classList.toggle('hidden', !(fieldOk && batchOk));
    });
  }
  updateInventoryFormVisibility();
`;

const INSPECTION_ROWS_SCRIPT = `
  function addInspectionRow() {
    document.getElementById('inspection-rows').appendChild(document.getElementById('inspection-row-template').content.cloneNode(true));
  }
  // "Aus Vorlage": Name aus dem <datalist> gewählt/getippt -> Standardintervall vorbelegen (nur wenn noch leer).
  document.addEventListener('change', function(e) {
    if (e.target.name !== 'insp_name') return;
    var interval = e.target.closest('[data-inspection-row]').querySelector('[name=insp_interval]');
    if (interval.value) return;
    var wanted = e.target.value.trim().toLowerCase();
    var opt = Array.prototype.find.call(document.querySelectorAll('#inspection-names option'), function(o) { return o.value.toLowerCase() === wanted; });
    if (opt && opt.dataset.interval) interval.value = opt.dataset.interval;
  });
`;

function InspectionRowFields({ row, error }: { row: InspectionFormRow; error?: InspectionRowError }) {
  return (
    <div data-inspection-row class="space-y-1">
      <input type="hidden" name="insp_id" value={row.id} />
      <div class="grid grid-cols-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-start">
        <Field label={t("inventory.form.inspectionName")} class="col-span-2 sm:col-span-1">
          <input type="text" name="insp_name" list="inspection-names" maxlength={INSPECTION_NAME_MAX} value={row.name} class={`input w-full${error === "name" || error === "nameLength" || error === "duplicate" ? " input-error" : ""}`} placeholder={t("inventory.form.inspectionName")} />
        </Field>
        <Field label={t("inventory.form.inspectionInterval")}>
          <input type="number" name="insp_interval" min="1" max="120" value={row.interval} class={`input w-full${error === "interval" ? " input-error" : ""}`} placeholder={t("inventory.form.inspectionInterval")} />
        </Field>
        <Field label={t("inventory.form.inspectionLast")}>
          <input type="date" name="insp_last" value={row.last} class={`input w-full${error === "future" ? " input-error" : ""}`} />
        </Field>
        <Field label={t("inventory.form.inspectionDue")}>
          <input type="date" name="insp_due" value={row.due} class={`input w-full${error === "date" ? " input-error" : ""}`} />
        </Field>
        <button type="button" class="btn btn-ghost btn-square" aria-label={t("common.delete")} title={t("common.delete")} onclick="this.closest('[data-inspection-row]').remove()">
          <Icon name="trash" class="h-5 w-5" />
        </button>
      </div>
      {error && <span class="text-error text-sm">{t(`inventory.form.inspectionError.${error}`)}</span>}
    </div>
  );
}

export function InventoryFormFields({ values, errors, assignedMemberName, assignments, canConfigure }: {
  values?: Partial<InventoryFieldValues>;
  errors?: Record<string, string>;
  assignedMemberName?: string;
  assignments?: AssignmentInput[];
  canConfigure?: boolean;
}) {
  const v = values ?? {};
  const quantity = Number(v.quantity) || 1;
  return (
    <>
      <Field label={t("inventory.form.name")} required>
        <input type="text" name="name" value={v.name ?? ""} class={`input w-full${errors?.name ? " input-error" : ""}`} placeholder={t("inventory.form.name")} />
        {errors?.name && <span class="text-error text-sm mt-1">{errors.name}</span>}
      </Field>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t("inventory.form.commissionedAt")}>
          <input type="date" name="commissionedAt" value={v.commissionedAt ?? ""} class="input w-full" />
        </Field>
        <Field label={t("inventory.form.purchasePrice")} after={<span class="block text-xs opacity-60 mt-1" data-field="quantity" data-show-batch="true">{t("inventory.form.quantityTotalHint")}</span>}>
          <input type="text" inputmode="decimal" name="purchasePrice" value={v.purchasePrice ?? ""} class={`input w-full${errors?.purchasePrice ? " input-error" : ""}`} placeholder={t("inventory.form.purchasePrice")} />
          {errors?.purchasePrice && <span class="text-error text-sm mt-1">{errors.purchasePrice}</span>}
        </Field>
      </div>

      <Field label={t("inventory.form.notes")}>
        <textarea name="notes" class="textarea w-full" rows={3} placeholder={t("inventory.form.notes")}>{v.notes ?? ""}</textarea>
      </Field>

      <TagInput tags={v.tagsList} />

      <div class="space-y-2">
        <div class="divider">{t("inventory.form.fields")}</div>
        {canConfigure && (
          // Neuer Tab: das Formular bleibt offen, nichts wird zurückübernommen (Seite neu laden für neue Vorschläge).
          <div class="dropdown dropdown-end float-right">
            <div tabindex={0} role="button" class="btn btn-ghost btn-sm gap-1">{t("inventory.form.configureLinks")}<Icon name="chevron-down" class="h-4 w-4 opacity-60" /></div>
            <ul tabindex={0} class="dropdown-content menu bg-base-200 rounded-box z-10 w-56 p-2 shadow">
              <li><a href="/inventory/inspection-templates" target="_blank" rel="noopener">{t("inventory.tabs.inspectionTemplates")}</a></li>
              <li><a href="/inventory/fields" target="_blank" rel="noopener">{t("inventory.tabs.fields")}</a></li>
              <li><a href="/inventory/templates" target="_blank" rel="noopener">{t("inventory.tabs.itemTemplates")}</a></li>
            </ul>
          </div>
        )}
        <div class="flex flex-wrap gap-x-4 gap-y-2" id="inventory-fields">
          {INVENTORY_FIELDS.map((f) => (
            <label class="label cursor-pointer justify-start gap-2 w-fit">
              <input type="checkbox" name="enabledFields" value={f} checked={hasField(v.enabledFieldsList, f)} class="checkbox" onchange="updateInventoryFormVisibility()" />
              <span class="text-sm">{t(`inventory.field.${f}`)}</span>
            </label>
          ))}
        </div>
        {errors?.enabledFields && <span class="text-error text-sm">{errors.enabledFields}</span>}
      </div>

      <div data-field="inspection" class="space-y-4">
        <div class="divider">{t("inventory.form.sectionInspection")}</div>
        {errors?.inspections && <span class="text-error text-sm">{errors.inspections}</span>}
        <datalist id="inspection-names">
          {(v.inspectionSuggestions ?? []).map((sug) => <option value={sug.name} data-interval={sug.intervalMonths ?? ""} />)}
        </datalist>
        <div id="inspection-rows" class="space-y-3">
          {(v.inspectionRows ?? []).map((r, i) => <InspectionRowFields row={r} error={v.inspectionErrors?.[i]} />)}
        </div>
        <template id="inspection-row-template"><InspectionRowFields row={{ id: "", name: "", interval: "", last: "", due: "" }} /></template>
        <button type="button" class="btn btn-sm" onclick="addInspectionRow()">{t("inventory.form.addInspection")}</button>
        <script dangerouslySetInnerHTML={{ __html: INSPECTION_ROWS_SCRIPT }} />
      </div>

      <div data-field="quantity" class="space-y-4">
        <Field label={t("inventory.form.quantity")} class="max-w-40">
          <input
            type="number"
            id="inventory-quantity"
            name="quantity"
            min="1"
            value={v.quantity ?? "1"}
            oninput="updateInventoryFormVisibility()"
            class={`input w-full${errors?.quantity ? " input-error" : ""}`} placeholder={t("inventory.form.quantity")}
          />
          {errors?.quantity && <span class="text-error text-sm mt-1">{errors.quantity}</span>}
        </Field>
      </div>

      <div data-field="numbers">
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
      </div>

      <div data-field="serials">
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

      <div data-field="location" class="space-y-4">
        <div class="divider">{t("inventory.form.sectionLocation")}</div>
        <Field label={t("inventory.form.locationText")}>
          <input type="text" name="locationText" value={v.locationText ?? ""} class="input w-full" placeholder={t("inventory.form.locationText")} />
        </Field>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t("inventory.form.latitude")}>
            <input type="text" inputmode="decimal" name="latitude" value={v.latitude ?? ""} class={`input w-full${errors?.latitude ? " input-error" : ""}`} placeholder={t("inventory.form.latitude")} />
            {errors?.latitude && <span class="text-error text-sm mt-1">{errors.latitude}</span>}
          </Field>
          <Field label={t("inventory.form.longitude")}>
            <input type="text" inputmode="decimal" name="longitude" value={v.longitude ?? ""} class={`input w-full${errors?.longitude ? " input-error" : ""}`} placeholder={t("inventory.form.longitude")} />
            {errors?.longitude && <span class="text-error text-sm mt-1">{errors.longitude}</span>}
          </Field>
        </div>
      </div>

      {(v.freeDefs ?? []).length > 0 && (
        <div class="space-y-4">
          <div class="divider">{t("inventory.form.freeFields")}</div>
          {errors?.freeFields && <span class="text-error text-sm">{errors.freeFields}</span>}
          {v.freeDefs!.map((d) => {
            const active = v.freeRaw?.[d.id] !== undefined;
            const val = v.freeRaw?.[d.id] ?? "";
            const name = `ff_${d.id}`;
            return (
              <div data-free class="space-y-2">
                <label class="label cursor-pointer justify-start gap-2 w-fit">
                  <input type="checkbox" name="freeFields" value={d.id} checked={active} class="checkbox"
                    onchange="this.closest('[data-free]').querySelector('[data-free-input]').classList.toggle('hidden', !this.checked)" />
                  <span class="text-sm">{d.name}{d.archived && ` (${t("inventory.fields.archived")})`}</span>
                </label>
                <div data-free-input class={active ? "" : "hidden"}>
                  {d.type === "boolean" || d.type === "select" ? (
                    <select name={name} class="select w-full">
                      <option value=""></option>
                      {d.type === "boolean"
                        ? <><option value="1" selected={val === "1"}>{t("common.yes")}</option><option value="0" selected={val === "0"}>{t("common.no")}</option></>
                        : [...(d.options ?? []), ...(val && !(d.options ?? []).includes(val) ? [val] : [])].map((o) => <option value={o} selected={val === o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type={d.type === "date" ? "date" : "text"} inputmode={d.type === "number" ? "decimal" : undefined} name={name} value={val} class="input w-full" placeholder={d.name} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <MemberPickerFields memberId={v.assignedMemberId} memberName={assignedMemberName} />
      <BatchAssignmentFields assignments={assignments ?? []} />

      <script dangerouslySetInnerHTML={{ __html: FORM_TOGGLE_SCRIPT }} />
    </>
  );
}

// ── Data access ──────────────────────────────────────────────────────────────

async function fetchItems(): Promise<ItemWithRelations[]> {
  return db.query.inventoryItems.findMany({
    with: { tags: true, numbers: true, serials: true, inspections: true, fieldValues: { with: { fieldDef: true } }, assignments: { with: { member: { with: { person: true } } } } },
    orderBy: (items, { asc }) => [asc(items.name)],
  }) as unknown as Promise<ItemWithRelations[]>;
}

async function fetchItem(id: string): Promise<ItemWithRelations | undefined> {
  return db.query.inventoryItems.findFirst({
    where: eq(inventoryItems.id, id),
    with: { tags: true, numbers: true, serials: true, inspections: true, fieldValues: { with: { fieldDef: true } }, assignments: { with: { member: { with: { person: true } } } } },
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

const inspectionValues = (r: InspectionFormRow) => ({
  name: r.name,
  intervalMonths: r.interval ? Number(r.interval) : null,
  inspectedAt: r.last || null,
  dueDate: r.due || null,
});

// Vorschläge fürs Namens-<datalist>: Vorlagen (mit Standardintervall) plus bereits an Posten verwendete Namen.
async function inspectionSuggestions(): Promise<{ name: string; intervalMonths: number | null }[]> {
  const templates = (await db.query.inventoryInspectionTemplates.findMany()) as (typeof inventoryInspectionTemplates.$inferSelect)[];
  const used = (await db.query.inventoryInspections.findMany({ columns: { name: true } })) as { name: string }[];
  const byName = new Map<string, { name: string; intervalMonths: number | null }>();
  for (const u of used) byName.set(u.name.toLowerCase(), { name: u.name, intervalMonths: null });
  for (const tpl of templates) byName.set(tpl.name.toLowerCase(), { name: tpl.name, intervalMonths: tpl.defaultIntervalMonths });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
}

// Freie Felder fürs Formular: aktive (nicht archivierte oder am Posten schon vorhandene) Definitionen plus aktuelle Rohwerte.
async function withFree(values: Partial<InventoryFieldValues>, itemId?: string): Promise<Partial<InventoryFieldValues>> {
  const defs = (await db.query.inventoryFieldDefs.findMany({ orderBy: (d: any, { asc }: any) => [asc(d.name)] })) as FreeDef[];
  let raw = values.freeRaw;
  if (!raw && itemId) {
    const rows = await db.query.inventoryFieldValues.findMany({ where: eq(inventoryFieldValues.inventoryItemId, itemId) });
    raw = Object.fromEntries(rows.map((r: any) => [r.fieldDefId, r.value ?? ""]));
  }
  raw ??= {};
  let inspectionRows = values.inspectionRows;
  if (!inspectionRows && itemId) {
    const rows = (await db.query.inventoryInspections.findMany({ where: eq(inventoryInspections.inventoryItemId, itemId) })) as Inspection[];
    inspectionRows = rows.sort((a, b) => a.name.localeCompare(b.name, "de")).map((r) => ({ id: r.id, name: r.name, interval: r.intervalMonths ? String(r.intervalMonths) : "", last: r.inspectedAt ?? "", due: r.dueDate ?? "" }));
  }
  return { ...values, freeRaw: raw, freeDefs: defs.filter((d) => !d.archived || raw![d.id] !== undefined), inspectionRows: inspectionRows ?? [], inspectionSuggestions: await inspectionSuggestions() };
}

// Abgeschickte freie Felder gegen ihre Definitionen prüfen. stored = bisherige Wertezeilen des Postens (nur beim Bearbeiten):
// ein Feld mit gespeichertem Wert lässt sich nur abwählen, wenn es vorher geleert wurde; archivierte Felder sind nur noch bei Bestandsposten wählbar.
async function resolveFree(values: InventoryFieldValues, stored: { fieldDefId: string; value: string | null }[] = []): Promise<{ rows: { fieldDefId: string; value: string | null }[]; error?: string }> {
  const raw = values.freeRaw ?? {};
  const defs = (await db.query.inventoryFieldDefs.findMany()) as FreeDef[];
  const byId = new Map(defs.map((d) => [d.id, d]));
  const had = new Set(stored.map((r) => r.fieldDefId));
  const rows: { fieldDefId: string; value: string | null }[] = [];
  const invalid: string[] = [];
  for (const [id, rawValue] of Object.entries(raw)) {
    const def = byId.get(id);
    if (!def || (def.archived && !had.has(id))) continue;
    const res = normalizeFieldValue(def.type as FieldDefType, def.options, rawValue);
    if (res.error) invalid.push(def.name);
    else rows.push({ fieldDefId: id, value: res.value });
  }
  if (invalid.length > 0) return { rows, error: t("inventory.form.freeFieldInvalid", { fields: invalid.join(", ") }) };
  const locked = stored.filter((r) => r.value != null && raw[r.fieldDefId] === undefined).map((r) => byId.get(r.fieldDefId)?.name ?? "");
  for (const r of stored) if (r.value != null && raw[r.fieldDefId] === undefined) raw[r.fieldDefId] = r.value;
  if (locked.length > 0) return { rows, error: t("inventory.form.freeFieldLocked", { fields: locked.join(", ") }) };
  return { rows };
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /inventory — list, tag checkbox-dropdown (OR) + archive toggle.
// Loads everything and filters in JS, same reasoning as donations.tsx: the full
// set is small and the tag filter needs the joined tags anyway.
inventoryRoutes.get("/", requireAuth("inventory:read"), async (c) => {
  const user = c.get("user")!;
  const q = c.req.query();
  const tagFilter = c.req.queries("tag") ?? [];
  const inspectionFilter = c.req.queries("inspection") ?? [];
  const dueFilter = parseMulti(c.req.queries("due"), ["overdue", "soon"]);
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

  const inspectionNames = distinctInspectionNames(all.flatMap((item) => item.inspections));
  const today = new Date().toISOString().slice(0, 10);
  const soonEnd = addDays(today, 30);
  const wantedNames = new Set(inspectionFilter.map((n) => n.toLowerCase()));

  const filtered = all.filter((item) => {
    if (!showArchived && item.retiredAt) return false;
    if (inspectionFilter.length > 0 || dueFilter.length > 0) {
      const candidates = item.inspections.filter((r) => wantedNames.size === 0 || wantedNames.has(r.name.toLowerCase()));
      const matches = (r: Inspection) => dueFilter.length === 0
        || (r.dueDate != null && ((dueFilter.includes("overdue") && r.dueDate < today) || (dueFilter.includes("soon") && r.dueDate >= today && r.dueDate <= soonEnd)));
      if (!candidates.some(matches)) return false;
    }
    if (tagFilter.length > 0 && !tagFilter.some((wanted) => item.tags.some((t) => t.tag === wanted))) return false;
    if (lendableOnly && !lendingByItem.has(item.id)) return false;
    if (search) {
      const needle = search.toLowerCase();
      const hay = [item.name, ...item.serials.map((n) => n.serial), ...item.numbers.map((n) => n.number), item.locationText ?? "", ...(item.fieldValues ?? []).filter((fv) => fv.fieldDef.type === "text" || fv.fieldDef.type === "select").map((fv) => fv.value ?? "")];
      if (!hay.some((h) => h.toLowerCase().includes(needle))) return false;
    }
    return true;
  });

  const { page: reqPage, pageSize } = parsePagination(q);
  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(reqPage, totalPages);
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);
  const pageUrl = (p: number) => buildListUrl("/inventory", { q: search, tag: tagFilter, inspection: inspectionFilter, due: dueFilter, archived: showArchived ? "1" : undefined, lendable: lendableOnly ? "1" : undefined, pageSize }, { page: p });

  const qs = (extra: Record<string, string | string[] | undefined>) =>
    buildListUrl("/inventory", { q: search, tag: tagFilter, inspection: inspectionFilter, due: dueFilter, archived: showArchived ? "1" : undefined, lendable: lendableOnly ? "1" : undefined }, extra);
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
          {tagFilter.map((v) => <input type="hidden" name="tag" value={v} />)}
          {inspectionFilter.map((v) => <input type="hidden" name="inspection" value={v} />)}
          {dueFilter.map((v) => <input type="hidden" name="due" value={v} />)}
          {showArchived && <input type="hidden" name="archived" value="1" />}
          {lendableOnly && <input type="hidden" name="lendable" value="1" />}
        </form>
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

        <MultiSelectFilter
          param="inspection"
          autoApply
          options={inspectionNames.map((n) => ({ value: n, label: n }))}
          selected={inspectionFilter}
          allLabel={t("inventory.filter.allInspections")}
          countLabel={(count) => t("inventory.filter.inspectionCount", { count })}
          applyLabel={t("common.apply")}
          resetLabel={t("common.reset")}
        />
        <MultiSelectFilter
          param="due"
          autoApply
          options={[{ value: "overdue", label: t("inventory.filter.dueOverdue") }, { value: "soon", label: t("inventory.filter.dueSoon") }]}
          selected={dueFilter}
          allLabel={t("inventory.filter.allDue")}
          countLabel={(count) => t("inventory.filter.dueCount", { count })}
          applyLabel={t("common.apply")}
          resetLabel={t("common.reset")}
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
            <th>{t("inventory.table.tags")}</th>
            <th class="hidden md:table-cell">{t("inventory.table.dueDate")}</th>
            <th class="hidden lg:table-cell">{t("inventory.table.location")}</th>
            <th>{t("inventory.table.status")}</th>
            <th class="hidden md:table-cell">{t("inventory.table.quantity")}</th>
            {canLend && <th></th>}
          </tr>
        </thead>
        <tbody>
          {pageItems.length === 0 ? (
            <tr><td colspan={columnCount} class="text-center opacity-50 py-8">{t("inventory.table.empty")}</td></tr>
          ) : pageItems.map((item) => {
            const open = item.inspections.filter((r) => r.dueDate).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || a.name.localeCompare(b.name, "de"));
            const due = open[0];
            const lending = lendingByItem.get(item.id);
            const status = itemStatus(item, !!lending);
            return (
              <tr key={item.id} class="cursor-pointer hover" onclick={`window.location='/inventory/${item.id}'`}>
                <td>{item.name}</td>
                <td><div class="flex flex-wrap gap-1"><TagBadges tags={item.tags.map((tg) => tg.tag)} /></div></td>
                <td class="hidden md:table-cell">
                  {due ? <span class={due.dueDate! < today ? "text-error font-semibold" : ""}>{formatDate(due.dueDate!)} <span class="opacity-60">{due.name}</span></span> : "—"}
                  {open.length > 1 && <span class="badge badge-ghost badge-sm ml-1">+{open.length - 1}</span>}
                </td>
                <td class="hidden lg:table-cell">{item.locationText || "—"}</td>
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

// Erste Schreibweise je Prüfart-Name, ohne Beachtung der Groß-/Kleinschreibung, alphabetisch.
function distinctInspectionNames(rows: { name: string }[]): string[] {
  const byLower = new Map<string, string>();
  for (const r of rows) if (!byLower.has(r.name.toLowerCase())) byLower.set(r.name.toLowerCase(), r.name);
  return [...byLower.values()].sort((a, b) => a.localeCompare(b, "de"));
}

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

function InventoryForm({ title, action, values, errors, formId, assignedMemberName, assignments, extraActions, lendable, cancelHref, canConfigure }: {
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
  canConfigure?: boolean;
}) {
  return (
    <>
      <PageHeader title={title} backHref={cancelHref ?? "/inventory"} subtitle={t("common.requiredLegend")} actions={<>{extraActions}<FormActions formId={formId} cancelHref={cancelHref} /></>} />
      <form id={formId} method="post" action={action} class="space-y-4 max-w-2xl">
        <InventoryFormFields values={values} errors={errors} assignedMemberName={assignedMemberName} assignments={assignments} canConfigure={canConfigure} />
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
                  <div data-field="quantity" data-show-batch="true">
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

// GET /inventory/new — erst die Vorlagenauswahl, dann das Formular mit kopierten Vorgaben (?template=<id>, "none" = leer).
// Vorlagen sind nur Vorbelegung: am Posten bleibt keine Vorlagen-ID.
inventoryRoutes.get("/new", requireAuth("inventory:manage"), async (c) => {
  const user = c.get("user")!;
  const templateId = c.req.query("template");
  if (!templateId) {
    type PickerTemplate = { id: string; name: string; description: string | null; enabledFields: string[]; fieldDefs: { fieldDef: { archived: boolean } }[]; inspections: unknown[] };
    const templates = ((await db.query.inventoryTemplates.findMany({
      with: { fieldDefs: { with: { fieldDef: true } }, inspections: true },
    })) as unknown as PickerTemplate[]).sort((a, b) => a.name.localeCompare(b.name, "de"));
    if (templates.length === 0) return c.redirect("/inventory/new?template=none");
    const plural = (n: number, key: "fieldCount" | "inspectionCount") => t(`inventory.new.${key}.${n === 1 ? "one" : "other"}`, { count: n });
    const card = "card card-border bg-base-100 border-base-300 hover:border-primary h-full sm:min-h-28 focus-visible:outline-2 focus-visible:outline-primary";
    return c.html(
      <Layout title={t("inventory.newItem")} user={user}>
        <PageHeader title={t("inventory.newItem")} backHref="/inventory" subtitle={t("inventory.new.chooseHint")} actions={user.permissions.has("inventory:configure") && <HeaderAction icon="cog-6-tooth" label={t("inventory.new.manageTemplates")} href="/inventory/templates" />} />
        <div id="template-choice" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 2xl:max-w-6xl">
          <a href="/inventory/new?template=none" class={`${card} border-dashed`}>
            <div class="card-body p-4 sm:p-5 lg:p-6 flex-row items-start gap-3 sm:gap-4">
              <TagAvatar fallbackIcon="file" />
              <div class="min-w-0 space-y-1 lg:space-y-1.5">
                <div class="font-medium lg:text-lg">{t("inventory.new.noTemplate")}</div>
                <p class="text-sm opacity-70 line-clamp-2 lg:line-clamp-3">{t("inventory.new.noTemplateHint")}</p>
              </div>
            </div>
          </a>
          {templates.map((tpl) => {
            const fields = tpl.enabledFields.filter((f) => (INVENTORY_FIELDS as readonly string[]).includes(f)).length + tpl.fieldDefs.filter((d) => !d.fieldDef.archived).length;
            const counts = [fields && plural(fields, "fieldCount"), tpl.inspections.length && plural(tpl.inspections.length, "inspectionCount")].filter(Boolean).join(" · ");
            return (
              <a href={`/inventory/new?template=${tpl.id}`} class={card}>
                <div class="card-body p-4 sm:p-5 lg:p-6 flex-row items-start gap-3 sm:gap-4">
                  <TagAvatar tag={tpl.name} />
                  <div class="min-w-0 space-y-1 lg:space-y-1.5">
                    <div class="font-medium lg:text-lg">{tpl.name}</div>
                    {tpl.description && <p class="text-sm opacity-70 line-clamp-2 lg:line-clamp-3">{tpl.description}</p>}
                    {counts && <p class="text-sm opacity-60">{counts}</p>}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      </Layout>
    );
  }

  let prefill: Partial<InventoryFieldValues> = {};
  if (templateId !== "none") {
    const tpl = (await db.query.inventoryTemplates.findFirst({
      where: eq(inventoryTemplates.id, templateId),
      with: { fieldDefs: { with: { fieldDef: true } }, inspections: { with: { inspectionTemplate: true } } },
    })) as unknown as { name: string; enabledFields: string[]; fieldDefs: { fieldDef: FreeDef }[]; inspections: { inspectionTemplate: { name: string; defaultIntervalMonths: number | null } }[] } | undefined;
    if (!tpl) return c.redirect("/inventory/new");
    prefill = {
      enabledFieldsList: tpl.enabledFields.filter((f): f is InventoryField => (INVENTORY_FIELDS as readonly string[]).includes(f)),
      tagsList: [tpl.name],
      freeRaw: Object.fromEntries(tpl.fieldDefs.filter((d) => !d.fieldDef.archived).map((d) => [d.fieldDef.id, ""])),
      inspectionRows: tpl.inspections.map(({ inspectionTemplate: it }) => ({ id: "", name: it.name, interval: it.defaultIntervalMonths ? String(it.defaultIntervalMonths) : "", last: "", due: "" })),
    };
  }
  // Ohne Vorlagen gibt es keine Auswahl, zu der Abbrechen zurückführen könnte (sie leitet wieder hierher um).
  const hasTemplates = (await db.query.inventoryTemplates.findMany({ columns: { id: true }, limit: 1 })).length > 0;
  return c.html(
    <Layout title={t("inventory.newItem")} user={user}>
      <InventoryForm canConfigure={user.permissions.has("inventory:configure")} title={t("inventory.newItem")} action="/inventory" formId="inventory-new-form" cancelHref={hasTemplates ? "/inventory/new" : "/inventory"} lendable={lendableField(user, false, {})} values={await withFree(prefill)} />
    </Layout>
  );
});

// POST /inventory
inventoryRoutes.post("/", requireAuth("inventory:manage"), async (c) => {
  const user = c.get("user")!;
  const body = await c.req.parseBody({ all: true });
  const { values, errors } = parseInventoryFields(body);
  const tags = canonicalizeTags(parseTags(body, "tags"), await tagVocabulary());
  const numbers = hasField(values.enabledFieldsList, "numbers") ? parseList(body, "numbers") : [];
  const serials = hasField(values.enabledFieldsList, "serials") ? parseList(body, "serials") : [];
  const insertValues = toInsertValues(values);
  const { assignments, error: assignmentError } = resolveAssignments(values, insertValues.enabledFields, insertValues.quantity);
  if (assignmentError) errors.assignments = assignmentError;
  const numbersError = await validateNumbers(numbers, insertValues.quantity);
  if (numbersError) errors.numbers = numbersError;
  const serialsError = validateSerials(serials, insertValues.quantity);
  if (serialsError) errors.serials = serialsError;
  const { rows: inspectionRows, errors: inspectionErrors } = hasField(values.enabledFieldsList, "inspection")
    ? parseInspectionRows(body, new Date().toISOString().slice(0, 10))
    : { rows: [] as InspectionFormRow[], errors: {} as Record<number, InspectionRowError> };
  if (Object.keys(inspectionErrors).length > 0) errors.inspections = t("inventory.form.inspectionsInvalid");
  const free = await resolveFree(values);
  if (free.error) errors.freeFields = free.error;
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
          values={await withFree({ ...values, tagsList: tags, numbersList: numbers, serialsList: serials, inspectionRows, inspectionErrors })}
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
    if (inspectionRows.length > 0) {
      await tx.insert(inventoryInspections).values(inspectionRows.map((r) => ({ inventoryItemId: item.id, ...inspectionValues(r) })));
    }
    if (free.rows.length > 0) {
      await tx.insert(inventoryFieldValues).values(free.rows.map((r) => ({ inventoryItemId: item.id, ...r })));
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
    if (isInspectionNameViolation(err)) errors.inspections = t("inventory.form.inspectionError.duplicate");
    else errors.numbers = t("inventory.form.numberRace");
    const assignmentNames = await resolveAssignmentNames(assignments);
    return c.html(
      <Layout title={t("inventory.newItem")} user={user}>
        <InventoryForm canConfigure={user.permissions.has("inventory:configure")} title={t("inventory.newItem")} action="/inventory" formId="inventory-new-form"
          values={await withFree({ ...values, tagsList: tags, numbersList: numbers, serialsList: serials, inspectionRows, inspectionErrors })} errors={errors}
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
    commissionedAt: item.commissionedAt ?? "",
    purchasePrice: item.purchasePrice ?? "",
    notes: item.notes ?? "",
    serialsList: sortedSerials(item),
    quantity: String(item.quantity),
    assignedMemberId: !isBatch ? (assignmentList[0]?.memberId ?? "") : "",
    tagsList: item.tags.map((tg) => tg.tag),
    numbersList: sortedNumbers(item),
    enabledFieldsList: (item.enabledFields ?? []) as InventoryField[],
    locationText: item.locationText ?? "",
    latitude: item.latitude ?? "",
    longitude: item.longitude ?? "",
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
        values={await withFree(values, item.id)}
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
  const numbers = hasField(values.enabledFieldsList, "numbers") ? parseList(body, "numbers") : [];
  const serials = hasField(values.enabledFieldsList, "serials") ? parseList(body, "serials") : [];
  const insertValues = toInsertValues(values);
  const { assignments, error: assignmentError } = resolveAssignments(values, insertValues.enabledFields, insertValues.quantity, existing.retiredQuantity);
  if (assignmentError) errors.assignments = assignmentError;
  const numbersError = await validateNumbers(numbers, insertValues.quantity, id);
  if (numbersError) errors.numbers = numbersError;
  const serialsError = validateSerials(serials, insertValues.quantity);
  if (serialsError) errors.serials = serialsError;
  const { rows: inspectionRows, errors: inspectionErrors } = hasField(values.enabledFieldsList, "inspection")
    ? parseInspectionRows(body, new Date().toISOString().slice(0, 10))
    : { rows: [] as InspectionFormRow[], errors: {} as Record<number, InspectionRowError> };
  if (Object.keys(inspectionErrors).length > 0) errors.inspections = t("inventory.form.inspectionsInvalid");

  // Sperre: ein Feld lässt sich nur abwählen, solange es am gespeicherten Posten leer ist (nichts geht still verloren).
  const lockedFields = INVENTORY_FIELDS.filter((f) => hasField(existing.enabledFields, f) && !hasField(insertValues.enabledFields, f));
  const storedFree = await db.query.inventoryFieldValues.findMany({ where: eq(inventoryFieldValues.inventoryItemId, id) });
  const free = await resolveFree(values, storedFree);
  if (free.error) errors.freeFields = free.error;
  if (lockedFields.length > 0) {
    const stored = await db.query.lendingItems.findFirst({ where: eq(lendingItems.inventoryItemId, id) });
    const openLoan = stored ? await db.query.lendingLoans.findFirst({ where: and(eq(lendingLoans.lendingItemId, stored.id), isNull(lendingLoans.returnedAt)) }) : undefined;
    const state = {
      quantity: existing.quantity, retiredQuantity: existing.retiredQuantity, numbers: existing.numbers.length, serials: existing.serials.length,
      assignments: existing.assignments.length, locationText: existing.locationText, latitude: existing.latitude, longitude: existing.longitude,
      inspections: existing.inspections.length,
      activeLoans: openLoan ? 1 : 0,
    };
    const blocked = lockedFields.filter((f) => !isFieldEmpty(f, state));
    if (blocked.length > 0) values.enabledFieldsList = [...(values.enabledFieldsList ?? []), ...blocked];
    if (blocked.length > 0) errors.enabledFields = t("inventory.form.fieldLocked", { fields: blocked.map((f) => t(`inventory.field.${f}`)).join(", ") });
  }

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
          values={await withFree({ ...values, tagsList: tags, numbersList: numbers, serialsList: serials, inspectionRows, inspectionErrors }, id)}
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
    const { insert, update, deleteIds } = diffInspections(existing.inspections.map((r) => r.id), inspectionRows);
    if (deleteIds.length > 0) await tx.delete(inventoryInspections).where(inArray(inventoryInspections.id, deleteIds));
    // Namenstausch: betroffene Zeilen erst auf einen freien Zwischennamen, dann auf die Zielnamen (Unique-Index prüft je UPDATE).
    for (const rid of renamedInspectionIds(existing.inspections, update)) await tx.update(inventoryInspections).set({ name: `__tmp_${rid}` }).where(eq(inventoryInspections.id, rid));
    for (const r of update) await tx.update(inventoryInspections).set(inspectionValues(r)).where(and(eq(inventoryInspections.id, r.id), eq(inventoryInspections.inventoryItemId, id)));
    if (insert.length > 0) await tx.insert(inventoryInspections).values(insert.map((r) => ({ inventoryItemId: id, ...inspectionValues(r) })));
    await tx.delete(inventoryFieldValues).where(eq(inventoryFieldValues.inventoryItemId, id));
    if (free.rows.length > 0) {
      await tx.insert(inventoryFieldValues).values(free.rows.map((r) => ({ inventoryItemId: id, ...r })));
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
    if (isInspectionNameViolation(err)) errors.inspections = t("inventory.form.inspectionError.duplicate");
    else errors.numbers = t("inventory.form.numberRace");
    const assignmentNames = await resolveAssignmentNames(assignments);
    return c.html(
      <Layout title={existing.name} user={user}>
        <InventoryForm canConfigure={user.permissions.has("inventory:configure")} title={existing.name} action={`/inventory/${id}`} formId="inventory-edit-form"
          values={await withFree({ ...values, tagsList: tags, numbersList: numbers, serialsList: serials, inspectionRows, inspectionErrors }, id)} errors={errors}
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
  const inspectionFilter = c.req.queries("inspection") ?? [];

  const all = await fetchItems();
  const inspectionNames = distinctInspectionNames(all.flatMap((item) => item.inspections));
  // Überfällige Prüfarten immer anzeigen, unabhängig vom Zeitraum-Filter — sonst
  // verschwinden sie aus der Liste, sobald "start" nicht mehr in der Vergangenheit liegt.
  const overdueItems = generateInspectionDueItems(all, "0000-01-01", today, inspectionFilter);
  const dueInRange = generateInspectionDueItems(all, start, end, inspectionFilter);
  const seen = new Set(overdueItems.map((d) => d.inspectionId));
  const due = [...overdueItems, ...dueInRange.filter((d) => !seen.has(d.inspectionId))].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name, "de") || a.inspectionName.localeCompare(b.inspectionName, "de"),
  );

  const qs = (extra: Record<string, string | undefined>) => buildListUrl("/inventory/inspections", { ...rangeParams(range), inspection: inspectionFilter }, extra);
  const presets = rangePresets(today, "future");

  return c.html(
    <Layout title={t("inventory.inspections.title")} user={user}>
      <PageHeader title={t("inventory.inspections.title")} />

      <div class="filter-bar flex flex-wrap items-center gap-3 mb-4">
        <QuickRangeFilter presets={presets} range={range} dir="future" action="/inventory/inspections"
          hidden={inspectionFilter.map((n): [string, string] => ["inspection", n])} href={(p) => qs(p)} />
        <div class="self-end">
          <MultiSelectFilter
            param="inspection"
            autoApply
            options={inspectionNames.map((n) => ({ value: n, label: n }))}
            selected={inspectionFilter}
            allLabel={t("inventory.filter.allInspections")}
            countLabel={(count) => t("inventory.filter.inspectionCount", { count })}
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
              <th>{t("inventory.inspections.table.inspection")}</th>
              <th>{t("inventory.inspections.table.dueDate")}</th>
            </tr>
          </thead>
          <tbody>
            {due.map((d) => {
              const overdue = d.dueDate < today;
              return (
                <tr key={d.inspectionId} class="cursor-pointer hover" onclick={`window.location='/inventory/${d.id}'`}>
                  <td class={overdue ? "text-error font-semibold" : ""}>{d.name}</td>
                  <td>{d.inspectionName}</td>
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
      status: deriveMemberStatus({ ...m.person, ...m }, m.assignments, env.CHILDREN_AGE_LIMIT, env.YOUTH_AGE_LIMIT, env.ACTIVE_AGE_LIMIT),
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

function InspectionList({ item, canManage, today }: { item: ItemWithRelations; canManage: boolean; today: string }) {
  const rows = item.inspections.slice().sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.name.localeCompare(b.name, "de"));
  return (
    <div class="mt-6 max-w-2xl">
      <div class="text-sm opacity-60">{t("inventory.field.inspection")}</div>
      <table class="table w-full">
        <thead>
          <tr>
            <th>{t("inventory.form.inspectionName")}</th>
            <th>{t("inventory.form.inspectionLast")}</th>
            <th>{t("inventory.form.inspectionDue")}</th>
            {canManage && <th></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const overdue = r.dueDate != null && r.dueDate < today;
            const next = nextDueDate(r.dueDate, r.intervalMonths, today) ?? "";
            const dialogId = `inspection-done-${r.id}`;
            return (
              <tr>
                <td>{r.name}{r.intervalMonths ? <span class="opacity-60 text-sm"> · {t("inventory.inspection.everyMonths", { count: r.intervalMonths })}</span> : null}</td>
                <td>{r.inspectedAt ? formatDate(r.inspectedAt) : "—"}</td>
                <td class={overdue ? "text-error font-semibold" : ""}>{r.dueDate ? formatDate(r.dueDate) : "—"}{overdue && <span class="badge badge-error badge-sm ml-1">{t("inventory.inspections.overdue")}</span>}</td>
                {canManage && (
                  <td class="text-right">
                    <button type="button" class="btn btn-sm" onclick={`document.getElementById('${dialogId}').showModal()`}>{t("inventory.inspection.markDone")}</button>
                    <dialog id={dialogId} class="modal text-left">
                      <div class="modal-box">
                        <h3 class="font-bold text-lg">{t("inventory.inspection.doneTitle", { name: r.name })}</h3>
                        <form method="post" action={`/inventory/${item.id}/inspections/${r.id}/done`} class="space-y-2 mt-2"
                          onsubmit={`var d=this.elements.dueDate;return !d||!d.value||d.value>=this.elements.inspectedAt.value||confirm(${JSON.stringify(t("inventory.inspection.dueBeforeDoneConfirm"))})`}>
                          <Field label={t("inventory.inspection.doneDate")}>
                            <input type="date" name="inspectedAt" value={today} max={today} required class="input w-full" />
                          </Field>
                          {r.intervalMonths && (
                            <Field label={t("inventory.form.inspectionDue")} hint={t("inventory.inspection.dueHint")}>
                              <input type="date" name="dueDate" value={next} class="input w-full" />
                            </Field>
                          )}
                          <div class="modal-action">
                            <button type="button" class="btn" onclick={`document.getElementById('${dialogId}').close()`}>{t("common.cancel")}</button>
                            <button type="submit" class="btn btn-primary">{t("inventory.inspection.markDone")}</button>
                          </div>
                        </form>
                      </div>
                      <form method="dialog" class="modal-backdrop"><button>{t("common.close")}</button></form>
                    </dialog>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// POST /inventory/:id/inspections/:inspectionId/done — Prüfdatum setzen, neue Fälligkeit nach nextDueDate (im Dialog überschreibbar).
inventoryRoutes.post("/:id/inspections/:inspectionId/done", requireAuth("inventory:manage"), async (c) => {
  const id = c.req.param("id");
  const inspection = await db.query.inventoryInspections.findFirst({
    where: and(eq(inventoryInspections.id, c.req.param("inspectionId")), eq(inventoryInspections.inventoryItemId, id)),
  });
  if (!inspection) return c.notFound();
  // Ausgemusterte Posten werden nicht mehr geprüft (der Button ist dort ausgeblendet, hier die serverseitige Sperre).
  const item = await db.query.inventoryItems.findFirst({ where: eq(inventoryItems.id, id), columns: { retiredAt: true } });
  if (item?.retiredAt) {
    setFlash(c, t("inventory.inspection.retiredItem"), "error");
    return c.redirect(`/inventory/${id}`);
  }
  const body = await c.req.parseBody();
  const today = new Date().toISOString().slice(0, 10);
  const inspectedAt = trimmed(body, "inspectedAt");
  const override = trimmed(body, "dueDate");
  const valid = isIsoDate;
  if (!valid(inspectedAt) || inspectedAt > today || (override && !valid(override))) {
    setFlash(c, t("inventory.inspection.invalidDone"), "error");
    return c.redirect(`/inventory/${id}`);
  }
  const dueDate = inspection.intervalMonths ? override || nextDueDate(inspection.dueDate, inspection.intervalMonths, inspectedAt) : null;
  await db.update(inventoryInspections).set({ inspectedAt, dueDate }).where(eq(inventoryInspections.id, inspection.id));
  setFlash(c, t("inventory.inspection.doneFlash"), "success");
  return c.redirect(`/inventory/${id}`);
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
  const availableToRetire = item.quantity - item.retiredQuantity - assigned.reduce((sum, x) => sum + x.quantity, 0);
  const retireAction = canManage ? <RetireAction item={item} isBatch={item.quantity > 1} availableToRetire={availableToRetire} /> : undefined;
  const price = item.purchasePrice ? `${item.purchasePrice} €` : null;
  return c.html(
    <Layout title={item.name} user={user}>
      <PageHeader title={<>{item.name} <TagBadges tags={item.tags.map((tg) => tg.tag)} /> <span class={`badge badge-sm ${status === "retired" ? "badge-neutral" : status === "lendable" ? "badge-info" : "badge-success"}`}>{t(`inventory.status.${status}`)}</span></>} backHref="/inventory" actions={<DetailActions editHref={canManage ? `/inventory/${item.id}/edit` : undefined} remove={retireAction} />} />
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
        {item.serials.length > 0 && (
          <div class="sm:col-span-2">
            <div class="text-sm opacity-60">{t(item.quantity > 1 ? "inventory.form.serialNumbers" : "inventory.form.serialNumber")}</div>
            <div class="flex flex-wrap gap-1 mt-1">{sortedSerials(item).map((n) => <span class="badge badge-outline">{n}</span>)}</div>
          </div>
        )}
        {hasField(item.enabledFields, "location") && <>
          <ViewField label={t("inventory.form.locationText")} value={item.locationText} />
          <ViewField label={t("inventory.form.coordinates")} value={item.latitude != null && item.longitude != null ? `${item.latitude}, ${item.longitude}` : null} />
        </>}
        {(item.fieldValues ?? []).slice().sort((a, b) => a.fieldDef.name.localeCompare(b.fieldDef.name, "de")).map((fv) => (
          <ViewField label={fv.fieldDef.name} value={fv.value == null ? null : fv.fieldDef.type === "boolean" ? t(fv.value === "1" ? "common.yes" : "common.no") : fv.fieldDef.type === "date" ? formatDate(fv.value) : fv.value} />
        ))}
        {item.quantity > 1 && <ViewField label={t("inventory.form.quantity")} value={String(item.quantity)} />}
        {hasField(item.enabledFields, "assignments") && <ViewField
          label={t("inventory.form.assignedMember")}
          value={assigned.map((a) => (item.quantity > 1 ? `${a.name} (${a.quantity}×)` : a.name)).join(", ") || null}
        />}
      </ViewGrid>
      {hasField(item.enabledFields, "inspection") && item.inspections.length > 0 && (
        <InspectionList item={item} canManage={canManage && !item.retiredAt} today={new Date().toISOString().slice(0, 10)} />
      )}
      {item.notes && <div class="mt-6 max-w-2xl"><ViewField label={t("inventory.form.notes")} value={item.notes} /></div>}
    </Layout>
  );
});
