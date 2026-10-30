import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { inventoryFieldDefs, inventoryFieldValues } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { PageHeader } from "../components/page-header.js";
import { Field } from "../components/field.js";
import { setFlash } from "../lib/flash.js";
import { blockedOptionRemovals, parseOptions, type FieldDefType } from "../lib/inventory.js";
import { t } from "../i18n/index.js";

export const inventoryFieldRoutes = new Hono<{ Variables: Variables }>();
const configure = requireAuth("inventory:configure");

const TYPES: FieldDefType[] = ["text", "number", "date", "boolean", "select"];
const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "");

type Def = typeof inventoryFieldDefs.$inferSelect;

async function renderPage(c: any, opts: { error?: string; status?: 200 | 422 } = {}) {
  const user = c.get("user")!;
  const defs = (await db.query.inventoryFieldDefs.findMany({ with: { values: true }, orderBy: (d: any, { asc }: any) => [asc(d.name)] })) as (Def & { values: { id: string }[] })[];
  return c.html(
    <Layout title={t("inventory.fields.title")} user={user}>
      <PageHeader title={t("inventory.fields.title")} backHref="/inventory" subtitle={t("inventory.fields.hint")} />
      {opts.error && <div class="alert alert-error max-w-3xl mb-4">{opts.error}</div>}
      <form method="post" action="/inventory/fields" class="card card-border bg-base-100 border-base-300 max-w-3xl mb-6">
        <div class="card-body gap-4 p-4">
          <h2 class="font-semibold">{t("inventory.fields.new")}</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t("inventory.fields.name")} required>
              <input type="text" name="name" required class="input w-full" placeholder={t("inventory.fields.name")} />
            </Field>
            <Field label={t("inventory.fields.type")} required>
              <select name="type" class="select w-full">
                {TYPES.map((ty) => <option value={ty}>{t(`inventory.fields.type.${ty}`)}</option>)}
              </select>
            </Field>
          </div>
          <Field label={t("inventory.fields.options")} hint={t("inventory.fields.optionsHint")}>
            <textarea name="options" rows={3} class="textarea w-full" placeholder={t("inventory.fields.options")}></textarea>
          </Field>
          <div><button type="submit" class="btn btn-primary">{t("common.create")}</button></div>
        </div>
      </form>

      <div class="space-y-3 max-w-3xl">
        {defs.length === 0 && <p class="opacity-60">{t("inventory.fields.empty")}</p>}
        {defs.map((d) => (
          <div class={`card card-border bg-base-100 border-base-300${d.archived ? " opacity-70" : ""}`}>
            <div class="card-body gap-3 p-4">
              <form method="post" action={`/inventory/fields/${d.id}`} class="space-y-3">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="badge badge-outline">{t(`inventory.fields.type.${d.type}`)}</span>
                  {d.archived && <span class="badge badge-neutral">{t("inventory.fields.archived")}</span>}
                  <span class="text-sm opacity-60">{t("inventory.fields.usage", { count: d.values.length })}</span>
                </div>
                <Field label={t("inventory.fields.name")} required>
                  <input type="text" name="name" required value={d.name} class="input w-full" />
                </Field>
                {d.type === "select" && (
                  <Field label={t("inventory.fields.options")} hint={t("inventory.fields.optionsHint")}>
                    <textarea name="options" rows={4} class="textarea w-full">{(d.options ?? []).join("\n")}</textarea>
                  </Field>
                )}
                <div class="flex flex-wrap gap-2">
                  <button type="submit" class="btn btn-primary">{t("common.save")}</button>
                  <button type="submit" formaction={`/inventory/fields/${d.id}/archive`} class="btn btn-ghost">{t(d.archived ? "inventory.fields.unarchive" : "inventory.fields.archive")}</button>
                  <button type="submit" formaction={`/inventory/fields/${d.id}/delete`} class="btn btn-outline btn-error" onclick={`return confirm(${JSON.stringify(t("inventory.fields.deleteConfirm"))})`}>{t("common.delete")}</button>
                </div>
              </form>
            </div>
          </div>
        ))}
      </div>
    </Layout>,
    opts.status ?? 200
  );
}

inventoryFieldRoutes.get("/", configure, (c) => renderPage(c));

inventoryFieldRoutes.post("/", configure, async (c) => {
  const body = await c.req.parseBody();
  const name = trimmed(body.name);
  const type = trimmed(body.type) as FieldDefType;
  if (!name || !TYPES.includes(type)) return renderPage(c, { error: t("inventory.fields.invalid"), status: 422 });
  const options = type === "select" ? parseOptions(trimmed(body.options)) : null;
  if (type === "select" && options!.length === 0) return renderPage(c, { error: t("inventory.fields.optionsRequired"), status: 422 });
  await db.insert(inventoryFieldDefs).values({ name, type, options });
  setFlash(c, t("inventory.fields.flash.created"), "success");
  return c.redirect("/inventory/fields");
});

// Umbenennen und Auswahlwerte pflegen; der Typ bleibt fix, verwendete Auswahlwerte lassen sich nicht entfernen.
inventoryFieldRoutes.post("/:id", configure, async (c) => {
  const id = c.req.param("id");
  const def = await db.query.inventoryFieldDefs.findFirst({ where: eq(inventoryFieldDefs.id, id) });
  if (!def) return c.notFound();
  const body = await c.req.parseBody();
  const name = trimmed(body.name);
  if (!name) return renderPage(c, { error: t("inventory.fields.invalid"), status: 422 });
  const set: Partial<Def> = { name };
  if (def.type === "select") {
    const options = parseOptions(trimmed(body.options));
    if (options.length === 0) return renderPage(c, { error: t("inventory.fields.optionsRequired"), status: 422 });
    const used = await db.select({ value: inventoryFieldValues.value }).from(inventoryFieldValues).where(eq(inventoryFieldValues.fieldDefId, id));
    const blocked = blockedOptionRemovals(def.options ?? [], options, used.map((u: { value: string | null }) => u.value));
    if (blocked.length > 0) return renderPage(c, { error: t("inventory.fields.optionInUse", { options: blocked.join(", ") }), status: 422 });
    set.options = options;
  }
  await db.update(inventoryFieldDefs).set(set).where(eq(inventoryFieldDefs.id, id));
  setFlash(c, t("inventory.fields.flash.saved"), "success");
  return c.redirect("/inventory/fields");
});

inventoryFieldRoutes.post("/:id/archive", configure, async (c) => {
  const id = c.req.param("id");
  const def = await db.query.inventoryFieldDefs.findFirst({ where: eq(inventoryFieldDefs.id, id) });
  if (!def) return c.notFound();
  await db.update(inventoryFieldDefs).set({ archived: !def.archived }).where(eq(inventoryFieldDefs.id, id));
  setFlash(c, t("inventory.fields.flash.saved"), "success");
  return c.redirect("/inventory/fields");
});

// Löschen nur ohne Werte (FK restrict wäre die zweite Sperre); sonst archivieren.
inventoryFieldRoutes.post("/:id/delete", configure, async (c) => {
  const id = c.req.param("id");
  const def = await db.query.inventoryFieldDefs.findFirst({ where: eq(inventoryFieldDefs.id, id), with: { values: true } });
  if (!def) return c.notFound();
  const count = (def as any).values.length as number;
  if (count > 0) return renderPage(c, { error: t("inventory.fields.deleteBlocked", { count }), status: 422 });
  await db.delete(inventoryFieldDefs).where(eq(inventoryFieldDefs.id, id));
  setFlash(c, t("inventory.fields.flash.deleted"), "success");
  return c.redirect("/inventory/fields");
});
