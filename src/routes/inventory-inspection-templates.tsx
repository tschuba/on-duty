import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { inventoryInspectionTemplates } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { PageHeader } from "../components/page-header.js";
import { Field } from "../components/field.js";
import { setFlash } from "../lib/flash.js";
import { INSPECTION_NAME_MAX, isUniqueViolation, validateTemplate } from "../lib/inventory.js";
import { trimmed } from "../lib/forms.js";
import { t } from "../i18n/index.js";

export const inventoryInspectionTemplateRoutes = new Hono<{ Variables: Variables }>();
const configure = requireAuth("inventory:configure");

type Template = typeof inventoryInspectionTemplates.$inferSelect;

async function renderPage(c: any, opts: { error?: string; status?: 200 | 422 } = {}) {
  const user = c.get("user")!;
  const rows = (await db.query.inventoryInspectionTemplates.findMany()) as Template[];
  rows.sort((a, b) => a.name.localeCompare(b.name, "de"));
  return c.html(
    <Layout title={t("inventory.templates.title")} user={user}>
      <PageHeader title={t("inventory.templates.title")} backHref="/inventory" subtitle={t("inventory.templates.hint")} />
      {opts.error && <div class="alert alert-error max-w-3xl mb-4">{opts.error}</div>}
      <form method="post" action="/inventory/inspection-templates" class="card card-border bg-base-100 border-base-300 max-w-3xl mb-6">
        <div class="card-body gap-4 p-4">
          <h2 class="font-semibold">{t("inventory.templates.new")}</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t("inventory.form.inspectionName")} required>
              <input type="text" name="name" required maxlength={INSPECTION_NAME_MAX} class="input w-full" placeholder={t("inventory.form.inspectionName")} />
            </Field>
            <Field label={t("inventory.templates.interval")}>
              <input type="number" name="interval" min="1" max="120" class="input w-full" placeholder={t("inventory.templates.interval")} />
            </Field>
          </div>
          <div><button type="submit" class="btn btn-primary">{t("common.create")}</button></div>
        </div>
      </form>

      <div class="space-y-3 max-w-3xl">
        {rows.length === 0 && <p class="opacity-60">{t("inventory.templates.empty")}</p>}
        {rows.map((r) => (
          <div class="card card-border bg-base-100 border-base-300">
            <form method="post" action={`/inventory/inspection-templates/${r.id}`} class="card-body gap-3 p-4">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label={t("inventory.form.inspectionName")} required>
                  <input type="text" name="name" required maxlength={INSPECTION_NAME_MAX} value={r.name} class="input w-full" />
                </Field>
                <Field label={t("inventory.templates.interval")}>
                  <input type="number" name="interval" min="1" max="120" value={r.defaultIntervalMonths ?? ""} class="input w-full" placeholder={t("inventory.templates.interval")} />
                </Field>
              </div>
              <div class="flex flex-wrap gap-2">
                <button type="submit" class="btn btn-primary">{t("common.save")}</button>
                <button type="submit" formaction={`/inventory/inspection-templates/${r.id}/delete`} class="btn btn-outline btn-error" onclick={`return confirm(${JSON.stringify(t("inventory.templates.deleteConfirm"))})`}>{t("common.delete")}</button>
              </div>
            </form>
          </div>
        ))}
      </div>
    </Layout>,
    opts.status ?? 200
  );
}

// Name+Intervall prüfen; liefert Werte oder eine fertige Fehlerseite.
function parse(body: Record<string, any>) {
  const name = trimmed(body, "name");
  const { error, intervalMonths } = validateTemplate(name, trimmed(body, "interval"));
  return { name, intervalMonths, error: error && t(`inventory.templates.error.${error}`) };
}

inventoryInspectionTemplateRoutes.get("/", configure, (c) => renderPage(c));

inventoryInspectionTemplateRoutes.post("/", configure, async (c) => {
  const { name, intervalMonths, error } = parse(await c.req.parseBody());
  if (error) return renderPage(c, { error, status: 422 });
  try {
    await db.insert(inventoryInspectionTemplates).values({ name, defaultIntervalMonths: intervalMonths });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return renderPage(c, { error: t("inventory.templates.error.duplicate"), status: 422 });
  }
  setFlash(c, t("inventory.templates.flash.created"), "success");
  return c.redirect("/inventory/inspection-templates");
});

inventoryInspectionTemplateRoutes.post("/:id", configure, async (c) => {
  const id = c.req.param("id");
  if (!(await db.query.inventoryInspectionTemplates.findFirst({ where: eq(inventoryInspectionTemplates.id, id) }))) return c.notFound();
  const { name, intervalMonths, error } = parse(await c.req.parseBody());
  if (error) return renderPage(c, { error, status: 422 });
  try {
    await db.update(inventoryInspectionTemplates).set({ name, defaultIntervalMonths: intervalMonths }).where(eq(inventoryInspectionTemplates.id, id));
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return renderPage(c, { error: t("inventory.templates.error.duplicate"), status: 422 });
  }
  setFlash(c, t("inventory.templates.flash.saved"), "success");
  return c.redirect("/inventory/inspection-templates");
});

// Hart löschen: Vorlagen sind nur Vorschläge, an Posten steht eine Kopie.
inventoryInspectionTemplateRoutes.post("/:id/delete", configure, async (c) => {
  const id = c.req.param("id");
  if (!(await db.query.inventoryInspectionTemplates.findFirst({ where: eq(inventoryInspectionTemplates.id, id) }))) return c.notFound();
  await db.delete(inventoryInspectionTemplates).where(eq(inventoryInspectionTemplates.id, id));
  setFlash(c, t("inventory.templates.flash.deleted"), "success");
  return c.redirect("/inventory/inspection-templates");
});
