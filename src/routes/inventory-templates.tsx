import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { inventoryTemplates, inventoryTemplateFieldDefs, inventoryTemplateInspections } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { PageHeader } from "../components/page-header.js";
import { Field } from "../components/field.js";
import { setFlash } from "../lib/flash.js";
import { INSPECTION_NAME_MAX, INVENTORY_FIELDS, isUniqueViolation, type InventoryField } from "../lib/inventory.js";
import { trimmed, parseList } from "../lib/forms.js";
import { t } from "../i18n/index.js";

export const inventoryTemplateRoutes = new Hono<{ Variables: Variables }>();
const configure = requireAuth("inventory:configure");

type FieldDef = { id: string; name: string; archived: boolean };
type InspectionTemplate = { id: string; name: string };
type TemplateRow = typeof inventoryTemplates.$inferSelect & { fieldDefs: { fieldDefId: string }[]; inspections: { inspectionTemplateId: string }[] };

function TemplateFields({ tpl, defs, inspections }: { tpl?: TemplateRow; defs: FieldDef[]; inspections: InspectionTemplate[] }) {
  const fixed = new Set(tpl?.enabledFields ?? []);
  const chosenDefs = new Set(tpl?.fieldDefs.map((d) => d.fieldDefId));
  const chosenInspections = new Set(tpl?.inspections.map((i) => i.inspectionTemplateId));
  return (
    <>
      <Field label={t("inventory.itemTemplates.name")} required>
        <input type="text" name="name" required maxlength={INSPECTION_NAME_MAX} value={tpl?.name ?? ""} class="input w-full" placeholder={t("inventory.itemTemplates.name")} />
      </Field>
      <fieldset>
        <legend class="fieldset-legend">{t("inventory.form.fields")}</legend>
        <div class="flex flex-wrap gap-x-4 gap-y-2">
          {INVENTORY_FIELDS.map((f) => (
            <label class="label cursor-pointer justify-start gap-2 w-fit">
              <input type="checkbox" name="enabledFields" value={f} checked={fixed.has(f)} class="checkbox" />
              <span class="text-sm">{t(`inventory.field.${f}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend class="fieldset-legend">{t("inventory.form.freeFields")}</legend>
        <div class="flex flex-wrap gap-x-4 gap-y-2">
          {defs.length === 0 && <span class="text-sm opacity-60">{t("inventory.itemTemplates.noFreeFields")}</span>}
          {defs.map((d) => (
            <label class="label cursor-pointer justify-start gap-2 w-fit">
              <input type="checkbox" name="freeFields" value={d.id} checked={chosenDefs.has(d.id)} class="checkbox" />
              <span class="text-sm">{d.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend class="fieldset-legend">{t("inventory.itemTemplates.inspections")}</legend>
        <div class="flex flex-wrap gap-x-4 gap-y-2">
          {inspections.length === 0 && <span class="text-sm opacity-60">{t("inventory.itemTemplates.noInspections")}</span>}
          {inspections.map((i) => (
            <label class="label cursor-pointer justify-start gap-2 w-fit">
              <input type="checkbox" name="inspections" value={i.id} checked={chosenInspections.has(i.id)} class="checkbox" />
              <span class="text-sm">{i.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}

async function renderPage(c: any, opts: { error?: string; status?: 200 | 422 } = {}) {
  const user = c.get("user")!;
  const rows = (await db.query.inventoryTemplates.findMany({ with: { fieldDefs: true, inspections: true } })) as TemplateRow[];
  rows.sort((a, b) => a.name.localeCompare(b.name, "de"));
  const defs = ((await db.query.inventoryFieldDefs.findMany({ orderBy: (d: any, { asc }: any) => [asc(d.name)] })) as FieldDef[]).filter((d) => !d.archived);
  const inspections = ((await db.query.inventoryInspectionTemplates.findMany()) as InspectionTemplate[]).sort((a, b) => a.name.localeCompare(b.name, "de"));
  return c.html(
    <Layout title={t("inventory.itemTemplates.title")} user={user}>
      <PageHeader title={t("inventory.itemTemplates.title")} backHref="/inventory" subtitle={t("inventory.itemTemplates.hint")} />
      {opts.error && <div class="alert alert-error max-w-3xl mb-4">{opts.error}</div>}
      <form method="post" action="/inventory/templates" class="card card-border bg-base-100 border-base-300 max-w-3xl mb-6">
        <div class="card-body gap-4 p-4">
          <h2 class="font-semibold">{t("inventory.itemTemplates.new")}</h2>
          <TemplateFields defs={defs} inspections={inspections} />
          <div><button type="submit" class="btn btn-primary">{t("common.create")}</button></div>
        </div>
      </form>

      <div class="space-y-3 max-w-3xl">
        {rows.length === 0 && <p class="opacity-60">{t("inventory.itemTemplates.empty")}</p>}
        {rows.map((r) => (
          <div class="card card-border bg-base-100 border-base-300">
            <form method="post" action={`/inventory/templates/${r.id}`} class="card-body gap-3 p-4">
              <TemplateFields tpl={r} defs={defs} inspections={inspections} />
              <div class="flex flex-wrap gap-2">
                <button type="submit" class="btn btn-primary">{t("common.save")}</button>
                <button type="submit" formaction={`/inventory/templates/${r.id}/delete`} class="btn btn-outline btn-error" onclick={`return confirm(${JSON.stringify(t("inventory.itemTemplates.deleteConfirm"))})`}>{t("common.delete")}</button>
              </div>
            </form>
          </div>
        ))}
      </div>
    </Layout>,
    opts.status ?? 200
  );
}

// Name prüfen, nur bekannte feste Felder übernehmen; liefert Werte oder eine Fehlermeldung.
function parse(body: Record<string, any>) {
  const name = trimmed(body, "name");
  const enabledFields = parseList(body, "enabledFields").filter((f): f is InventoryField => (INVENTORY_FIELDS as readonly string[]).includes(f));
  const error = !name ? t("inventory.templates.error.name") : name.length > INSPECTION_NAME_MAX ? t("inventory.templates.error.nameLength") : undefined;
  return { name, enabledFields, fieldDefIds: parseList(body, "freeFields"), inspectionIds: parseList(body, "inspections"), error };
}

// Verknüpfungen ersetzen; ids, die es nicht (mehr) gibt, brechen am Fremdschlüssel ab und lassen die Transaktion zurückrollen.
async function save(id: string | undefined, p: ReturnType<typeof parse>) {
  return db.transaction(async (tx) => {
    let tid = id;
    if (tid) await tx.update(inventoryTemplates).set({ name: p.name, enabledFields: p.enabledFields }).where(eq(inventoryTemplates.id, tid));
    else tid = (await tx.insert(inventoryTemplates).values({ name: p.name, enabledFields: p.enabledFields }).returning())[0].id;
    await tx.delete(inventoryTemplateFieldDefs).where(eq(inventoryTemplateFieldDefs.templateId, tid));
    if (p.fieldDefIds.length > 0) await tx.insert(inventoryTemplateFieldDefs).values(p.fieldDefIds.map((fieldDefId) => ({ templateId: tid!, fieldDefId })));
    await tx.delete(inventoryTemplateInspections).where(eq(inventoryTemplateInspections.templateId, tid));
    if (p.inspectionIds.length > 0) await tx.insert(inventoryTemplateInspections).values(p.inspectionIds.map((inspectionTemplateId) => ({ templateId: tid!, inspectionTemplateId })));
  });
}

inventoryTemplateRoutes.get("/", configure, (c) => renderPage(c));

inventoryTemplateRoutes.post("/", configure, async (c) => {
  const p = parse(await c.req.parseBody({ all: true }));
  if (p.error) return renderPage(c, { error: p.error, status: 422 });
  try {
    await save(undefined, p);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return renderPage(c, { error: t("inventory.itemTemplates.error.duplicate"), status: 422 });
  }
  setFlash(c, t("inventory.templates.flash.created"), "success");
  return c.redirect("/inventory/templates");
});

inventoryTemplateRoutes.post("/:id", configure, async (c) => {
  const id = c.req.param("id");
  if (!(await db.query.inventoryTemplates.findFirst({ where: eq(inventoryTemplates.id, id) }))) return c.notFound();
  const p = parse(await c.req.parseBody({ all: true }));
  if (p.error) return renderPage(c, { error: p.error, status: 422 });
  try {
    await save(id, p);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return renderPage(c, { error: t("inventory.itemTemplates.error.duplicate"), status: 422 });
  }
  setFlash(c, t("inventory.templates.flash.saved"), "success");
  return c.redirect("/inventory/templates");
});

// Hart löschen: an Posten steht eine Kopie, keine Vorlagen-ID.
inventoryTemplateRoutes.post("/:id/delete", configure, async (c) => {
  const id = c.req.param("id");
  if (!(await db.query.inventoryTemplates.findFirst({ where: eq(inventoryTemplates.id, id) }))) return c.notFound();
  await db.delete(inventoryTemplates).where(eq(inventoryTemplates.id, id));
  setFlash(c, t("inventory.templates.flash.deleted"), "success");
  return c.redirect("/inventory/templates");
});
