import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { Layout } from "../components/layout.js";
import { FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { HTTP_STATUS } from "../lib/constants.js";
import { setFlash } from "../lib/flash.js";
import { formatDay } from "../lib/datetime.js";
import { env } from "../env.js";
import { CATALOG, customFields, customPreviewVars, customVars, fieldLabel, mayEdit, previewVars, renderMail, validateTemplate, type VarSpec } from "../lib/mail-templates.js";
import { createCustom, deleteCustom, keyTaken, listTemplates, listTopics, resetOverride, saveCustom, saveOverride, type CustomInput, type TemplateView } from "../lib/mail-template-store.js";
import { parseHeaders } from "../lib/mail-headers.js";
import { SLUG_RE } from "../lib/slug.js";
import { PERMISSIONS, type Permission } from "../lib/roles.js";
import { PERMISSION_LABELS } from "../components/permission-badges.js";
import type { CustomMeta } from "../db/schema/mail.js";
import { t } from "../i18n/index.js";
import { Icon } from "../components/icon.js";
import { Field, FieldGroup } from "../components/field.js";

export const mailTemplateRoutes = new Hono<{ Variables: Variables }>();
mailTemplateRoutes.use("*", requireAuth()); // Recht je Vorlage wird im Handler geprüft

const T = (k: string, p?: Record<string, string | number>) => t(k as never, p);
const forbidden = () => { throw new HTTPException(HTTP_STATUS.FORBIDDEN); };
const notFound = () => { throw new HTTPException(HTTP_STATUS.NOT_FOUND); };

async function editable(user: Variables["user"]): Promise<TemplateView[]> {
  // Reihenfolge = Katalog (die DB liefert ohne ORDER BY keine stabile Reihenfolge), freie Vorlagen danach nach Name
  const order = Object.keys(CATALOG);
  const nameOf = (x: TemplateView) => x.custom?.meta.name ?? "";
  return (await listTemplates()).filter((x) => (CATALOG[x.key] || x.custom) && mayEdit(user, x.editPermissions))
    .sort((a, b) => (a.custom ? 1 : 0) - (b.custom ? 1 : 0) || order.indexOf(a.key) - order.indexOf(b.key) || nameOf(a).localeCompare(nameOf(b), "de"));
}
const mayCreate = (user: Variables["user"]) => user.permissions.has("system:admin") || user.permissions.has("mail:templates");
// Rechte, die der Ersteller vergeben darf: nur eigene (system:admin: alle)
const grantable = (user: Variables["user"]): Permission[] => PERMISSIONS.filter((p) => user.permissions.has("system:admin") || user.permissions.has(p));
async function load(user: Variables["user"], key: string): Promise<TemplateView> {
  const tpl = (await listTemplates()).find((x) => x.key === key && (CATALOG[x.key] || x.custom));
  if (!tpl) return notFound();
  if (!mayEdit(user, tpl.editPermissions)) return forbidden();
  return tpl;
}
// ?from nur als interner Pfad ("/x", nicht "//x" oder "/\\x"), sonst Liste.
const backTo = (from?: string) => (from && /^\/(?![/\\])/.test(from) ? from : "/mail/templates");
const stamp = (u: { updatedAt: Date; updatedBy: string | null }) => ({
  name: u.updatedBy ?? t("mailTemplates.unknownUser" as never), date: formatDay(u.updatedAt, env.APP_TIMEZONE).replace(/^[^,]*,\s*/, ""),
});

mailTemplateRoutes.get("/", async (c) => {
  const user = c.get("user");
  const list = await editable(user);
  const catOf = (x: TemplateView) => (x.custom ? "custom" : CATALOG[x.key].category);
  const groups = [...new Set(list.map(catOf))];
  return c.html(
    <Layout title={t("mailTemplates.title")} user={user}>
      <div class="max-w-4xl mx-auto">
        <PageHeader title={t("mailTemplates.title")} actions={mayCreate(user) && <HeaderAction variant="primary" icon="plus" label={t("mailTemplates.new")} href="/mail/templates/new" class="btn-primary" />} />
        {!list.length && <p class="opacity-70">{t("mailTemplates.empty")}</p>}
        {groups.map((g) => (
          <section class="mb-6">
            <h2 class="text-lg font-semibold mb-2">{g === "custom" ? t("mailTemplates.group.custom") : T(`mail.type.${g}`)}</h2>
            <div class="overflow-x-auto">
              <table class="table table-zebra w-full">
                <thead><tr><th>{t("mailTemplates.col.name")}</th><th>{t("mailTemplates.col.state")}</th></tr></thead>
                <tbody>
                  {list.filter((x) => catOf(x) === g).map((x) => (
                    <tr class="cursor-pointer hover" onclick={`location.href='/mail/templates/${x.key}'`}>
                      <td>
                        <a href={`/mail/templates/${x.key}`} class="font-medium link link-hover">{x.custom ? x.custom.meta.name : CATALOG[x.key].name}</a>
                        <div class="text-sm opacity-60">{x.custom ? x.custom.meta.description : CATALOG[x.key].description}</div>
                      </td>
                      <td>{x.custom ? t("mailTemplates.state.own", stamp(x.custom)) : x.override ? t("mailTemplates.state.custom", stamp(x.override)) : t("mailTemplates.state.system")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </Layout>,
  );
});

const GROUPS = ["event", "recipient", "details", "org", "link", "fields"] as const;
const groupOf = (k: string, v: VarSpec, custom?: boolean) =>
  custom ? (k.startsWith("org.") || k === "type" ? "org" : k.startsWith("recipient.") ? "recipient" : "fields") : v.source === "link" ? "link" : k.startsWith("event.") ? "event" : /^(item|applicant|user)\.|^(rejoin)$/.test(k) ? "details" : k.startsWith("org.") || k === "type" ? "org" : "recipient";

// Zusätze des Editors für freie Vorlagen (Backlog 162)
interface CustomForm {
  isNew: boolean; name: string; description: string; prefix: string; headers: string; fields: { name: string; label?: string; example?: string }[];
  key: string; topic: string; audience: string; perms: string[]; topics: string[]; grantable: Permission[];
}
const AUDIENCES = ["member", "staff", "applicant"];

// Markierung (\u0001name\u0002) aus customPreviewVars → hervorgehobener Platzhalter (Hintergrund + Text, nicht nur Farbe)
const highlight = (s: string) => s.split(/\u0001([^\u0002]*)\u0002/).map((part, i) => (i % 2 ? <mark class="bg-warning text-warning-content px-1 rounded font-semibold">{`{{${part}}}`}</mark> : part));

function Editor({ user, back, tpl, values, errors, expected, conflict, cf }: { user: Variables["user"]; back: string; tpl: TemplateView; values: { subject: string; body: string }; errors: string[]; expected: string; conflict?: boolean; cf?: CustomForm }) {
  const key = tpl.key;
  const entry = cf
    ? { name: cf.name || t("mailTemplates.new"), description: cf.description, category: "custom", vars: customVars(cf.fields), required: [] as { name: string; list?: string; label: string }[], previewCases: [{ id: "default", label: t("mailTemplates.preview") }] }
    : CATALOG[key];
  const base = cf?.isNew ? "/mail/templates/new" : `/mail/templates/${key}`;
  const requiredNames = new Set(entry.required.map((r) => (r.list ? `${r.list}[].${r.name}` : r.name)));
  const phData = Object.entries(entry.vars).map(([name, v]) => ({ name, desc: v.desc, example: v.example, optional: !!v.optional, type: v.type, group: groupOf(name, v, !!cf), list: name.includes("[]") || v.type === "list", required: requiredNames.has(name) }));
  const formErr = errors.filter((e) => e.startsWith("form: "));
  const bodyErr = errors.filter((e) => !e.startsWith("subject:") && !e.startsWith("form: ") && !e.startsWith("headers: "));
  return (
    <Layout title={entry.name} user={user}>
      <div class="max-w-5xl mx-auto">
        <PageHeader
          title={cf?.isNew ? t("mailTemplates.new") : entry.name} backHref={back} backLabel={back === "/mail/templates" ? undefined : t("mailTemplates.back")} subtitle={entry.description}
          actions={<>
            {tpl.override && <HeaderAction icon="arrow-uturn-left" label={t("mailTemplates.reset")} class="btn-outline" onclick="document.getElementById('reset-dialog').showModal()" />}
            {cf && !cf.isNew && <HeaderAction icon="trash" label={t("mailTemplates.delete")} class="btn-outline btn-error" onclick="document.getElementById('delete-dialog').showModal()" />}
            <FormActions formId="tpl-form" />
          </>}
        />
        {cf ? (!cf.isNew && tpl.custom && <p class="mb-4">{t("mailTemplates.state.own", stamp(tpl.custom))}</p>)
          : tpl.override ? <p class="mb-4">{t("mailTemplates.status.custom", stamp(tpl.override))}</p> : <div role="status" class="alert alert-info alert-soft mb-4">{t("mailTemplates.status.system")}</div>}
        {formErr.length > 0 && <div role="alert" class="alert alert-error mb-4"><ul>{formErr.map((e) => <li>{e.replace(/^form: /, "")}</li>)}</ul></div>}
        {conflict && <div role="alert" class="alert alert-error mb-4"><span>{t("mailTemplates.conflict")} <a class="link" href={`/mail/templates/${key}`}>{t("mailTemplates.conflict.reload")}</a></span></div>}
        <div class="flex justify-end mb-2 md:hidden">
          <button type="button" id="ph-toggle" class="btn btn-ghost btn-square" aria-expanded="false" aria-controls="ph-col" aria-label={t("mailTemplates.sidebar")}><Icon name="sidebar-expand" class="h-5 w-5 text-gold" /></button>
        </div>
        <div role="tablist" class="tabs tabs-lift">
          <input type="radio" name="tpl-tabs" class="tab" aria-label={t("common.edit")} data-tab="edit" checked />
          <div class="tab-content bg-base-100 border-base-300 p-4">
        <div id="pane-edit" data-open="false" class="group grid gap-4 md:grid-rows-[minmax(0,1fr)] md:grid-cols-[1fr_3.25rem] md:relative md:data-[open=true]:grid-cols-[1fr_var(--ph-w,22rem)] md:data-[open=false]:grid-cols-1">
          <div id="ph-resize" role="separator" aria-orientation="vertical" class="hidden md:group-data-[open=true]:block absolute inset-y-0 z-10 w-2 cursor-col-resize rounded hover:bg-base-300 touch-none" style="right:calc(var(--ph-w,22rem) + 0.25rem)" />
          <div id="ph-backdrop" class="fixed inset-0 z-40 bg-black/40 md:hidden group-data-[open=false]:hidden" aria-hidden="true" />
          <form id="tpl-form" method="post" action={`${base}${fromQs(back)}`} class="space-y-4 min-w-0 pt-2 md:overflow-y-auto">
            <input type="hidden" name="updatedAt" value={expected} />
            {cf && <>
              <Field label={t("mailTemplates.custom.name")} required><input id="tpl-name" name="name" class="input w-full" placeholder={t("mailTemplates.custom.name")} value={cf.name} required /></Field>
              <Field label={t("mailTemplates.custom.description")}><input name="description" class="input w-full" placeholder={t("mailTemplates.custom.description")} value={cf.description} /></Field>
              {cf.isNew ? <>
                <Field label={t("mailTemplates.custom.key")} required hint={t("mailTemplates.custom.key.hint")}><input id="tpl-key" name="key" class="input w-full font-mono" placeholder={t("mailTemplates.custom.key")} value={cf.key} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength={60} required /></Field>
                <Field label={t("mailTemplates.custom.topic")} required hint={t("mailTemplates.custom.topic.hint")}>
                  <input name="topic" list="tpl-topics" class="input w-full font-mono" placeholder={t("mailTemplates.custom.topic")} value={cf.topic} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength={60} required />
                  <datalist id="tpl-topics">{cf.topics.map((x) => <option value={x} />)}</datalist>
                </Field>
                <Field label={t("mailTemplates.technical.audience")} required>
                  <select name="audience" class="select w-full">{AUDIENCES.map((a) => <option value={a} selected={cf.audience === a}>{T(`mailTemplates.audience.${a}`)}</option>)}</select>
                </Field>
                <FieldGroup legend={t("mailTemplates.custom.permissions")}>
                  <div class="grid gap-1 sm:grid-cols-2">{cf.grantable.map((p) => <label class="label cursor-pointer justify-start gap-2"><input type="checkbox" class="checkbox checkbox-sm" name="editPermissions" value={p} checked={cf.perms.includes(p)} />{PERMISSION_LABELS[p]}</label>)}</div>
                  <p class="label text-xs opacity-70 whitespace-normal">{t("mailTemplates.custom.permissions.hint")}</p>
                </FieldGroup>
              </> : null}
              <Field label={t("mailTemplates.technical.prefix")}><input id="tpl-prefix" name="prefix" class="input w-full font-mono" placeholder={t("mailTemplates.technical.prefix")} value={cf.prefix} /></Field>
            </>}
            <Field label={t("mailTemplates.field.subject")} required class="md:group-data-[open=false]:pr-12" after={errors.filter((e) => e.startsWith("subject:")).map((e) => <p id="err-subject" class="text-error text-sm">{e.replace(/^subject: /, "")}</p>)}>
              <input id="tpl-subject" name="subject" class="input w-full font-mono" placeholder={t("mailTemplates.field.subject")} value={values.subject} required aria-describedby={errors.some((e) => e.startsWith("subject:")) ? "err-subject" : undefined} />
            </Field>
            <Field label={t("mailTemplates.field.body")} required after={bodyErr.map((e) => <p id="err-body" class="text-error text-sm">{e.replace(/^(body|prefix): /, "")}</p>)}>
              <textarea id="tpl-body" name="body" rows={18} class="textarea w-full max-w-full resize-y font-mono" placeholder={t("mailTemplates.field.body")} required aria-describedby={bodyErr.length ? "err-body" : undefined}>{values.body}</textarea>
            </Field>
            {cf && <>
              {cf.fields.length > 0 && (
                <div>
                  <h2 class="font-semibold mb-1">{t("mailTemplates.custom.fields")}</h2>
                  <p class="text-sm opacity-70 mb-2">{t("mailTemplates.custom.fields.hint")}</p>
                  <div class="overflow-x-auto"><table class="table table-sm">
                    <thead><tr><th>{t("mailTemplates.custom.fields.placeholder")}</th><th>{t("mailTemplates.custom.fields.label")}</th><th>{t("mailTemplates.custom.fields.example")}</th></tr></thead>
                    <tbody>{cf.fields.map((f) => (
                      <tr><td><code>{`{{${f.name}}}`}</code></td>
                        <td><input name={`fl_${f.name}`} class="input input-sm w-full" value={f.label ?? ""} placeholder={fieldLabel(f.name)} aria-label={`${f.name}: ${t("mailTemplates.custom.fields.label")}`} /></td>
                        <td><input name={`fe_${f.name}`} class="input input-sm w-full" value={f.example ?? ""} aria-label={`${f.name}: ${t("mailTemplates.custom.fields.example")}`} /></td></tr>
                    ))}</tbody>
                  </table></div>
                </div>
              )}
              <Field label={t("mailTemplates.custom.headers")} hint={t("mailTemplates.custom.headers.hint")} after={<p id="err-headers" class="text-error text-sm">{errors.filter((e) => e.startsWith("headers: ")).map((e) => e.replace(/^headers: /, "")).join(" ")}</p>}>
                <textarea id="tpl-headers" name="headers" rows={3} class="textarea w-full max-w-full font-mono" placeholder="X-Name: Wert" aria-describedby="err-headers">{cf.headers}</textarea>
              </Field>
            </>}
          </form>
          <aside id="ph-col" aria-label={t("mailTemplates.placeholders")} class="fixed inset-y-0 right-0 z-50 w-80 max-w-[85vw] overflow-auto bg-base-100 shadow-xl transition-transform group-data-[open=false]:invisible group-data-[open=false]:translate-x-full md:static md:mt-2 md:inset-auto md:z-auto md:w-auto md:max-w-none md:group-data-[open=true]:[contain:size] md:overflow-y-auto md:rounded-box md:border md:border-base-300 md:shadow-none md:group-data-[open=false]:visible md:group-data-[open=false]:translate-x-0 md:group-data-[open=false]:absolute md:group-data-[open=false]:-top-px md:group-data-[open=false]:-right-px md:group-data-[open=false]:w-[calc(2.5rem+2px)] md:group-data-[open=false]:border-transparent md:group-data-[open=false]:overflow-visible motion-reduce:transition-none">
            <div class="bg-base-300 md:sticky md:top-0 md:z-10 flex items-center justify-between gap-1 p-0 md:group-data-[open=false]:justify-center md:group-data-[open=false]:bg-transparent">
              <div role="tablist" class="tabs tabs-sm md:group-data-[open=false]:hidden">
                <button type="button" role="tab" class="tab tab-active font-bold" data-side="ph">{t("mailTemplates.placeholders")}</button>
                <button type="button" role="tab" class="tab font-bold" data-side="tech">{t("mailTemplates.technical")}</button>
              </div>
              <button type="button" id="ph-close" class="btn btn-ghost btn-square btn-md md:inline-flex md:tooltip md:tooltip-left" aria-expanded="false" aria-controls="ph-col" aria-label={t("mailTemplates.sidebar")} data-tip={t("mailTemplates.sidebar")}>
                <Icon name="sidebar-expand" class="h-5 w-5 text-gold md:group-data-[open=false]:hidden" />
                <Icon name="sidebar-collapse" class="h-5 w-5 text-gold hidden md:group-data-[open=false]:block" />
              </button>
            </div>
            <div id="side-ph" class="md:group-data-[open=false]:hidden p-2 space-y-2 text-sm">
              <input id="ph-search" type="search" class="input input-sm w-full" placeholder={t("mailTemplates.search")} aria-label={t("mailTemplates.search")} autocomplete="off" />
              <p id="ph-empty" class="hidden text-base-content/60 p-1" role="status">{t("mailTemplates.search.empty")}</p>
              {GROUPS.map((g) => {
                const cond = (k: string, v: { optional?: boolean; type: string }) => v.optional && v.type !== "boolean" && !requiredNames.has(k);
                const items = Object.entries(entry.vars).filter(([k, v]) => v.type !== "list" && groupOf(k, v, !!cf) === g);
                return items.length > 0 && (
                  <section data-g>
                    <h3 class="px-1 pt-1 text-xs font-bold uppercase tracking-wide text-base-content/60">{t(`mailTemplates.group.${g}`)}</h3>
                    <ul class="space-y-1 p-1">
                      {items.map(([k, v]) => (
                        <li data-s={`${k} ${v.desc} ${v.example}`} data-k={k} data-d={v.desc} data-e={v.example || undefined} class={cond(k, v) ? "rounded-box bg-base-200 p-1 space-y-1" : undefined}>
                          {cond(k, v) ? (
                            <>
                              <p class="px-1 text-xs">{v.desc}{v.optional && <span class="text-base-content/60"> ({t("mailTemplates.optional")})</span>}{v.example && <span class="block text-base-content/60 break-all">{v.example}</span>}</p>
                              <div class="flex flex-wrap gap-1">
                                {v.type !== "boolean" && <button type="button" class="btn btn-ghost btn-xs" data-ph={k} title={k}>+ {t("mailTemplates.insertDirect")}</button>}
                                <button type="button" class="btn btn-ghost btn-xs" data-cond={k} data-bool={v.type === "boolean" ? "1" : undefined} title={v.type === "boolean" ? t("mailTemplates.onlyIfTrue.tip") : t("mailTemplates.onlyIfPresent.tip")}>+ {v.type === "boolean" ? t("mailTemplates.onlyIfTrue") : t("mailTemplates.onlyIfPresent")}</button>
                              </div>
                            </>
                          ) : v.type === "boolean" && !requiredNames.has(k) ? (
                            <button type="button" class="btn btn-ghost btn-xs h-auto w-full justify-start text-left whitespace-normal" data-cond={k} data-bool="1" title={t("mailTemplates.onlyIfTrue.tip")}>+ {t("mailTemplates.onlyIfBool")}: {v.desc}</button>
                          ) : (
                            <button type="button" class="btn btn-ghost btn-xs h-auto w-full justify-start text-left whitespace-normal flex-col items-start gap-0" data-ph={k} title={k}>
                              <span>+ {v.desc}</span>
                              {v.example && <span class="font-normal text-xs text-base-content/60 break-all">{v.example}</span>}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
            <dl id="side-tech" class="hidden text-sm p-3 space-y-3">
              <div><dt class="text-xs uppercase tracking-wide text-base-content/60">{t("mailTemplates.technical.category")}</dt><dd>{T(`mail.type.${entry.category}`)}</dd></div>
              <div><dt class="text-xs uppercase tracking-wide text-base-content/60">{t("mailTemplates.technical.audience")}</dt><dd>{T(`mailTemplates.audience.${tpl.audience}`)}</dd></div>
              <div><dt class="text-xs uppercase tracking-wide text-base-content/60">{t("mailTemplates.technical.prefix")}</dt><dd><code>{cf ? "" : tpl.prefix}</code></dd></div>
              <div><dt class="text-xs uppercase tracking-wide text-base-content/60">{t("mailTemplates.technical.headers")}</dt>
                <dd class="break-all"><code class="block">X-On-Duty-Category: {tpl.category}</code><code class="block">X-On-Duty-Event: {cf ? `custom-${cf.key || tpl.key}` : tpl.key}</code><code class="block">X-On-Duty-Audience: {tpl.audience}</code></dd></div>
            </dl>
          </aside>
        </div>
          </div>
          {entry.previewCases.length > 1 && <input type="radio" name="tpl-tabs" class="tab" aria-label={t("mailTemplates.preview")} data-tab="entry" />}
          {entry.previewCases.map((x) => (
            <>
              <input type="radio" name="tpl-tabs" class={entry.previewCases.length > 1 ? "tab hidden text-secondary checked:font-semibold [--tab-bg:var(--color-base-200)] [--tab-border-color:var(--color-secondary)]" : "tab"} aria-label={entry.previewCases.length > 1 ? x.label : t("mailTemplates.preview")} data-tab="preview" data-case={x.id} hx-post={`${base}/preview`} hx-include="#tpl-form" hx-vals={JSON.stringify({ case: x.id })} hx-target={`#preview-${x.id}`} />
              <div class="tab-content bg-base-100 border-secondary p-4"><div id={`preview-${x.id}`} /></div>
            </>
          ))}
        </div>
        {cf && !cf.isNew && (
          <dialog id="delete-dialog" class="modal">
            <div class="modal-box">
              <p>{t("mailTemplates.delete.body")}</p>
              <form method="post" action={`/mail/templates/${key}/delete${fromQs(back)}`} class="modal-action">
                <button type="button" class="btn" onclick="document.getElementById('delete-dialog').close()">{t("common.cancel")}</button>
                <button type="submit" class="btn btn-error">{t("mailTemplates.delete")}</button>
              </form>
            </div>
          </dialog>
        )}
        {tpl.override && (
          <dialog id="reset-dialog" class="modal">
            <div class="modal-box">
              <p>{t("mailTemplates.reset.body")}</p>
              <pre class="mt-3 text-sm whitespace-pre-wrap font-mono bg-base-200 p-3 rounded-box">{tpl.system.subject}{"\n\n"}{tpl.system.body}</pre>
              <form method="post" action={`/mail/templates/${key}/reset${fromQs(back)}`} class="modal-action">
                <button type="button" class="btn" onclick="document.getElementById('reset-dialog').close()">{t("common.cancel")}</button>
                <button type="submit" class="btn btn-error">{t("mailTemplates.reset")}</button>
              </form>
            </div>
          </dialog>
        )}
        <script id="ph-data" type="application/json" dangerouslySetInnerHTML={{ __html: JSON.stringify(phData).replace(/</g, "\\u003c") }} />
        <script src="/js/mail-placeholders.min.js" data-leave={t("mailTemplates.leaveWarning")} data-tip-if={t("mailTemplates.tip.onlyIf")} data-tip-end={t("mailTemplates.tip.end")} data-ac-count={t("mailTemplates.ac.count")} data-ac-none={t("mailTemplates.ac.none")} defer></script>
      </div>
    </Layout>
  );
}

const fromQs = (back: string) => (back === "/mail/templates" ? "" : `?from=${encodeURIComponent(back)}`);
const readForm = async (c: any) => {
  const f = await c.req.parseBody();
  return { subject: String(f.subject ?? "").trim(), body: String(f.body ?? "").replace(/\r\n/g, "\n"), expected: String(f.updatedAt ?? "") };
};

// ---- Freie Vorlagen (Backlog 162): /new steht vor /:key ----------------------

const blankTpl = (): TemplateView => ({ key: "", category: "custom", audience: "member", prefix: "", editPermissions: [], system: { subject: "", body: "" }, override: null });
const asArray = (v: unknown) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(String);

async function readCustom(c: any) {
  const f = await c.req.parseBody({ all: true });
  const one = (k: string) => String(asArray(f[k])[0] ?? "");
  const subject = one("subject").trim(), body = one("body").replace(/\r\n/g, "\n"), prefix = one("prefix").trim();
  const fields = customFields({ prefix, subject, body }).map((name) => ({ name, label: one(`fl_${name}`).trim() || undefined, example: one(`fe_${name}`).trim() || undefined }));
  return { subject, body, prefix, fields, name: one("name").trim(), description: one("description").trim(), headers: one("headers").replace(/\r\n/g, "\n"), key: one("key").trim(), topic: one("topic").trim(), audience: one("audience"), perms: asArray(f.editPermissions), expected: one("updatedAt"), case: one("case") };
}
type CustomFormData = Awaited<ReturnType<typeof readCustom>>;

async function customErrors(d: CustomFormData, allowed: string[] | null, newKey: boolean) {
  const e: string[] = [];
  if (!d.name) e.push(`form: ${t("mailTemplates.custom.err.name")}`);
  if (newKey) {
    if (!SLUG_RE.test(d.key) || d.key.length > 60) e.push(`form: ${t("mailTemplates.custom.err.key")}`);
    else if (await keyTaken(d.key)) e.push(`form: ${t("mailTemplates.custom.err.keyTaken")}`);
    if (!SLUG_RE.test(d.topic) || d.topic.length > 60) e.push(`form: ${t("mailTemplates.custom.err.topic")}`);
    if (!AUDIENCES.includes(d.audience)) e.push(`form: ${t("mailTemplates.custom.err.audience")}`);
    if (!d.perms.length || d.perms.some((p) => !allowed!.includes(p))) e.push(`form: ${t("mailTemplates.custom.err.permissions")}`);
  }
  e.push(...parseHeaders(d.headers).errors.map((x) => `headers: ${x}`));
  e.push(...validateTemplate(newKey ? "" : d.key, d));
  return e;
}

const toInput = (d: CustomFormData, tpl: Pick<TemplateView, "audience" | "editPermissions"> & { topic?: string }, isNew: boolean): CustomInput => ({
  meta: { name: d.name, ...(d.description ? { description: d.description } : {}), fields: d.fields } satisfies CustomMeta,
  topic: isNew ? d.topic : tpl.topic!, audience: isNew ? d.audience : tpl.audience, editPermissions: isNew ? d.perms : tpl.editPermissions,
  prefix: d.prefix, subject: d.subject, body: d.body, extraHeaders: parseHeaders(d.headers).headers,
});

async function renderCustom(c: any, tpl: TemplateView, d: CustomFormData | null, isNew: boolean, errors: string[] = [], status?: number) {
  const user = c.get("user");
  const cur = tpl.custom;
  const form: CustomForm = {
    isNew, name: d?.name ?? cur?.meta.name ?? "", description: d?.description ?? cur?.meta.description ?? "", prefix: d?.prefix ?? tpl.prefix,
    headers: d?.headers ?? Object.entries(cur?.extraHeaders ? JSON.parse(cur.extraHeaders) : {}).map(([k, v]) => `${k}: ${v}`).join("\n"),
    fields: d?.fields ?? cur?.meta.fields ?? [], key: d?.key ?? tpl.key, topic: d?.topic ?? cur?.topic ?? "", audience: d?.audience ?? tpl.audience,
    perms: d?.perms ?? tpl.editPermissions, topics: isNew ? await listTopics() : [], grantable: grantable(user),
  };
  const values = d ?? tpl.system;
  return c.html(<Editor user={user} back={backTo(c.req.query("from"))} tpl={tpl} values={values} errors={errors} expected={d?.expected ?? cur?.updatedAt.toISOString() ?? ""} conflict={status === HTTP_STATUS.CONFLICT} cf={form} />, status);
}

const requireCreate = (user: Variables["user"]) => { if (!mayCreate(user)) forbidden(); };

mailTemplateRoutes.get("/new", async (c) => { requireCreate(c.get("user")); return renderCustom(c, blankTpl(), null, true); });

mailTemplateRoutes.post("/new", async (c) => {
  const user = c.get("user");
  requireCreate(user);
  const d = await readCustom(c);
  const errors = await customErrors(d, grantable(user), true);
  const tpl = blankTpl();
  if (errors.length) return renderCustom(c, tpl, d, true, errors, HTTP_STATUS.UNPROCESSABLE_ENTITY);
  if ((await createCustom(d.key, toInput(d, tpl, true), user.id)) === "conflict") return renderCustom(c, tpl, d, true, [`form: ${t("mailTemplates.custom.err.keyTaken")}`], HTTP_STATUS.CONFLICT);
  setFlash(c, t("mailTemplates.flash.saved"), "success");
  return c.redirect(`/mail/templates/${d.key}${fromQs(backTo(c.req.query("from")))}`);
});

// Nur Beispieldaten: Felder mit Beispieltext, sonst hervorgehobener Platzhalter.
const previewCustom = async (c: any) => {
  const d = await readCustom(c);
  const errors = [...parseHeaders(d.headers).errors, ...validateTemplate("", d)];
  if (errors.length) return c.html(<div role="alert" class="alert alert-error"><ul>{errors.map((e) => <li>{e.replace(/^\w+: /, "")}</li>)}</ul><a class="link" href="#" onclick="document.querySelector('[data-tab=edit]').click();return false">{t("mailTemplates.preview.toEditor")}</a></div>);
  const out = renderMail(d, customPreviewVars(d.fields));
  return c.html(
    <div>
      <div class="border border-base-300 rounded-box overflow-hidden" aria-live="polite">
        <div class="bg-base-200 border-b border-base-300 px-4 py-3">
          <p class="text-xs uppercase tracking-wide text-secondary mb-1">{t("mailTemplates.preview.head")} · {t("mailTemplates.preview.sample")}</p>
          <p class="font-semibold">{highlight(out.subject)}</p>
        </div>
        <div class="whitespace-pre-wrap text-sm p-4 bg-base-100">{highlight(out.text)}</div>
      </div>
    </div>,
  );
};
mailTemplateRoutes.post("/new/preview", async (c) => { requireCreate(c.get("user")); return previewCustom(c); });

mailTemplateRoutes.get("/:key", async (c) => {
  const tpl = await load(c.get("user"), c.req.param("key"));
  if (tpl.custom) return renderCustom(c, tpl, null, false);
  const cur = tpl.override ?? tpl.system;
  return c.html(<Editor user={c.get("user")} back={backTo(c.req.query("from"))} tpl={tpl} values={cur} errors={[]} expected={tpl.override?.updatedAt.toISOString() ?? ""} />);
});

mailTemplateRoutes.post("/:key", async (c) => {
  const user = c.get("user");
  const tpl = await load(user, c.req.param("key"));
  if (tpl.custom) {
    const d = await readCustom(c);
    const errors = await customErrors({ ...d, key: tpl.key }, null, false);
    if (errors.length) return renderCustom(c, tpl, d, false, errors, HTTP_STATUS.UNPROCESSABLE_ENTITY);
    if ((await saveCustom(tpl.key, toInput(d, { ...tpl, topic: tpl.custom.topic }, false), user.id, d.expected)) === "conflict") return renderCustom(c, tpl, d, false, [], HTTP_STATUS.CONFLICT);
    setFlash(c, t("mailTemplates.flash.saved"), "success");
    return c.redirect(`/mail/templates/${tpl.key}${fromQs(backTo(c.req.query("from")))}`);
  }
  const { subject, body, expected } = await readForm(c);
  const errors = validateTemplate(tpl.key, { prefix: tpl.prefix, subject, body });
  const again = (errs: string[], conflict = false) =>
    c.html(<Editor user={c.get("user")} back={backTo(c.req.query("from"))} tpl={tpl} values={{ subject, body }} errors={errs} expected={expected} conflict={conflict} />, conflict ? HTTP_STATUS.CONFLICT : HTTP_STATUS.UNPROCESSABLE_ENTITY);
  if (errors.length) return again(errors);
  if ((await saveOverride(tpl, { subject, body }, user.id, expected)) === "conflict") return again([], true);
  setFlash(c, t("mailTemplates.flash.saved"), "success");
  return c.redirect(`/mail/templates/${tpl.key}${fromQs(backTo(c.req.query("from")))}`);
});

// Nur Beispieldaten: kein Versand, keine Speicherung, keine Fachdaten.
mailTemplateRoutes.post("/:key/preview", async (c) => {
  const tpl = await load(c.get("user"), c.req.param("key"));
  if (tpl.custom) return previewCustom(c);
  const f = await c.req.parseBody();
  const { subject, body } = await readForm(c);
  const cases = CATALOG[tpl.key].previewCases;
  const caseId = cases.find((x) => x.id === String(f.case ?? ""))?.id ?? cases[0].id;
  const errors = validateTemplate(tpl.key, { prefix: tpl.prefix, subject, body });
  // strukturiert: Zeile aus der Meldung, Pflichtplatzhalter-Status für die Checkliste des Editors
  const issues = errors.map((e) => ({ line: /Zeile (\d+)/.exec(e)?.[1], missing: e.startsWith("Pflichtplatzhalter"), text: e.replace(/^\w+: /, "") }));
  const missing = CATALOG[tpl.key].required.filter((r) => issues.some((i) => i.missing && i.text.includes(`„${r.label}“`))).map((r) => r.name);
  if (errors.length) return c.html(<div role="alert" class="alert alert-error" data-missing={missing.join(",")}><ul>{issues.map((i) => <li data-line={i.line}>{i.text}</li>)}</ul><a class="link" href="#" onclick="document.querySelector('[data-tab=edit]').click();return false">{t("mailTemplates.preview.toEditor")}</a></div>);
  const out = renderMail({ prefix: tpl.prefix, subject, body }, previewVars(tpl.key, caseId));
  return c.html(
    <div>
      <div class="border border-base-300 rounded-box overflow-hidden" aria-live="polite">
        <div class="bg-base-200 border-b border-base-300 px-4 py-3">
          <p class="text-xs uppercase tracking-wide text-secondary mb-1">{t("mailTemplates.preview.head")} · {t("mailTemplates.preview.sample")}</p>
          <p class="font-semibold">{out.subject}</p>
        </div>
        <div class="whitespace-pre-wrap text-sm p-4 bg-base-100">{out.text}</div>
      </div>
    </div>,
  );
});

mailTemplateRoutes.post("/:key/delete", async (c) => {
  const tpl = await load(c.get("user"), c.req.param("key"));
  if (!tpl.custom) return notFound();
  await deleteCustom(tpl.key);
  setFlash(c, t("mailTemplates.flash.deleted"), "success");
  return c.redirect(backTo(c.req.query("from")));
});

mailTemplateRoutes.post("/:key/reset", async (c) => {
  const tpl = await load(c.get("user"), c.req.param("key"));
  if (tpl.custom) return notFound();
  await resetOverride(tpl.key);
  setFlash(c, t("mailTemplates.flash.reset"), "success");
  return c.redirect(`/mail/templates/${tpl.key}${fromQs(backTo(c.req.query("from")))}`);
});
