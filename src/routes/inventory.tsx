import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { inventoryItems, inventoryItemTags, members } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { formatDate } from "../lib/format.js";
import { trimmed, parseTags } from "../lib/forms.js";
import { buildListUrl } from "../lib/list-query.js";
import { generateInspectionDueItems, type InventoryCategory } from "../lib/inventory.js";
import { deriveMemberStatus } from "../lib/status.js";
import { env } from "../env.js";
import { SEARCH_DEBOUNCE_MS } from "../lib/constants.js";

export const inventoryRoutes = new Hono<{ Variables: Variables }>();

// ── Types ────────────────────────────────────────────────────────────────────

type InventoryItemRow = typeof inventoryItems.$inferSelect;
type Tag = typeof inventoryItemTags.$inferSelect;
type MemberRow = typeof members.$inferSelect;
type Person = { firstName: string; lastName: string };
type ItemWithRelations = InventoryItemRow & { tags: Tag[]; assignedMember: (MemberRow & { person: Person }) | null };

const CATEGORIES: InventoryCategory[] = ["vehicle", "scba", "equipment", "ppe", "other"];

const CATEGORY_LABELS: Record<InventoryCategory, string> = {
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

function CategoryBadge({ category }: { category: InventoryCategory }) {
  return <span class={`${CATEGORY_BADGE[category]} badge-sm`}>{CATEGORY_LABELS[category]}</span>;
}

// ── Form field parsing ───────────────────────────────────────────────────────

type InventoryFieldValues = {
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
  assignedMemberId: string;
};

function parseInventoryFields(body: Record<string, any>): { values: InventoryFieldValues; errors: Record<string, string> } {
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
    assignedMemberId: trimmed(body, "assignedMemberId"),
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
  return { values, errors };
}

// category=ppe is the only category allowed to carry an assignment — anything
// else submitted for another category is dropped server-side, not just hidden
// client-side (see backlog doc's "nur App-Validierung" note).
function toInsertValues(values: InventoryFieldValues) {
  const category = values.category as InventoryCategory;
  return {
    name: values.name,
    category,
    purchaseDate: values.purchaseDate || null,
    purchasePrice: values.purchasePrice ? values.purchasePrice.replace(",", ".") : null,
    notes: values.notes || null,
    assignedMemberId: category === "ppe" && values.assignedMemberId ? values.assignedMemberId : null,
    licensePlate: category === "vehicle" ? values.licensePlate || null : null,
    yearOfManufacture: category === "vehicle" && values.yearOfManufacture ? Number(values.yearOfManufacture) : null,
    vehicleInspectionDue: category === "vehicle" ? values.vehicleInspectionDue || null : null,
    serialNumber: category === "scba" || category === "equipment" || category === "ppe" ? values.serialNumber || null : null,
    nextInspectionDue: category === "scba" || category === "equipment" || category === "ppe" ? values.nextInspectionDue || null : null,
    lastInspectionDate: category === "scba" ? values.lastInspectionDate || null : null,
  };
}

// ── Tag input (chip UI over a comma-joined hidden field) ────────────────────

function TagInput({ tags }: { tags?: string[] }) {
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
            if (Array.from(el.querySelectorAll('[data-tag]')).some(function(s){return s.dataset.tag === value})) { input.value = ''; return; }
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

// ── Assigned-member picker (search existing aktiv/jugend members, no create) ─

function MemberPickerFields({ memberId, memberName }: { memberId?: string; memberName?: string }) {
  const showSelected = Boolean(memberId);
  return (
    <div class="form-control" id="cat-fields-ppe-member">
      <label class="label"><span class="label-text">{t("inventory.form.assignedMember")}</span></label>
      <div id="member-picker-search" class={showSelected ? "hidden" : ""}>
        <input
          type="text"
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
            var resEl = e.target.closest('.member-result');
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

// ── Category-dependent form fields ──────────────────────────────────────────

// No precedent in the code for dynamic show/hide of form fields — plain client-side
// classList toggle (same idea as the pagination <select> inline script in
// members.tsx), not an HTMX round-trip for a purely visual switch.
const CATEGORY_TOGGLE_SCRIPT = `
  function toggleInventoryCategoryFields() {
    var cat = document.getElementById('inventory-category').value;
    document.querySelectorAll('[data-category-fields]').forEach(function(el) {
      el.classList.toggle('hidden', el.dataset.categoryFields !== cat);
    });
  }
  toggleInventoryCategoryFields();
`;

function InventoryFormFields({ values, errors, assignedMemberName }: {
  values?: Partial<InventoryFieldValues>;
  errors?: Record<string, string>;
  assignedMemberName?: string;
}) {
  const v = values ?? {};
  return (
    <>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="form-control">
          <label class="label"><span class="label-text">{t("inventory.form.name")}<span class="text-error ml-1">*</span></span></label>
          <input type="text" name="name" value={v.name ?? ""} class={`input input-bordered w-full${errors?.name ? " input-error" : ""}`} />
          {errors?.name && <span class="text-error text-sm mt-1">{errors.name}</span>}
        </div>
        <div class="form-control">
          <label class="label"><span class="label-text">{t("inventory.form.category")}<span class="text-error ml-1">*</span></span></label>
          <select
            id="inventory-category"
            name="category"
            class={`select select-bordered w-full${errors?.category ? " select-error" : ""}`}
            onchange="toggleInventoryCategoryFields()"
          >
            <option value="" disabled selected={!v.category}>{t("inventory.form.categoryPlaceholder")}</option>
            {CATEGORIES.map((cat) => (
              <option value={cat} selected={v.category === cat}>{CATEGORY_LABELS[cat]}</option>
            ))}
          </select>
          {errors?.category && <span class="text-error text-sm mt-1">{errors.category}</span>}
        </div>
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
        </div>
      </div>

      <div class="form-control">
        <label class="label"><span class="label-text">{t("inventory.form.notes")}</span></label>
        <textarea name="notes" class="textarea textarea-bordered w-full" rows={3}>{v.notes ?? ""}</textarea>
      </div>

      <TagInput tags={v.tagsList} />

      <div data-category-fields="vehicle" class="space-y-4 hidden">
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

      <div data-category-fields="scba" class="space-y-4 hidden">
        <div class="divider">{CATEGORY_LABELS.scba}</div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="form-control">
            <label class="label"><span class="label-text">{t("inventory.form.serialNumber")}</span></label>
            <input type="text" name="serialNumber" value={v.serialNumber ?? ""} class="input input-bordered w-full" />
          </div>
          <div class="form-control">
            <label class="label"><span class="label-text">{t("inventory.form.lastInspectionDate")}</span></label>
            <input type="date" name="lastInspectionDate" value={v.lastInspectionDate ?? ""} class="input input-bordered w-full" />
          </div>
          <div class="form-control">
            <label class="label"><span class="label-text">{t("inventory.form.nextInspectionDue")}</span></label>
            <input type="date" name="nextInspectionDue" value={v.nextInspectionDue ?? ""} class="input input-bordered w-full" />
          </div>
        </div>
      </div>

      <div data-category-fields="equipment" class="space-y-4 hidden">
        <div class="divider">{CATEGORY_LABELS.equipment}</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-control">
            <label class="label"><span class="label-text">{t("inventory.form.serialNumber")}</span></label>
            <input type="text" name="serialNumber" value={v.serialNumber ?? ""} class="input input-bordered w-full" />
          </div>
          <div class="form-control">
            <label class="label"><span class="label-text">{t("inventory.form.nextInspectionDue")}</span></label>
            <input type="date" name="nextInspectionDue" value={v.nextInspectionDue ?? ""} class="input input-bordered w-full" />
          </div>
        </div>
      </div>

      <div data-category-fields="ppe" class="space-y-4 hidden">
        <div class="divider">{CATEGORY_LABELS.ppe}</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-control">
            <label class="label"><span class="label-text">{t("inventory.form.serialNumber")}</span></label>
            <input type="text" name="serialNumber" value={v.serialNumber ?? ""} class="input input-bordered w-full" />
          </div>
          <div class="form-control">
            <label class="label"><span class="label-text">{t("inventory.form.nextInspectionDue")}</span></label>
            <input type="date" name="nextInspectionDue" value={v.nextInspectionDue ?? ""} class="input input-bordered w-full" />
          </div>
        </div>
        <MemberPickerFields memberId={v.assignedMemberId} memberName={assignedMemberName} />
      </div>

      <div data-category-fields="other" class="hidden" />

      <script dangerouslySetInnerHTML={{ __html: CATEGORY_TOGGLE_SCRIPT }} />
    </>
  );
}

// ── Data access ──────────────────────────────────────────────────────────────

async function fetchItems(): Promise<ItemWithRelations[]> {
  return db.query.inventoryItems.findMany({
    with: { tags: true, assignedMember: { with: { person: true } } },
    orderBy: (items, { asc }) => [asc(items.name)],
  }) as unknown as Promise<ItemWithRelations[]>;
}

async function fetchItem(id: string): Promise<ItemWithRelations | undefined> {
  return db.query.inventoryItems.findFirst({
    where: eq(inventoryItems.id, id),
    with: { tags: true, assignedMember: { with: { person: true } } },
  }) as unknown as Promise<ItemWithRelations | undefined>;
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
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">{t("inventory.title")}</h1>
        <div class="flex items-center gap-2">
          <a href="/inventory/inspections" class="btn btn-ghost">{t("inventory.inspections.title")}</a>
          {user.permissions.has("inventory:manage") && <a href="/inventory/new" class="btn btn-primary">{t("inventory.newItem")}</a>}
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-3 mb-4">
        <div class="join">
          <a href={qs({ category: undefined })} class={`join-item btn ${category === "" ? "btn-outline btn-primary" : "btn-ghost"}`}>{t("inventory.filter.allCategories")}</a>
          {CATEGORIES.map((cat) => (
            <a href={qs({ category: cat })} class={`join-item btn ${category === cat ? "btn-outline btn-primary" : "btn-ghost"}`}>{CATEGORY_LABELS[cat]}</a>
          ))}
        </div>

        <details id="tag-filter-dropdown" class="dropdown">
          <summary class="btn btn-ghost m-0">
            {tagFilter.length === 0 ? t("inventory.filter.allTags") : t("inventory.filter.tagCount", { count: tagFilter.length })} ▾
          </summary>
          <div class="dropdown-content z-10 bg-base-100 border border-base-300 rounded-box shadow-lg w-64 p-2 mt-1">
            <ul class="space-y-0.5 max-h-64 overflow-y-auto">
              {allTags.length === 0 && <li class="text-sm opacity-50 px-2 py-1">{t("inventory.filter.noTags")}</li>}
              {allTags.map((tag) => (
                <li>
                  <label class="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-base-200">
                    <input type="checkbox" class="checkbox checkbox-xs tag-filter-checkbox" value={tag} checked={tagFilter.includes(tag)} />
                    <span class="text-sm flex-1">{tag}</span>
                  </label>
                </li>
              ))}
            </ul>
            <button class="btn btn-sm btn-primary w-full mt-2" id="tag-filter-apply">{t("common.apply")}</button>
          </div>
        </details>
        <script dangerouslySetInnerHTML={{ __html: `
          document.getElementById('tag-filter-apply')?.addEventListener('click', function() {
            var checked = Array.from(document.querySelectorAll('.tag-filter-checkbox:checked')).map(function(el){return el.value});
            var url = new URL(window.location.href);
            url.searchParams.delete('tag');
            checked.forEach(function(v){ url.searchParams.append('tag', v) });
            window.location.href = url.toString();
          });
        ` }} />

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

function InventoryForm({ title, action, values, errors, formId, assignedMemberName, extraActions }: {
  title: string;
  action: string;
  values?: Partial<InventoryFieldValues>;
  errors?: Record<string, string>;
  formId: string;
  assignedMemberName?: string;
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
        <InventoryFormFields values={values} errors={errors} assignedMemberName={assignedMemberName} />
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

  if (Object.keys(errors).length > 0) {
    return c.html(
      <Layout title={t("inventory.newItem")} user={user} activeNav="inventory">
        <InventoryForm title={t("inventory.newItem")} action="/inventory" formId="inventory-new-form" values={{ ...values, tagsList: tags }} errors={errors} />
      </Layout>,
      422
    );
  }

  await db.transaction(async (tx) => {
    const [item] = await tx.insert(inventoryItems).values(toInsertValues(values)).returning();
    if (tags.length > 0) {
      await tx.insert(inventoryItemTags).values(tags.map((tag) => ({ inventoryItemId: item.id, tag })));
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
    assignedMemberId: item.assignedMemberId ?? "",
    tagsList: item.tags.map((tg) => tg.tag),
  };

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
      <InventoryForm
        title={item.name}
        action={`/inventory/${item.id}`}
        formId="inventory-edit-form"
        values={values}
        assignedMemberName={item.assignedMember ? `${item.assignedMember.person.firstName} ${item.assignedMember.person.lastName}` : undefined}
        extraActions={retireAction}
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

  if (Object.keys(errors).length > 0) {
    return c.html(
      <Layout title={existing.name} user={user} activeNav="inventory">
        <InventoryForm
          title={existing.name}
          action={`/inventory/${id}`}
          formId="inventory-edit-form"
          values={{ ...values, tagsList: tags }}
          errors={errors}
          assignedMemberName={existing.assignedMember ? `${existing.assignedMember.person.firstName} ${existing.assignedMember.person.lastName}` : undefined}
        />
      </Layout>,
      422
    );
  }

  await db.transaction(async (tx) => {
    await tx.update(inventoryItems).set(toInsertValues(values)).where(eq(inventoryItems.id, id));
    await tx.delete(inventoryItemTags).where(eq(inventoryItemTags.inventoryItemId, id));
    if (tags.length > 0) {
      await tx.insert(inventoryItemTags).values(tags.map((tag) => ({ inventoryItemId: id, tag })));
    }
  });

  setFlash(c, t("inventory.flash.saved"), "success");
  return c.redirect("/inventory");
});

// POST /inventory/:id/retire — soft-delete, item stays in the DB (insurance/audit).
inventoryRoutes.post("/:id/retire", requireAuth("inventory:manage"), async (c) => {
  const id = c.req.param("id");
  const body = await c.req.parseBody();
  const reason = trimmed(body, "retiredReason");
  await db.update(inventoryItems).set({ retiredAt: new Date().toISOString().slice(0, 10), retiredReason: reason || null }).where(eq(inventoryItems.id, id));
  setFlash(c, t("inventory.flash.retired"), "success");
  return c.redirect(`/inventory/${id}/edit`);
});

// POST /inventory/:id/reactivate — undo an accidental retire, low effort, keeps
// the soft-delete character of this feature consistent.
inventoryRoutes.post("/:id/reactivate", requireAuth("inventory:manage"), async (c) => {
  const id = c.req.param("id");
  await db.update(inventoryItems).set({ retiredAt: null, retiredReason: null }).where(eq(inventoryItems.id, id));
  setFlash(c, t("inventory.flash.reactivated"), "success");
  return c.redirect(`/inventory/${id}/edit`);
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
  let due = generateInspectionDueItems(all, start, end);
  if (category) due = due.filter((d) => d.category === category);

  const qs = (extra: Record<string, string | undefined>) => buildListUrl("/inventory/inspections", { start, end, category: category || undefined }, extra);
  const quickLink = (months: number) => qs({ start: today, end: addMonths(today, months) });
  const thisYear = today.slice(0, 4);
  const nextYear = String(Number(thisYear) + 1);

  return c.html(
    <Layout title={t("inventory.inspections.title")} user={user} activeNav="inventory">
      <div class="mb-4">
        <a href="/inventory" class="link link-hover text-sm opacity-70">{t("common.backToList")}</a>
        <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{t("inventory.inspections.title")}</h1>
      </div>

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
        <div class="join">
          <a href={quickLink(3)} class="join-item btn btn-ghost">{t("anniversaries.quick.3months")}</a>
          <a href={quickLink(6)} class="join-item btn btn-ghost">{t("anniversaries.quick.6months")}</a>
          <a href={quickLink(12)} class="join-item btn btn-ghost">{t("anniversaries.quick.12months")}</a>
          <a href={qs({ start: `${thisYear}-01-01`, end: `${thisYear}-12-31` })} class="join-item btn btn-ghost">{t("anniversaries.quick.thisYear")}</a>
          <a href={qs({ start: `${nextYear}-01-01`, end: `${nextYear}-12-31` })} class="join-item btn btn-ghost">{t("anniversaries.quick.nextYear")}</a>
        </div>
        <div class="join">
          <a href={qs({ category: undefined })} class={`join-item btn ${category === "" ? "btn-outline btn-primary" : "btn-ghost"}`}>{t("inventory.filter.allCategories")}</a>
          {CATEGORIES.filter((c) => c !== "other").map((cat) => (
            <a href={qs({ category: cat })} class={`join-item btn ${category === cat ? "btn-outline btn-primary" : "btn-ghost"}`}>{CATEGORY_LABELS[cat]}</a>
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
// picker. Own route (not /members' search) so the aktiv/jugend filter is
// enforced by the query itself. Status is derived app-side (not stored), so
// every candidate's assignments are loaded to compute it — same approach as
// anniversaries.tsx.
inventoryRoutes.get("/search-members", requireAuth("inventory:manage"), async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.html("");

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
    .filter((m) => ASSIGNABLE_MEMBER_STATUSES.has(m.status))
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
