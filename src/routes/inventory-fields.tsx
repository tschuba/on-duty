import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { inventoryFieldDefs, inventoryFieldValues, inventoryTemplateFieldDefs } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { DetailActions, FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { Field, ViewField, ViewGrid } from "../components/field.js";
import { DeleteDialog } from "../components/delete-dialog.js";
import { TemplateLinks } from "../components/template-links.js";
import { setFlash } from "../lib/flash.js";
import { blockedOptionRemovals, fieldActions, parseOptions, type FieldDefType } from "../lib/inventory.js";
import { t } from "../i18n/index.js";

export const inventoryFieldRoutes = new Hono<{ Variables: Variables }>();
const configure = requireAuth("inventory:configure"); // ein Recht für alles: kein Leserecht, daher kein Redirect /:id/edit → /:id
const BASE = "/inventory/fields";

const TYPES: FieldDefType[] = ["text", "number", "date", "boolean", "select"];
const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "");

type Def = typeof inventoryFieldDefs.$inferSelect;
type Values = { name: string; type: string; options: string };

// ponytail: kein Pager, bei > ca. 50 Zeilen nachrüsten.
inventoryFieldRoutes.get("/", configure, async (c) => {
  const defs = (await db.query.inventoryFieldDefs.findMany({ with: { values: true }, orderBy: (d: any, { asc }: any) => [asc(d.name)] })) as (Def & { values: { id: string }[] })[];
  return c.html(
    <Layout title={t("inventory.fields.title")} user={c.get("user")!}>
      <PageHeader title={t("inventory.fields.title")} backHref="/inventory" subtitle={t("inventory.fields.hint")} actions={<HeaderAction variant="primary" icon="plus" label={t("inventory.fields.new")} href={`${BASE}/new`} class="btn-primary" />} />
      <div class="overflow-x-auto max-w-3xl">
        <table class="table table-zebra w-full">
          <thead>
            <tr>
              <th>{t("inventory.fields.name")}</th>
              <th>{t("inventory.fields.type")}</th>
              <th>{t("inventory.fields.usageLabel")}</th>
              <th>{t("inventory.fields.status")}</th>
            </tr>
          </thead>
          <tbody>
            {defs.length === 0 && <tr><td colspan={4} class="text-center opacity-50 py-8">{t("inventory.fields.empty")}</td></tr>}
            {defs.map((d) => (
              <tr class="cursor-pointer hover" onclick={`location.href='${BASE}/${d.id}'`}>
                <td class="font-medium">{d.name}</td>
                <td><span class="badge badge-sm badge-ghost">{t(`inventory.fields.type.${d.type}`)}</span></td>
                <td>{t("inventory.fields.usage", { count: d.values.length })}</td>
                <td>{d.archived && <span class="badge badge-sm badge-neutral">{t("inventory.fields.archived")}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
});

// Neu: Typ und Auswahlwerte wählbar; Bearbeiten: der Typ bleibt fix.
async function renderForm(c: any, opts: { id?: string; values?: Values; error?: string; status?: 200 | 422 } = {}) {
  const { id } = opts;
  let values = opts.values;
  if (id && !values) {
    const def = (await db.query.inventoryFieldDefs.findFirst({ where: eq(inventoryFieldDefs.id, id) })) as Def | undefined;
    if (!def) return c.notFound();
    values = { name: def.name, type: def.type, options: (def.options ?? []).join("\n") };
  }
  const type = values?.type ?? "text";
  const title = t(id ? "inventory.fields.edit" : "inventory.fields.new");
  return c.html(
    <Layout title={title} user={c.get("user")!}>
      <PageHeader title={title} backHref={id ? `${BASE}/${id}` : BASE} actions={<FormActions formId="field-form" cancelHref={id ? `${BASE}/${id}` : BASE} />} />
      {opts.error && <div class="alert alert-error max-w-2xl mb-4" role="alert">{opts.error}</div>}
      <form id="field-form" method="post" action={id ? `${BASE}/${id}` : BASE} class="flex flex-col gap-4 max-w-2xl">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t("inventory.fields.name")} required>
            <input type="text" name="name" required value={values?.name ?? ""} class="input w-full" placeholder={t("inventory.fields.name")} />
          </Field>
          {!id && (
            <Field label={t("inventory.fields.type")} required>
              <select name="type" class="select w-full">
                {TYPES.map((ty) => <option value={ty} selected={ty === type}>{t(`inventory.fields.type.${ty}`)}</option>)}
              </select>
            </Field>
          )}
        </div>
        {(!id || type === "select") && (
          <Field label={t("inventory.fields.options")} hint={t("inventory.fields.optionsHint")}>
            <textarea name="options" rows={4} class="textarea w-full" placeholder={t("inventory.fields.options")}>{values?.options ?? ""}</textarea>
          </Field>
        )}
      </form>
    </Layout>,
    opts.status ?? 200
  );
}

async function renderDetail(c: any, id: string, opts: { error?: string; status?: 200 | 422 } = {}) {
  const def = (await db.query.inventoryFieldDefs.findFirst({ where: eq(inventoryFieldDefs.id, id), with: { values: true } })) as (Def & { values: { id: string }[] }) | undefined;
  if (!def) return c.notFound();
  const links = (await db.query.inventoryTemplateFieldDefs.findMany({ where: eq(inventoryTemplateFieldDefs.fieldDefId, id), with: { template: true } })) as { template: { id: string; name: string } }[];
  const used = links.map((l) => l.template).sort((a, b) => a.name.localeCompare(b.name, "de"));
  const actions = fieldActions({ archived: def.archived, usage: def.values.length });
  const remove = (
    <>
      {actions.includes("archive") && <HeaderAction icon="archive-box" label={t("inventory.fields.archive")} form="field-archive-form" class="btn-outline" />}
      {actions.includes("unarchive") && <HeaderAction icon="arrow-uturn-left" label={t("inventory.fields.unarchive")} form="field-archive-form" class="btn-outline" />}
      {actions.includes("delete") && <DeleteDialog header id={`field-${id}`} action={`${BASE}/${id}/delete`} title={t("inventory.fields.deleteTitle")} body={t("inventory.fields.deleteConfirm")} />}
    </>
  );
  return c.html(
    <Layout title={def.name} user={c.get("user")!}>
      <PageHeader title={def.name} backHref={BASE} actions={<DetailActions editHref={`${BASE}/${id}/edit`} remove={remove} />} />
      {opts.error && <div class="alert alert-error max-w-2xl mb-4" role="alert">{opts.error}</div>}
      <form id="field-archive-form" method="post" action={`${BASE}/${id}/archive`} />
      <ViewGrid>
        <ViewField label={t("inventory.fields.name")} value={def.name} />
        <ViewField label={t("inventory.fields.type")} value={t(`inventory.fields.type.${def.type}`)} />
        {def.type === "select" && <ViewField label={t("inventory.fields.options")} value={(def.options ?? []).join(", ")} />}
        <ViewField label={t("inventory.fields.usageLabel")} value={t("inventory.fields.usage", { count: def.values.length })} />
        <ViewField label={t("inventory.fields.status")} value={def.archived ? t("inventory.fields.archived") : t("inventory.fields.active")} />
        <ViewField label={t("inventory.fields.usedIn")} value={<TemplateLinks templates={used} />} />
      </ViewGrid>
    </Layout>,
    opts.status ?? 200
  );
}

inventoryFieldRoutes.get("/new", configure, (c) => renderForm(c));
inventoryFieldRoutes.get("/:id", configure, (c) => renderDetail(c, c.req.param("id")));
inventoryFieldRoutes.get("/:id/edit", configure, (c) => renderForm(c, { id: c.req.param("id") }));

const formValues = (body: Record<string, unknown>, type?: string): Values => ({ name: trimmed(body.name), type: type ?? trimmed(body.type), options: typeof body.options === "string" ? body.options : "" });

inventoryFieldRoutes.post("/", configure, async (c) => {
  const body = await c.req.parseBody();
  const values = formValues(body);
  const type = values.type as FieldDefType;
  if (!values.name || !TYPES.includes(type)) return renderForm(c, { values, error: t("inventory.fields.invalid"), status: 422 });
  const options = type === "select" ? parseOptions(trimmed(body.options)) : null;
  if (type === "select" && options!.length === 0) return renderForm(c, { values, error: t("inventory.fields.optionsRequired"), status: 422 });
  const [{ id }] = await db.insert(inventoryFieldDefs).values({ name: values.name, type, options }).returning();
  setFlash(c, t("inventory.fields.flash.created"), "success");
  return c.redirect(`${BASE}/${id}`);
});

// Umbenennen und Auswahlwerte pflegen; der Typ bleibt fix, verwendete Auswahlwerte lassen sich nicht entfernen.
inventoryFieldRoutes.post("/:id", configure, async (c) => {
  const id = c.req.param("id");
  const def = await db.query.inventoryFieldDefs.findFirst({ where: eq(inventoryFieldDefs.id, id) });
  if (!def) return c.notFound();
  const body = await c.req.parseBody();
  const values = formValues(body, def.type);
  if (!values.name) return renderForm(c, { id, values, error: t("inventory.fields.invalid"), status: 422 });
  const set: Partial<Def> = { name: values.name };
  if (def.type === "select") {
    const options = parseOptions(trimmed(body.options));
    if (options.length === 0) return renderForm(c, { id, values, error: t("inventory.fields.optionsRequired"), status: 422 });
    const used = await db.select({ value: inventoryFieldValues.value }).from(inventoryFieldValues).where(eq(inventoryFieldValues.fieldDefId, id));
    const blocked = blockedOptionRemovals(def.options ?? [], options, used.map((u: { value: string | null }) => u.value));
    if (blocked.length > 0) return renderForm(c, { id, values, error: t("inventory.fields.optionInUse", { options: blocked.join(", ") }), status: 422 });
    set.options = options;
  }
  await db.update(inventoryFieldDefs).set(set).where(eq(inventoryFieldDefs.id, id));
  setFlash(c, t("inventory.fields.flash.saved"), "success");
  return c.redirect(`${BASE}/${id}`);
});

inventoryFieldRoutes.post("/:id/archive", configure, async (c) => {
  const id = c.req.param("id");
  const def = await db.query.inventoryFieldDefs.findFirst({ where: eq(inventoryFieldDefs.id, id) });
  if (!def) return c.notFound();
  await db.update(inventoryFieldDefs).set({ archived: !def.archived }).where(eq(inventoryFieldDefs.id, id));
  setFlash(c, t("inventory.fields.flash.saved"), "success");
  return c.redirect(`${BASE}/${id}`);
});

// Löschen nur ohne Werte (FK restrict wäre die zweite Sperre); sonst archivieren.
inventoryFieldRoutes.post("/:id/delete", configure, async (c) => {
  const id = c.req.param("id");
  const def = await db.query.inventoryFieldDefs.findFirst({ where: eq(inventoryFieldDefs.id, id), with: { values: true } });
  if (!def) return c.notFound();
  const count = (def as any).values.length as number;
  if (count > 0) return renderDetail(c, id, { error: t("inventory.fields.deleteBlocked", { count }), status: 422 });
  await db.delete(inventoryFieldDefs).where(eq(inventoryFieldDefs.id, id));
  setFlash(c, t("inventory.fields.flash.deleted"), "success");
  return c.redirect(BASE);
});
