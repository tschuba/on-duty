import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { inventoryTemplates, inventoryTemplateFieldDefs, inventoryTemplateInspections } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { DetailActions, FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { Field, ViewField, ViewGrid } from "../components/field.js";
import { DeleteDialog } from "../components/delete-dialog.js";
import { setFlash } from "../lib/flash.js";
import { INSPECTION_NAME_MAX, INVENTORY_FIELDS, TEMPLATE_DESCRIPTION_MAX, isUniqueViolation, type InventoryField } from "../lib/inventory.js";
import { trimmed, parseList } from "../lib/forms.js";
import { t } from "../i18n/index.js";

export const inventoryTemplateRoutes = new Hono<{ Variables: Variables }>();
const configure = requireAuth("inventory:configure"); // ein Recht für alles: kein Leserecht, daher kein Redirect /:id/edit → /:id
const BASE = "/inventory/templates";

type FieldDef = { id: string; name: string; archived: boolean };
type InspectionTemplate = { id: string; name: string };
type TemplateRow = typeof inventoryTemplates.$inferSelect & { fieldDefs: { fieldDefId: string }[]; inspections: { inspectionTemplateId: string }[] };
type Values = { name: string; description: string; enabledFields: string[]; freeFields: string[]; inspections: string[] };

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "de");
const toValues = (r: TemplateRow): Values => ({ name: r.name, description: r.description ?? "", enabledFields: r.enabledFields, freeFields: r.fieldDefs.map((d) => d.fieldDefId), inspections: r.inspections.map((i) => i.inspectionTemplateId) });

async function loadChoices() {
  const defs = ((await db.query.inventoryFieldDefs.findMany()) as FieldDef[]).sort(byName);
  const inspections = ((await db.query.inventoryInspectionTemplates.findMany()) as InspectionTemplate[]).sort(byName);
  return { defs, inspections };
}

function TemplateFields({ values, defs, inspections }: { values?: Values; defs: FieldDef[]; inspections: InspectionTemplate[] }) {
  const fixed = new Set(values?.enabledFields);
  const chosenDefs = new Set(values?.freeFields);
  const chosenInspections = new Set(values?.inspections);
  // Archivierte Felder bleiben nur sichtbar, solange sie an der Vorlage hängen; neu wählbar sind sie nicht.
  const offered = defs.filter((d) => !d.archived || chosenDefs.has(d.id));
  return (
    <>
      <Field label={t("inventory.itemTemplates.name")} required>
        <input type="text" name="name" required maxlength={INSPECTION_NAME_MAX} value={values?.name ?? ""} class="input w-full" placeholder={t("inventory.itemTemplates.name")} />
      </Field>
      <Field label={t("inventory.itemTemplates.description")}>
        <input type="text" name="description" maxlength={TEMPLATE_DESCRIPTION_MAX} value={values?.description ?? ""} class="input w-full" placeholder={t("inventory.itemTemplates.description")} />
      </Field>
      <fieldset>
        <legend class="fieldset-legend">{t("inventory.form.fields")}</legend>
        <div class="flex flex-wrap gap-x-4 gap-y-2">
          {INVENTORY_FIELDS.map((f) => (
            <label class="label cursor-pointer justify-start gap-2 w-fit pointer-coarse:min-h-11">
              <input type="checkbox" name="enabledFields" value={f} checked={fixed.has(f)} class="checkbox" />
              <span class="text-sm">{t(`inventory.field.${f}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend class="fieldset-legend">{t("inventory.form.freeFields")}</legend>
        <div class="flex flex-wrap gap-x-4 gap-y-2">
          {offered.length === 0 && <span class="text-sm opacity-60">{t("inventory.itemTemplates.noFreeFields")}</span>}
          {offered.map((d) => (
            <label class="label cursor-pointer justify-start gap-2 w-fit pointer-coarse:min-h-11">
              <input type="checkbox" name="freeFields" value={d.id} checked={chosenDefs.has(d.id)} class="checkbox" />
              <span class="text-sm">{d.name}{d.archived && ` ${t("inventory.itemTemplates.archivedSuffix")}`}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend class="fieldset-legend">{t("inventory.itemTemplates.inspections")}</legend>
        <div class="flex flex-wrap gap-x-4 gap-y-2">
          {inspections.length === 0 && <span class="text-sm opacity-60">{t("inventory.itemTemplates.noInspections")}</span>}
          {inspections.map((i) => (
            <label class="label cursor-pointer justify-start gap-2 w-fit pointer-coarse:min-h-11">
              <input type="checkbox" name="inspections" value={i.id} checked={chosenInspections.has(i.id)} class="checkbox" />
              <span class="text-sm">{i.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}

// ponytail: kein Pager, bei > ca. 50 Zeilen nachrüsten.
inventoryTemplateRoutes.get("/", configure, async (c) => {
  const rows = ((await db.query.inventoryTemplates.findMany({ with: { fieldDefs: true, inspections: true } })) as TemplateRow[]).sort(byName);
  return c.html(
    <Layout title={t("inventory.itemTemplates.title")} user={c.get("user")!}>
      <PageHeader title={t("inventory.itemTemplates.title")} backHref="/inventory" subtitle={t("inventory.itemTemplates.hint")} actions={<HeaderAction variant="primary" icon="plus" label={t("inventory.itemTemplates.new")} href={`${BASE}/new`} class="btn-primary" />} />
      <div class="overflow-x-auto max-w-3xl">
        <table class="table table-zebra w-full">
          <thead>
            <tr>
              <th>{t("inventory.itemTemplates.name")}</th>
              <th>{t("inventory.itemTemplates.description")}</th>
              <th>{t("inventory.itemTemplates.colFields")}</th>
              <th>{t("inventory.itemTemplates.inspections")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colspan={4} class="text-center opacity-50 py-8">{t("inventory.itemTemplates.empty")}</td></tr>}
            {rows.map((r) => (
              <tr class="cursor-pointer hover" onclick={`location.href='${BASE}/${r.id}'`}>
                <td class="font-medium">{r.name}</td>
                <td class="max-w-xs truncate">{r.description}</td>
                <td>{r.enabledFields.length + r.fieldDefs.length}</td>
                <td>{r.inspections.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
});

async function renderForm(c: any, opts: { id?: string; values?: Values; error?: string; status?: 200 | 422 } = {}) {
  const { id } = opts;
  let values = opts.values;
  if (id && !values) {
    const row = (await db.query.inventoryTemplates.findFirst({ where: eq(inventoryTemplates.id, id), with: { fieldDefs: true, inspections: true } })) as TemplateRow | undefined;
    if (!row) return c.notFound();
    values = toValues(row);
  }
  const { defs, inspections } = await loadChoices();
  const title = t(id ? "inventory.itemTemplates.edit" : "inventory.itemTemplates.new");
  return c.html(
    <Layout title={title} user={c.get("user")!}>
      <PageHeader title={title} backHref={id ? `${BASE}/${id}` : BASE} actions={<FormActions formId="item-template-form" cancelHref={id ? `${BASE}/${id}` : BASE} />} />
      {opts.error && <div class="alert alert-error max-w-2xl mb-4" role="alert">{opts.error}</div>}
      <form id="item-template-form" method="post" action={id ? `${BASE}/${id}` : BASE} class="flex flex-col gap-4 max-w-2xl">
        <TemplateFields values={values} defs={defs} inspections={inspections} />
      </form>
    </Layout>,
    opts.status ?? 200
  );
}

inventoryTemplateRoutes.get("/new", configure, (c) => renderForm(c));

inventoryTemplateRoutes.get("/:id", configure, async (c) => {
  const id = c.req.param("id");
  const row = (await db.query.inventoryTemplates.findFirst({ where: eq(inventoryTemplates.id, id), with: { fieldDefs: true, inspections: true } })) as TemplateRow | undefined;
  if (!row) return c.notFound();
  const { defs, inspections } = await loadChoices();
  const free = defs.filter((d) => row.fieldDefs.some((l) => l.fieldDefId === d.id)).map((d) => (d.archived ? `${d.name} ${t("inventory.itemTemplates.archivedSuffix")}` : d.name));
  const checks = inspections.filter((i) => row.inspections.some((l) => l.inspectionTemplateId === i.id)).map((i) => i.name);
  const remove = <DeleteDialog header id={`item-template-${id}`} action={`${BASE}/${id}/delete`} title={t("inventory.itemTemplates.deleteTitle")} body={t("inventory.itemTemplates.deleteConfirm")} />;
  return c.html(
    <Layout title={row.name} user={c.get("user")!}>
      <PageHeader title={row.name} backHref={BASE} actions={<DetailActions editHref={`${BASE}/${id}/edit`} remove={remove} />} />
      <ViewGrid>
        <ViewField label={t("inventory.itemTemplates.name")} value={row.name} />
        <ViewField label={t("inventory.itemTemplates.description")} value={row.description} />
        <ViewField label={t("inventory.form.fields")} value={(row.enabledFields as InventoryField[]).map((f) => t(`inventory.field.${f}`)).join(", ")} />
        <ViewField label={t("inventory.form.freeFields")} value={free.join(", ")} />
        <ViewField label={t("inventory.itemTemplates.inspections")} value={checks.join(", ")} />
      </ViewGrid>
    </Layout>
  );
});

inventoryTemplateRoutes.get("/:id/edit", configure, (c) => renderForm(c, { id: c.req.param("id") }));

// Name prüfen, nur bekannte feste Felder übernehmen; liefert Werte oder eine Fehlermeldung.
function parse(body: Record<string, any>) {
  const values: Values = {
    name: trimmed(body, "name"),
    description: trimmed(body, "description"),
    enabledFields: parseList(body, "enabledFields").filter((f): f is InventoryField => (INVENTORY_FIELDS as readonly string[]).includes(f)),
    freeFields: parseList(body, "freeFields"),
    inspections: parseList(body, "inspections"),
  };
  const error = !values.name ? t("inventory.templates.error.name")
    : values.name.length > INSPECTION_NAME_MAX ? t("inventory.templates.error.nameLength")
    : values.description.length > TEMPLATE_DESCRIPTION_MAX ? t("inventory.itemTemplates.error.descriptionLength")
    : undefined;
  return { values, error };
}

// Verknüpfungen ersetzen; ids, die es nicht (mehr) gibt, brechen am Fremdschlüssel ab und lassen die Transaktion zurückrollen.
async function save(id: string | undefined, v: Values) {
  const row = { name: v.name, description: v.description || null, enabledFields: v.enabledFields };
  return db.transaction(async (tx) => {
    let tid = id;
    if (tid) await tx.update(inventoryTemplates).set(row).where(eq(inventoryTemplates.id, tid));
    else tid = (await tx.insert(inventoryTemplates).values(row).returning())[0].id;
    await tx.delete(inventoryTemplateFieldDefs).where(eq(inventoryTemplateFieldDefs.templateId, tid));
    if (v.freeFields.length > 0) await tx.insert(inventoryTemplateFieldDefs).values(v.freeFields.map((fieldDefId) => ({ templateId: tid!, fieldDefId })));
    await tx.delete(inventoryTemplateInspections).where(eq(inventoryTemplateInspections.templateId, tid));
    if (v.inspections.length > 0) await tx.insert(inventoryTemplateInspections).values(v.inspections.map((inspectionTemplateId) => ({ templateId: tid!, inspectionTemplateId })));
    return tid;
  });
}

inventoryTemplateRoutes.post("/", configure, async (c) => {
  const { values, error } = parse(await c.req.parseBody({ all: true }));
  if (error) return renderForm(c, { values, error, status: 422 });
  let id: string;
  try {
    id = await save(undefined, values);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return renderForm(c, { values, error: t("inventory.itemTemplates.error.duplicate"), status: 422 });
  }
  setFlash(c, t("inventory.templates.flash.created"), "success");
  return c.redirect(`${BASE}/${id}`);
});

inventoryTemplateRoutes.post("/:id", configure, async (c) => {
  const id = c.req.param("id");
  if (!(await db.query.inventoryTemplates.findFirst({ where: eq(inventoryTemplates.id, id) }))) return c.notFound();
  const { values, error } = parse(await c.req.parseBody({ all: true }));
  if (error) return renderForm(c, { id, values, error, status: 422 });
  try {
    await save(id, values);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return renderForm(c, { id, values, error: t("inventory.itemTemplates.error.duplicate"), status: 422 });
  }
  setFlash(c, t("inventory.templates.flash.saved"), "success");
  return c.redirect(`${BASE}/${id}`);
});

// Hart löschen: an Posten steht eine Kopie, keine Vorlagen-ID.
inventoryTemplateRoutes.post("/:id/delete", configure, async (c) => {
  const id = c.req.param("id");
  if (!(await db.query.inventoryTemplates.findFirst({ where: eq(inventoryTemplates.id, id) }))) return c.notFound();
  await db.delete(inventoryTemplates).where(eq(inventoryTemplates.id, id));
  setFlash(c, t("inventory.templates.flash.deleted"), "success");
  return c.redirect(BASE);
});
