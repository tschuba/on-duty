import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { inventoryInspectionTemplates, inventoryTemplateInspections } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { PageSearch } from "../components/page-search.js";
import { TitleSwitch } from "../components/title-switch.js";
import { Layout } from "../components/layout.js";
import { DetailActions, FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { Field, ViewField, ViewGrid } from "../components/field.js";
import { DeleteDialog } from "../components/delete-dialog.js";
import { TemplateLinks } from "../components/template-links.js";
import { setFlash } from "../lib/flash.js";
import { INSPECTION_NAME_MAX, isUniqueViolation, validateTemplate } from "../lib/inventory.js";
import { trimmed } from "../lib/forms.js";
import { t } from "../i18n/index.js";

export const inventoryInspectionTemplateRoutes = new Hono<{ Variables: Variables }>();
const configure = requireAuth("inventory:configure"); // ein Recht für alles: kein Leserecht, daher kein Redirect /:id/edit → /:id
const BASE = "/inventory/inspection-templates";

type Template = typeof inventoryInspectionTemplates.$inferSelect;
type Values = { name: string; interval: string };

const intervalText = (months: number | null) => (months == null ? "" : String(months));

async function usedIn(id: string) {
  const links = (await db.query.inventoryTemplateInspections.findMany({ where: eq(inventoryTemplateInspections.inspectionTemplateId, id), with: { template: true } })) as { template: { id: string; name: string } }[];
  return links.map((l) => l.template).sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export const LIST = "/inventory/inspections?view=templates";

// Titel-Umschalter Prüfungen | Prüfartvorlagen (nur mit inventory:configure, sonst schlichter Titel).
export function inspectionTitle(active: "inspections" | "templates", canConfigure: boolean) {
  if (!canConfigure) return t("inventory.inspections.title");
  return <TitleSwitch items={[
    { active: active === "inspections", href: "/inventory/inspections", label: t("inventory.inspections.title") },
    { active: active === "templates", href: LIST, label: t("inventory.tabs.inspectionTemplates") },
  ]} />;
}

// ponytail: kein Pager, bei > ca. 50 Zeilen nachrüsten.
export async function renderTemplateList(c: any) {
  const search = (c.req.query("search") ?? "").trim();
  const needle = search.toLowerCase();
  const rows = ((await db.query.inventoryInspectionTemplates.findMany()) as Template[]).filter((r) => r.name.toLowerCase().includes(needle));
  rows.sort((a, b) => a.name.localeCompare(b.name, "de"));
  return c.html(
    <Layout title={`${t("inventory.tabs.inspectionTemplates")} · ${t("inventory.inspections.title")}`} user={c.get("user")!}>
      <PageHeader title={inspectionTitle("templates", true)} actions={<HeaderAction variant="primary" icon="icon-[tabler--plus]" label={t("inventory.templates.new")} href={`${BASE}/new`} class="btn-primary" />} />
      <p class="text-sm opacity-70 max-w-3xl mb-4">{t("inventory.templates.hint")}</p>
      <PageSearch action="/inventory/inspections" label={t("inventory.tabs.inspectionTemplates")} value={search} hidden={[["view", "templates"]]} />
      <div class="overflow-x-auto max-w-3xl">
        <table class="table table-zebra table-cards w-full">
          <thead>
            <tr>
              <th>{t("inventory.form.inspectionName")}</th>
              <th>{t("inventory.templates.interval")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colspan={2} class="text-center opacity-50 py-8">{t("inventory.templates.empty")}</td></tr>}
            {rows.map((r) => (
              <tr class="cursor-pointer hover" onclick={`location.href='${BASE}/${r.id}'`}>
                <td class="font-medium">{r.name}</td>
                <td data-label={t("inventory.templates.interval")}>{r.defaultIntervalMonths ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}

inventoryInspectionTemplateRoutes.get("/", configure, (c) => c.redirect(LIST));

async function renderForm(c: any, opts: { id?: string; values?: Values; error?: string; status?: 200 | 422 } = {}) {
  const { id } = opts;
  let values = opts.values;
  if (id && !values) {
    const row = await db.query.inventoryInspectionTemplates.findFirst({ where: eq(inventoryInspectionTemplates.id, id) });
    if (!row) return c.notFound();
    values = { name: row.name, interval: intervalText(row.defaultIntervalMonths) };
  }
  const title = t(id ? "inventory.templates.edit" : "inventory.templates.new");
  return c.html(
    <Layout title={title} user={c.get("user")!}>
      <PageHeader title={title} backHref={LIST} actions={<FormActions formId="inspection-template-form" cancelHref={id ? `${BASE}/${id}` : LIST} />} />
      {opts.error && <div class="alert alert-error max-w-2xl mb-4" role="alert">{opts.error}</div>}
      <form id="inspection-template-form" method="post" action={id ? `${BASE}/${id}` : BASE} class="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
        <Field label={t("inventory.form.inspectionName")} required>
          <input type="text" name="name" required maxlength={INSPECTION_NAME_MAX} value={values?.name ?? ""} class="input w-full" placeholder={t("inventory.form.inspectionName")} />
        </Field>
        <Field label={t("inventory.templates.interval")}>
          <input type="number" name="interval" min="1" max="120" value={values?.interval ?? ""} class="input w-full" placeholder={t("inventory.templates.interval")} />
        </Field>
      </form>
    </Layout>,
    opts.status ?? 200
  );
}

inventoryInspectionTemplateRoutes.get("/new", configure, (c) => renderForm(c));

inventoryInspectionTemplateRoutes.get("/:id", configure, async (c) => {
  const id = c.req.param("id");
  const row = (await db.query.inventoryInspectionTemplates.findFirst({ where: eq(inventoryInspectionTemplates.id, id) })) as Template | undefined;
  if (!row) return c.notFound();
  const used = await usedIn(id);
  const remove = (
    <DeleteDialog header id={`inspection-template-${id}`} action={`${BASE}/${id}/delete`} title={t("inventory.templates.deleteTitle")}
      body={used.length > 0 ? `${t("inventory.templates.deleteConfirm")} ${t("inventory.templates.deleteUsed", { count: used.length })}` : t("inventory.templates.deleteConfirm")} />
  );
  return c.html(
    <Layout title={row.name} user={c.get("user")!}>
      <PageHeader title={row.name} backHref={LIST} actions={<DetailActions editHref={`${BASE}/${id}/edit`} remove={remove} />} />
      <ViewGrid>
        <ViewField label={t("inventory.form.inspectionName")} value={row.name} />
        <ViewField label={t("inventory.templates.interval")} value={row.defaultIntervalMonths} />
        <ViewField label={t("inventory.templates.usedIn")} value={<TemplateLinks templates={used} />} />
      </ViewGrid>
    </Layout>
  );
});

inventoryInspectionTemplateRoutes.get("/:id/edit", configure, (c) => renderForm(c, { id: c.req.param("id") }));

// Name+Intervall prüfen; liefert Werte oder eine Fehlermeldung.
function parse(body: Record<string, any>) {
  const values = { name: trimmed(body, "name"), interval: trimmed(body, "interval") };
  const { error, intervalMonths } = validateTemplate(values.name, values.interval);
  return { values, intervalMonths, error: error && t(`inventory.templates.error.${error}`) };
}

inventoryInspectionTemplateRoutes.post("/", configure, async (c) => {
  const { values, intervalMonths, error } = parse(await c.req.parseBody());
  if (error) return renderForm(c, { values, error, status: 422 });
  let id: string;
  try {
    [{ id }] = await db.insert(inventoryInspectionTemplates).values({ name: values.name, defaultIntervalMonths: intervalMonths }).returning();
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return renderForm(c, { values, error: t("inventory.templates.error.duplicate"), status: 422 });
  }
  setFlash(c, t("inventory.templates.flash.created"), "success");
  return c.redirect(`${BASE}/${id}`);
});

inventoryInspectionTemplateRoutes.post("/:id", configure, async (c) => {
  const id = c.req.param("id");
  if (!(await db.query.inventoryInspectionTemplates.findFirst({ where: eq(inventoryInspectionTemplates.id, id) }))) return c.notFound();
  const { values, intervalMonths, error } = parse(await c.req.parseBody());
  if (error) return renderForm(c, { id, values, error, status: 422 });
  try {
    await db.update(inventoryInspectionTemplates).set({ name: values.name, defaultIntervalMonths: intervalMonths }).where(eq(inventoryInspectionTemplates.id, id));
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return renderForm(c, { id, values, error: t("inventory.templates.error.duplicate"), status: 422 });
  }
  setFlash(c, t("inventory.templates.flash.saved"), "success");
  return c.redirect(`${BASE}/${id}`);
});

// Hart löschen: Vorlagen sind nur Vorschläge, an Posten steht eine Kopie.
inventoryInspectionTemplateRoutes.post("/:id/delete", configure, async (c) => {
  const id = c.req.param("id");
  if (!(await db.query.inventoryInspectionTemplates.findFirst({ where: eq(inventoryInspectionTemplates.id, id) }))) return c.notFound();
  await db.delete(inventoryInspectionTemplates).where(eq(inventoryInspectionTemplates.id, id));
  setFlash(c, t("inventory.templates.flash.deleted"), "success");
  return c.redirect(LIST);
});
