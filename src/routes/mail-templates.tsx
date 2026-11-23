import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ChipInput } from "../components/chip-input.js";
import { tagSuggestionsJson } from "../lib/tags.js";
import { Layout } from "../components/layout.js";
import { FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { HTTP_STATUS } from "../lib/constants.js";
import { setFlash } from "../lib/flash.js";
import { formatDateTime, formatDay, resolveLocale, resolveTimezone } from "../lib/datetime.js";
import { env } from "../env.js";
import { CATALOG, customFields, customPreviewVars, customVars, fieldLabel, mayEdit, previewVars, renderMail, requiredStatus, validateTemplate, type VarSpec } from "../lib/mail-templates.js";
import { createCustom, deleteCustom, keyTaken, listTemplates, listTopics, resetOverride, saveCustom, saveOverride, type CustomInput, type TemplateView } from "../lib/mail-template-store.js";
import { parseHeaders } from "../lib/mail-headers.js";
import { SLUG_RE } from "../lib/slug.js";
import { PERMISSIONS, type Permission } from "../lib/roles.js";
import { db } from "../db/index.js";
import { mailLog, memberRoles, members, persons } from "../db/schema/index.js";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { EntityPicker, PickerOptions } from "../components/entity-picker.js";
import { PERMISSION_LABELS } from "../components/permission-badges.js";
import type { CustomMeta } from "../db/schema/mail.js";
import { t } from "../i18n/index.js";
import { Icon } from "../components/icon.js";
import { countMails, customRecipients, isSending, startCustomMail } from "../lib/custom-mail.js";
import { isSmtpConfigured } from "../lib/mail.js";
import { countRecipients } from "../lib/event-mail.js";
import { Field, FieldGroup } from "../components/field.js";
import { PermissionPicker } from "../components/permission-picker.js";

export const mailTemplateRoutes = new Hono<{ Variables: Variables }>();
mailTemplateRoutes.use("*", requireAuth()); // Recht je Vorlage wird im Handler geprüft

const T = (k: string, p?: Record<string, string | number>) => t(k as never, p);
const forbidden = () => { throw new HTTPException(HTTP_STATUS.FORBIDDEN); };
const notFound = () => { throw new HTTPException(HTTP_STATUS.NOT_FOUND); };

async function editable(user: Variables["user"]): Promise<TemplateView[]> {
  // Reihenfolge = Katalog (die DB liefert ohne ORDER BY keine stabile Reihenfolge), freie Vorlagen zuerst, nach Name
  const order = Object.keys(CATALOG);
  const nameOf = (x: TemplateView) => x.custom?.meta.name ?? "";
  return (await listTemplates()).filter((x) => (CATALOG[x.key] || x.custom) && (mayEdit(user, x.editPermissions) || (x.custom && maySend(user))))
    .sort((a, b) => (b.custom ? 1 : 0) - (a.custom ? 1 : 0) || order.indexOf(a.key) - order.indexOf(b.key) || nameOf(a).localeCompare(nameOf(b), "de"));
}
const maySend = (user: Variables["user"]) => user.permissions.has("system:admin") || user.permissions.has("mail:send");
const mayCreate = (user: Variables["user"]) => user.permissions.has("system:admin") || user.permissions.has("mail:templates");
// Rechte, die der Ersteller vergeben darf: nur eigene (system:admin: alle)
const grantable = (user: Variables["user"]): Permission[] => PERMISSIONS.filter((p) => user.permissions.has("system:admin") || user.permissions.has(p));
async function load(user: Variables["user"], key: string, forSend = false): Promise<TemplateView> {
  const tpl = (await listTemplates()).find((x) => x.key === key && (CATALOG[x.key] || x.custom));
  if (!tpl) return notFound();
  if (forSend ? !tpl.custom || !maySend(user) : !mayEdit(user, tpl.editPermissions)) return forbidden();
  return tpl;
}
// ?from nur als interner Pfad ("/x", nicht "//x" oder "/\\x"), sonst Liste.
const backTo = (from?: string) => (from && /^\/(?![/\\])/.test(from) ? from : "/mail/templates");
const stamp = (u: { updatedAt: Date; updatedBy: string | null }) => ({
  name: u.updatedBy ?? t("mailTemplates.unknownUser" as never), date: formatDay(u.updatedAt, env.APP_TIMEZONE).replace(/^[^,]*,\s*/, ""),
});

mailTemplateRoutes.get("/", async (c) => {
  const user = c.get("user");
  const q = (c.req.query("q") ?? "").trim();
  const cat = c.req.query("category") ?? "";
  const all = (await editable(user)).filter((x) => !cat || (x.custom ? "custom" : CATALOG[x.key].category) === cat);
  // Suche in Name, Beschreibung, Betreff und aktuellem Text (Override vor System)
  const hay = (x: TemplateView) => [x.custom?.meta.name ?? CATALOG[x.key].name, x.custom?.meta.description ?? CATALOG[x.key].description, (x.override ?? x.system).subject, (x.override ?? x.system).body].join("\n").toLowerCase();
  const list = q ? all.filter((x) => hay(x).includes(q.toLowerCase())) : all;
  const href = (x: TemplateView) => `/mail/templates/${x.key}${x.custom && !mayEdit(user, x.editPermissions) ? "/send" : ""}`;
  const catOf = (x: TemplateView) => (x.custom ? "custom" : CATALOG[x.key].category);
  const groups = [...new Set(list.map(catOf))];
  return c.html(
    <Layout title={t("mailTemplates.title")} user={user}>
      <div class="max-w-4xl mx-auto">
        <PageHeader title={t("mailTemplates.title")} actions={mayCreate(user) && <HeaderAction variant="primary" icon="icon-[tabler--plus]" label={t("mailTemplates.new")} href="/mail/templates/new" class="btn-primary" />} />
        {all.length > 0 && (
          <form method="get" role="search" class="mb-4">
            {cat && <input type="hidden" name="category" value={cat} />}
            <input type="search" name="q" value={q} class="input w-full" placeholder={t("mailTemplates.searchTemplates")} aria-label={t("mailTemplates.searchTemplates")} autocomplete="off" />
          </form>
        )}
        {!list.length && <p class="opacity-70">{t(all.length ? "mailTemplates.searchTemplates.empty" : "mailTemplates.empty")}</p>}
        {groups.map((g, i) => (
          <>
          {i === 1 && groups[0] === "custom" && <div class="divider text-sm opacity-70">{t("mailTemplates.group.system")}</div>}
          <section class={`mb-6 ${g === "custom" ? "border-l-4 border-primary pl-4" : ""}`}>
            <h2 class={`text-lg font-semibold ${g === "custom" ? "text-primary mb-0" : "mb-2"}`}>{g === "custom" ? t("mailTemplates.group.custom") : T(`mail.type.${g}`)}</h2>
            {g === "custom" && <p class="text-sm opacity-70 mb-2">{t("mailTemplates.group.custom.hint")}</p>}
            <div class="overflow-x-auto">
              <table class="table table-zebra w-full">
                <tbody>
                  {list.filter((x) => catOf(x) === g).map((x) => (
                    <tr class="cursor-pointer hover" onclick={`location.href='${href(x)}'`}>
                      <td>
                        <a href={href(x)} class="font-medium link link-hover">{x.custom ? x.custom.meta.name : CATALOG[x.key].name}</a>
                        <div class="text-sm opacity-60">{x.custom ? x.custom.meta.description : CATALOG[x.key].description}</div>
                      </td>
                      <td class="text-right whitespace-nowrap">
                        {x.custom && maySend(user) && (
                          <a href={`/mail/templates/${x.key}/send`} class="btn btn-ghost btn-sm btn-square" title={t("mailTemplates.send")} aria-label={`${x.custom.meta.name}: ${t("mailTemplates.send")}`} onclick="event.stopPropagation()">
                            <Icon name="icon-[tabler--mail]" class="h-5 w-5" />
                          </a>
                        )}
                        <button type="button" class="btn btn-ghost btn-sm btn-square" title={t("mailTemplates.quick")} aria-label={`${x.custom ? x.custom.meta.name : CATALOG[x.key].name}: ${t("mailTemplates.quick")}`}
                          hx-get={`/mail/templates/${x.key}/quick`} data-no-busy hx-target="#quick-body" {...{ "hx-on::after-request": "if(event.detail.successful)document.getElementById('quick-dialog').showModal()" }} onclick="event.stopPropagation()">
                          <Icon name="icon-[tabler--search]" class="h-5 w-5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          </>
        ))}
        <dialog id="quick-dialog" class="modal">
          <div class="modal-box max-w-3xl">
            <div id="quick-body" />
            <form method="dialog" class="modal-action"><button class="btn">{t("common.close")}</button></form>
          </div>
          <form method="dialog" class="modal-backdrop"><button aria-label={t("common.close")}>{t("common.close")}</button></form>
        </dialog>
      </div>
    </Layout>,
  );
});

// Gerenderte Mail (Betreff + Text); Markierungen leerer Felder werden hervorgehoben.
const MailPreview = ({ subject, text }: { subject: string; text: string }) => (
  <div class="border border-base-300 rounded-box overflow-hidden" aria-live="polite">
    <div class="bg-base-200 border-b border-base-300 px-4 py-3">
      <p class="text-xs uppercase tracking-wide text-secondary mb-1">{t("mailTemplates.preview.head")} · {t("mailTemplates.preview.sample")}</p>
      <p class="font-semibold">{highlight(subject)}</p>
    </div>
    <div class="whitespace-pre-wrap text-sm p-4 bg-base-100">{highlight(text)}</div>
  </div>
);

const GROUPS = ["event", "recipient", "details", "org", "link", "fields"] as const;
const groupOf = (k: string, v: VarSpec, custom?: boolean) =>
  custom ? (k.startsWith("org.") || k === "type" ? "org" : k.startsWith("recipient.") || ["addressee", "you", "multiple"].includes(k) ? "recipient" : k === "unsubscribeUrl" ? "link" : "fields") : v.source === "link" ? "link" : k.startsWith("event.") ? "event" : /^(item|applicant|user)\.|^(rejoin)$/.test(k) ? "details" : k.startsWith("org.") || k === "type" ? "org" : "recipient";

// Zusätze des Editors für freie Vorlagen (Backlog 162)
interface CustomForm {
  isNew: boolean; urgent: boolean; name: string; description: string; prefix: string; headers: string; fields: { name: string; label?: string; example?: string }[];
  key: string; topic: string; audience: string; perms: string[]; topics: string[]; grantable: Permission[];
}
// Header als Zeilen „X-Name | Wert“; leere Zeilen kommen erst per „+“
const headerRows = (text: string): [string, string][] => {
  const rows = text.split("\n").filter((l) => l.trim()).map((l): [string, string] => { const at = l.indexOf(":"); return at < 0 ? [l.trim(), ""] : [l.slice(0, at).trim(), l.slice(at + 1).trim()]; });
  return rows;
};
const HeaderRow = ({ n, v }: { n: string; v: string }) => (
  <div class="flex gap-2 items-center" data-hrow>
    <div class="tooltip tooltip-focus-only tooltip-start w-2/5" data-tip={t("mailTemplates.custom.headers.hint")}>
      <input name="hn" class="input w-full font-mono" value={n} placeholder="X-Name" aria-label={t("mailTemplates.custom.headers.name")} />
    </div>
    <input name="hv" class="input grow font-mono" value={v} placeholder={t("mailTemplates.custom.headers.value")} aria-label={t("mailTemplates.custom.headers.value")} />
    <button type="button" class="btn btn-ghost btn-sm btn-square" aria-label={t("common.remove")} onclick="this.closest('[data-hrow]').remove()">×</button>
  </div>
);
const AUDIENCES = ["member", "staff", "applicant"];

// Pflichtplatzhalter-Checkliste der Editorleiste; #req-wrap wird per HTMX (outerHTML) ersetzt, der Live-Text per OOB in #req-live.
const liveText = (n: number, incomplete: boolean) => incomplete ? t("mailTemplates.req.syntax") : n ? t("mailTemplates.req.missingCount", { count: n }) : t("mailTemplates.req.complete");
function RequiredChecklist({ status, oob }: { status: ReturnType<typeof requiredStatus>; oob?: boolean }) {
  const { items, incomplete } = status;
  const missing = incomplete ? 0 : items.filter((i) => !i.ok).length;
  const live = <span id="req-live" class="sr-only" aria-live="polite" {...(oob ? { "hx-swap-oob": "innerHTML" } : {})}>{items.length ? liveText(missing, incomplete) : ""}</span>;
  if (!items.length || (!incomplete && !missing)) return <><span id="req-wrap" />{live}</>; // alles vorhanden: kein Button, nur Live-Text
  const icon = incomplete ? <Icon name="icon-[tabler--checkup-list]" class="h-4 w-4 text-base-content/60" /> : <Icon name="icon-[tabler--alert-triangle]" class="h-4 w-4 text-warning" />;
  return (
    <>
      <span id="req-wrap">
        <button type="button" id="req-btn" class="btn btn-ghost btn-sm btn-square" popovertarget="req-check" style="anchor-name:--req-btn" aria-expanded="false" aria-controls="req-check" aria-label={t("mailTemplates.req.title")} title={t("mailTemplates.req.title")} data-missing={missing}>
          <span class="indicator">{missing ? <span class="indicator-item badge badge-warning badge-xs">{missing}</span> : null}{icon}</span>
        </button>
        <div id="req-check" popover="auto" style="position-anchor:--req-btn" aria-label={t("mailTemplates.req.title")} class="dropdown w-72 max-w-[calc(100vw-1rem)] rounded-box border border-base-300 bg-base-100 p-3 space-y-2 text-sm shadow-xl">
          <h3 class="font-semibold">{t("mailTemplates.req.title")}</h3>
          {incomplete ? <p class="text-base-content/60">{t("mailTemplates.req.syntax")}</p> : (
            <ul class="space-y-1">{items.map((i) => <li class="flex items-center gap-2"><Icon name={i.ok ? "icon-[tabler--check]" : "icon-[tabler--alert-triangle]"} class={`h-4 w-4 shrink-0 ${i.ok ? "text-success" : "text-warning"}`} /><span class="grow">{i.label} <code class="text-xs text-base-content/60">{i.list ? `{{#${i.list}}}{{${i.name}}}{{/${i.list}}}` : `{{${i.name}}}`}</code></span><span class="text-base-content/60">{i.ok ? t("mailTemplates.req.ok") : t("mailTemplates.req.missing")}</span></li>)}</ul>
          )}
        </div>
      </span>
      {live}
    </>
  );
}
const checklistAttrs = (base: string) => ({ "hx-post": `${base}/preview`, "hx-include": "#tpl-form", "hx-vals": JSON.stringify({ part: "checklist" }), "hx-target": "#req-wrap", "hx-swap": "outerHTML" });

// Markierung (\u0001name\u0002) aus customPreviewVars → hervorgehobener Platzhalter (Hintergrund + Text, nicht nur Farbe)
const highlight = (s: string) => s.split(/\u0001([^\u0002]*)\u0002/).map((part, i) => (i % 2 ? <mark class="bg-warning text-warning-content px-1 rounded font-semibold">{`{{${part}}}`}</mark> : part));

function Editor({ user, back, tpl, values, errors, expected, conflict, cf }: { user: Variables["user"]; back: string; tpl: TemplateView; values: { subject: string; body: string }; errors: string[]; expected: string; conflict?: boolean; cf?: CustomForm }) {
  const key = tpl.key;
  const entry = cf
    ? { name: cf.name || t("mailTemplates.new"), description: cf.description, category: "custom", vars: customVars(cf.fields), required: [] as { name: string; list?: string; label: string }[], previewCases: [{ id: "default", label: t("mailTemplates.preview") }] }
    : CATALOG[key];
  const base = cf?.isNew ? "/mail/templates/new" : `/mail/templates/${key}`;
  const requiredNames = new Set(entry.required.map((r) => (r.list ? `${r.list}[].${r.name}` : r.name)));
  const reqStatus = requiredStatus(cf ? "" : key, { prefix: tpl.prefix, subject: values.subject, body: values.body, urgent: cf?.urgent });
  const phData = Object.entries(entry.vars).map(([name, v]) => ({ name, desc: v.desc, example: v.example, optional: !!v.optional, type: v.type, group: groupOf(name, v, !!cf), list: name.includes("[]") || v.type === "list", required: requiredNames.has(name) }));
  const bodyErr = errors.filter((e) => !e.startsWith("subject:") && !e.startsWith("form: ") && !e.startsWith("headers: "));
  return (
    <Layout title={entry.name} user={user}>
      <div class="max-w-5xl mx-auto">
        <PageHeader
          title={cf?.isNew ? t("mailTemplates.new") : entry.name} backHref={back} backLabel={back === "/mail/templates" ? undefined : t("mailTemplates.back")} subtitle={entry.description}
          actions={<>
            {tpl.override && <HeaderAction icon="icon-[tabler--arrow-back-up]" label={t("mailTemplates.reset")} class="btn-outline" onclick="document.getElementById('reset-dialog').showModal()" />}
            {cf && !cf.isNew && maySend(user) && <HeaderAction icon="icon-[tabler--mail]" label={t("mailTemplates.send")} href={`/mail/templates/${key}/send${fromQs(back)}`} />}
            {cf && !cf.isNew && <HeaderAction icon="icon-[tabler--trash]" label={t("mailTemplates.delete")} class="btn-outline btn-error" onclick="document.getElementById('delete-dialog').showModal()" />}
            <FormActions formId="tpl-form" />
          </>}
        />
        {cf ? (!cf.isNew && tpl.custom && <p class="mb-4">{t("mailTemplates.state.own", stamp(tpl.custom))}</p>)
          : tpl.override ? <p class="mb-4">{t("mailTemplates.status.custom", stamp(tpl.override))}</p> : <div role="status" class="alert alert-info alert-soft mb-4">{t("mailTemplates.status.system")}</div>}
        {errors.length > 0 && <div role="alert" class="alert alert-error mb-4"><ul>{errors.map((e) => <li>{e.replace(/^(form|subject|body|prefix|headers): /, "")}</li>)}</ul></div>}
        {conflict && <div role="alert" class="alert alert-error mb-4"><span>{t("mailTemplates.conflict")} <a class="link" href={`/mail/templates/${key}`}>{t("mailTemplates.conflict.reload")}</a></span></div>}
          <form id="tpl-form" method="post" action={`${base}${fromQs(back)}`} class="space-y-4 min-w-0">
            <input type="hidden" name="updatedAt" value={expected} />
              <details id="tpl-meta" open={!!cf?.isNew || errors.some((e) => e.startsWith("form: ") || e.startsWith("headers: "))} data-err={errors.some((e) => e.startsWith("form: ") || e.startsWith("headers: ")) ? "1" : undefined} class="collapse collapse-arrow bg-base-200 border border-base-300 rounded-box">
                <summary class="collapse-title font-semibold"><span class="flex items-center gap-2">{t("mailTemplates.section.meta")}<span id="tpl-meta-warn" hidden class="badge badge-error badge-soft"><Icon name="icon-[tabler--alert-triangle]" class="h-4 w-4" />{t("mailTemplates.section.meta.missing")}</span></span></summary>
                <div class={`collapse-content grid gap-6 ${cf ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]" : ""}`}>
                  {cf && <div class="space-y-4 min-w-0">
              <Field label={t("mailTemplates.custom.name")} required><input id="tpl-name" name="name" class="input w-full" placeholder={t("mailTemplates.custom.name")} value={cf.name} required /></Field>
              <Field label={t("mailTemplates.custom.description")}><input name="description" class="input w-full" placeholder={t("mailTemplates.custom.description")} value={cf.description} /></Field>
              {cf.isNew ? <>
                <Field label={t("mailTemplates.custom.key")} required hint={t("mailTemplates.custom.key.hint")}><input id="tpl-key" name="key" class="input w-full font-mono" placeholder={t("mailTemplates.custom.key")} value={cf.key} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength={60} required /></Field>
                <Field label={t("mailTemplates.custom.topic")} required hint={t("mailTemplates.custom.topic.hint")}>
                  <input name="topic" list="tpl-topics" class="input w-full font-mono" placeholder={t("mailTemplates.custom.topic")} value={cf.topic} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength={60} required />
                  <datalist id="tpl-topics">{cf.topics.map((x) => <option value={x} />)}</datalist>
                </Field>
                <FieldGroup legend={t("mailTemplates.technical.audience")}>
                  <div class="join">{AUDIENCES.map((a) => <input type="radio" name="audience" value={a} class="join-item btn" aria-label={T(`mailTemplates.audience.${a}`)} checked={cf.audience === a} required />)}</div>
                </FieldGroup>
                <div>
                  {/* div statt label: ein label würde Klicks an den ersten Chip-Entfernen-Button weiterreichen */}
                  <div class="floating-label w-full">
                    <span>{t("mailTemplates.custom.permissions")}<span class="text-error ml-1">*</span></span>
                    <PermissionPicker name="editPermissions" options={cf.grantable} values={cf.perms} required />
                  </div>
                  <p class="label text-xs opacity-70 whitespace-normal">{t("mailTemplates.custom.permissions.hint")}</p>
                </div>
              </> : null}
              <label class="label cursor-pointer justify-start gap-2"><input type="checkbox" name="urgent" value="1" class="toggle toggle-primary" checked={cf.urgent} disabled={!user.permissions.has("system:admin")} />{t("mailTemplates.custom.urgent")}</label>
              <p class="label text-xs opacity-70 whitespace-normal -mt-3">{t("mailTemplates.custom.urgent.hint")}</p>
              {cf.fields.length > 0 && (
                <div>
                  <h2 class="font-semibold mb-1">{t("mailTemplates.custom.fields")}</h2>
                  <p class="text-sm opacity-70 mb-2">{t("mailTemplates.custom.fields.hint")}</p>
                  <div class="overflow-x-auto"><table class="table table-sm">
                    <tbody>{cf.fields.map((f) => (
                      <tr><td><code>{`{{${f.name}}}`}</code></td>
                        <td><input name={`fl_${f.name}`} class="input w-full" value={f.label ?? ""} placeholder={fieldLabel(f.name)} aria-label={`${f.name}: ${t("mailTemplates.custom.fields.label")}`} /></td>
                        <td><input name={`fe_${f.name}`} class="input w-full font-mono" value={f.example ?? ""} aria-label={`${f.name}: ${t("mailTemplates.custom.fields.example")}`} /></td></tr>
                    ))}</tbody>
                  </table></div>
                </div>
              )}
                  </div>}
                  <div class="space-y-4 min-w-0 lg:border-l lg:border-base-300 lg:pl-6">
                    <h3 class="font-semibold">{t("mailTemplates.technical")}</h3>
              <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
                <dt class="opacity-60">{t("mailTemplates.technical.category")}</dt><dd>{T(`mail.type.${entry.category}`)}</dd>
                <dt class="opacity-60">{t("mailTemplates.technical.audience")}</dt><dd>{T(`mailTemplates.audience.${tpl.audience}`)}</dd>
                <dt class="opacity-60">{t("mailTemplates.technical.prefix")}</dt><dd>{cf || !tpl.prefix ? "–" : <code class="font-mono">{tpl.prefix}</code>}</dd>
              </dl>
              <div class="space-y-2">
                <div class="@container flex items-center justify-between gap-2">
                  <h4 class="text-sm opacity-60">{t("mailTemplates.technical.headers")}</h4>
                  {cf && <button type="button" class="btn btn-outline btn-xs" aria-label={t("mailTemplates.custom.headers.add")} title={t("mailTemplates.custom.headers.add")} onclick="document.getElementById('hdr-rows').appendChild(document.getElementById('hdr-tpl').content.cloneNode(true))"><Icon name="icon-[tabler--plus]" class="h-3 w-3" /><span class="hidden @xs:inline">{t("mailTemplates.custom.headers.add")}</span></button>}
                </div>
                {[["Category", tpl.category], ["Event", cf ? `custom-${cf.key || tpl.key}` : tpl.key], ["Audience", tpl.audience]].map(([n, v]) => (
                  <code class="block font-mono text-xs bg-base-200 rounded-field px-2 py-1 break-all">X-On-Duty-{n}: {v}</code>
                ))}
                {cf && <>
                  <div id="hdr-rows" class="space-y-2">{headerRows(cf.headers).map(([n, v]) => <HeaderRow n={n} v={v} />)}</div>
                  <template id="hdr-tpl"><HeaderRow n="" v="" /></template>
                  <p id="err-headers" class="text-error text-sm">{errors.filter((e) => e.startsWith("headers: ")).map((e) => e.replace(/^headers: /, "")).join(" ")}</p>
                </>}
              </div>
                  </div>
                </div>
              </details>
        <div role="tablist" class="tabs tabs-lift">
          <input form="none" type="radio" name="tpl-tabs" class="tab" aria-label={t("common.edit")} data-tab="edit" checked {...checklistAttrs(base)} />
          <div class="tab-content bg-base-100 border-base-300 p-4">
            <div id="tpl-bar" role="toolbar" aria-label={t("mailTemplates.bar")} class="sticky top-0 z-10 -mx-4 -mt-4 mb-4">
              <div class="flex items-center gap-1 rounded-t-box rounded-tl-none border-b border-base-300 bg-base-200 px-4 py-2">
                <button type="button" id="ph-btn" class="btn btn-ghost btn-sm" popovertarget="side-ph" style="anchor-name:--ph-btn" aria-expanded="false" aria-controls="side-ph" title={t("mailTemplates.placeholders")}><Icon name="icon-[tabler--plus]" class="h-4 w-4" /><span class="max-sm:hidden">{t("mailTemplates.placeholders")}</span></button>
                <RequiredChecklist status={reqStatus} />
                <span class="ml-auto text-xs text-base-content/60 max-sm:hidden">{t("mailTemplates.bar.hint")} <kbd class="kbd kbd-xs">{"{{"}</kbd></span>
              </div>
              <div id="side-ph" popover="auto" style="position-anchor:--ph-btn" aria-label={t("mailTemplates.placeholders")} class="dropdown w-[min(calc(100vw-1rem),48rem)] max-h-[70vh] overflow-auto rounded-box border border-base-300 bg-base-100 px-2 pb-2 pt-0 space-y-2 text-sm shadow-xl">
              <div class="sticky top-0 z-10 -mx-2 bg-base-100 px-2 py-2"><input id="ph-search" type="search" class="input input-sm w-full" placeholder={t("mailTemplates.search")} aria-label={t("mailTemplates.search")} autocomplete="off" /></div>
              <p class="px-1 text-xs text-base-content/60">{t("mailTemplates.insertHint")}</p>
              <p id="ph-empty" class="hidden text-base-content/60 p-1" role="status">{t("mailTemplates.search.empty")}</p>
              {GROUPS.map((g) => {
                const listName = Object.entries(entry.vars).find(([, v]) => v.type === "list")?.[0];
                const inList = (k: string) => !!listName && k.startsWith(`${listName}[].`);
                const entries = Object.entries(entry.vars).filter(([, v]) => v.type !== "list");
                const items = entries.filter(([k, v]) => !inList(k) && !(listName && k.startsWith("recipient.")) && groupOf(k, v, !!cf) === g);
                const listItems = g === "recipient" && listName ? entries.filter(([k]) => inList(k)) : [];
                // Eine Zeile je Platzhalter: Beschriftung + Beispielwert (Textwerte) links, Token rechts (bei Hover/Fokus), optional ein „nur wenn“-Button.
                const plus = <span aria-hidden="true" class="grid size-6 shrink-0 place-items-center rounded-full bg-primary/25 text-primary"><Icon name="icon-[tabler--plus]" class="h-3.5 w-3.5" /></span>;
                const row = (k: string, v: { desc: string; example?: string; optional?: boolean; type: string }, label: string, attrs: Record<string, string | undefined>, hov = "hover:bg-base-200 focus-within:bg-base-200") => {
                  const bool = v.type === "boolean", cond = (v.optional || bool) && !requiredNames.has(k);
                  const star = requiredNames.has(k) ? " *" : "";
                  return (
                    <li data-s={`${k} ${v.desc} ${v.example}`} data-k={k} data-d={v.desc} data-e={v.example || undefined} class={`group flex flex-wrap items-center gap-x-1 rounded-field active:bg-primary/20 ${hov}`}>
                      {bool && cond ? (
                        <button type="button" class="btn btn-ghost btn-sm h-auto min-h-11 min-w-0 flex-1 max-sm:basis-full justify-start gap-2 text-left whitespace-normal py-1.5 font-normal" data-cond={k} data-bool="1" title={t("mailTemplates.onlyIfTrue.tip")}>{plus}<span>{t("mailTemplates.onlyIfBool")}: {label}</span></button>
                      ) : (
                        <button type="button" class="btn btn-ghost btn-sm h-auto min-h-11 min-w-0 flex-1 max-sm:basis-full justify-start gap-2 text-left whitespace-normal py-1.5 font-normal" {...attrs}>
                          {plus}
                          <span class="flex min-w-0 flex-col items-start">
                            <span>{label}{star}{v.optional && <span class="text-base-content/60"> ({t("mailTemplates.optional")})</span>}</span>
                            {!bool && v.example && <span class="max-w-full truncate text-xs text-base-content/60">{v.example}</span>}
                          </span>
                        </button>
                      )}
                      <span class="ml-auto flex shrink-0 items-center gap-1 max-sm:basis-full max-sm:justify-between max-sm:pb-1 max-sm:pl-11 max-sm:pr-1">
                        <code class="max-w-44 truncate font-mono text-xs text-base-content/60 sm:max-w-none">{`{{${attrs["data-inner"] ?? k}}}`}</code>
                        {!bool && cond && v.optional && <button type="button" class="btn btn-outline btn-xs min-h-10" data-cond={k} title={t("mailTemplates.onlyIfPresent.tip")}>{t("mailTemplates.onlyIfShort")}</button>}
                      </span>
                    </li>
                  );
                };
                return (items.length > 0 || listItems.length > 0) && (
                  <section data-g>
                    <h3 class="sticky top-12 z-[5] bg-base-100 px-1 pb-1 pt-1 text-xs font-bold uppercase tracking-wide text-base-content/60">{t(`mailTemplates.group.${g}`)}</h3>
                    <ul class="divide-y divide-base-300/40 p-1">
                      {items.map(([k, v]) => row(k, v, v.desc, { "data-ph": k }))}
                      {listName && listItems.length > 0 && (
                        <li data-sub class="mt-2 rounded-box bg-base-200 p-1 space-y-1">
                          <h4 class="px-1 text-xs font-semibold">{t("mailTemplates.listHeading")}</h4>
                          <p class="px-1 text-xs text-base-content/60">{t("mailTemplates.listHint")}</p>
                          <ul class="divide-y divide-base-300/40">
                            <li data-s={`${listName} ${t("mailTemplates.repeat")}`} class="group flex items-center gap-1 rounded-field active:bg-primary/20 hover:bg-base-100 focus-within:bg-base-100">
                              <button type="button" class="btn btn-ghost btn-sm h-auto min-h-11 min-w-0 flex-1 max-sm:basis-full justify-start gap-2 text-left whitespace-normal py-1.5 font-normal" data-cond={listName} title={listName}>{plus}<span>{t("mailTemplates.repeat")}</span></button>
                              <code class="shrink-0 font-mono text-xs text-base-content/60">{`{{#${listName}}}`}</code>
                            </li>
                            {listItems.map(([k, v]) => { const inner = k.slice(listName.length + 3); return row(k, { ...v, optional: false }, t(`mailTemplates.listItem.${inner}` as "mailTemplates.listItem.name"), { "data-li": listName, "data-inner": inner }, "hover:bg-base-100 focus-within:bg-base-100"); })}
                          </ul>
                        </li>
                      )}
                    </ul>
                  </section>
                );
              })}
            </div>
            </div>
        <div id="pane-edit" class="grid gap-4 md:grid-rows-[minmax(0,1fr)]">
        <div class="space-y-4 min-w-0 pt-2 md:overflow-y-auto">
            <Field label={t("mailTemplates.field.subject")} required after={errors.filter((e) => e.startsWith("subject:")).map((e) => <p id="err-subject" class="text-error text-sm">{e.replace(/^subject: /, "")}</p>)}>
              <label class="input w-full font-mono gap-1">{!cf && tpl.prefix ? <span class="text-base-content/60 shrink-0">{tpl.prefix}</span> : null}<input id="tpl-subject" name="subject" autocomplete="off" placeholder={t("mailTemplates.field.subject")} value={values.subject} required aria-describedby={errors.some((e) => e.startsWith("subject:")) ? "err-subject" : undefined} /></label>
            </Field>
            <Field label={t("mailTemplates.field.body")} required after={bodyErr.map((e) => <p id="err-body" class="text-error text-sm">{e.replace(/^(body|prefix): /, "")}</p>)}>
              <textarea id="tpl-body" name="body" hx-trigger="change" {...checklistAttrs(base)} autocomplete="off" rows={18} class="textarea w-full max-w-full resize-y font-mono" placeholder={t("mailTemplates.field.body")} required aria-describedby={bodyErr.length ? "err-body" : undefined}>{values.body}</textarea>
            </Field>
        </div>
        </div>
          </div>
          {entry.previewCases.length > 1 && <input form="none" type="radio" name="tpl-tabs" class="tab" aria-label={t("mailTemplates.preview")} data-tab="entry" />}
          {entry.previewCases.map((x) => (
            <>
              <input form="none" type="radio" name="tpl-tabs" class={entry.previewCases.length > 1 ? "tab hidden text-secondary checked:font-semibold [--tab-bg:var(--color-base-200)] [--tab-border-color:var(--color-secondary)]" : "tab"} aria-label={entry.previewCases.length > 1 ? x.label : t("mailTemplates.preview")} data-tab="preview" data-case={x.id} hx-post={`${base}/preview`} hx-include="#tpl-form" hx-vals={JSON.stringify({ case: x.id })} hx-target={`#preview-${x.id}`} />
              <div class="tab-content bg-base-100 border-secondary p-4"><div id={`preview-${x.id}`} /></div>
            </>
          ))}
        </div>
        </form>
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

async function readCustom(c: any, current?: boolean) {
  const f = await c.req.parseBody({ all: true });
  const one = (k: string) => String(asArray(f[k])[0] ?? "");
  const subject = one("subject").trim(), body = one("body").replace(/\r\n/g, "\n"), prefix = "";
  const fields = customFields({ prefix, subject, body }).map((name) => ({ name, label: one(`fl_${name}`).trim() || undefined, example: one(`fe_${name}`).trim() || undefined }));
  return { subject, body, prefix, fields, name: one("name").trim(), description: one("description").trim(), headers: asArray(f.hn).map((n, i) => [n.trim(), String(asArray(f.hv)[i] ?? "").trim()]).filter(([n, v]) => n || v).map(([n, v]) => `${n}: ${v}`).join("\n"), urgent: c.get("user").permissions.has("system:admin") ? one("urgent") === "1" : !!current, key: one("key").trim(), topic: one("topic").trim(), audience: one("audience"), perms: asArray(f.editPermissions), expected: one("updatedAt"), case: one("case"), part: one("part") };
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

const toInput = (d: CustomFormData, tpl: Pick<TemplateView, "audience" | "editPermissions"> & { topic?: string }, isNew: boolean, urgent: boolean): CustomInput => ({
  meta: { name: d.name, ...(d.description ? { description: d.description } : {}), ...(urgent ? { urgent: true } : {}), fields: d.fields } satisfies CustomMeta,
  topic: isNew ? d.topic : tpl.topic!, audience: isNew ? d.audience : tpl.audience, editPermissions: isNew ? d.perms : tpl.editPermissions,
  prefix: d.prefix, subject: d.subject, body: d.body, extraHeaders: parseHeaders(d.headers).headers,
});

async function renderCustom(c: any, tpl: TemplateView, d: CustomFormData | null, isNew: boolean, errors: string[] = [], status?: number) {
  const user = c.get("user");
  const cur = tpl.custom;
  const form: CustomForm = {
    isNew, urgent: d ? d.urgent : !!cur?.meta.urgent, name: d?.name ?? cur?.meta.name ?? "", description: d?.description ?? cur?.meta.description ?? "", prefix: d?.prefix ?? tpl.prefix,
    headers: d?.headers ?? Object.entries(cur?.extraHeaders ? JSON.parse(cur.extraHeaders) : {}).map(([k, v]) => `${k}: ${v}`).join("\n"),
    fields: d?.fields ?? cur?.meta.fields ?? [], key: d?.key ?? tpl.key, topic: d?.topic ?? cur?.topic ?? "", audience: d?.audience ?? tpl.audience,
    perms: d?.perms ?? tpl.editPermissions, topics: isNew ? await listTopics() : [], grantable: grantable(user),
  };
  const values = d ?? (isNew ? { ...tpl.system, subject: "[{{org.name}}] " } : { ...tpl.system, subject: `${tpl.prefix ? `${tpl.prefix} ` : ""}${tpl.system.subject}` });
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
  if ((await createCustom(d.key, toInput(d, tpl, true, d.urgent), user.id)) === "conflict") return renderCustom(c, tpl, d, true, [`form: ${t("mailTemplates.custom.err.keyTaken")}`], HTTP_STATUS.CONFLICT);
  setFlash(c, t("mailTemplates.flash.saved"), "success");
  return c.redirect(`/mail/templates/${d.key}${fromQs(backTo(c.req.query("from")))}`);
});

// Nur Beispieldaten: Felder mit Beispieltext, sonst hervorgehobener Platzhalter.
const previewCustom = async (c: any, current?: boolean) => {
  const d = await readCustom(c, current);
  if (d.part === "checklist") return c.html(<RequiredChecklist status={requiredStatus("", d)} oob />);
  const errors = [...parseHeaders(d.headers).errors, ...validateTemplate("", d)];
  if (errors.length) return c.html(<div role="alert" class="alert alert-error"><ul>{errors.map((e) => <li>{e.replace(/^\w+: /, "")}</li>)}</ul><a class="link" href="#" onclick="document.querySelector('[data-tab=edit]').click();return false">{t("mailTemplates.preview.toEditor")}</a></div>);
  const out = renderMail(d, customPreviewVars(d.fields));
  return c.html(
    <MailPreview subject={out.subject} text={out.text} />,
  );
};
mailTemplateRoutes.post("/new/preview", async (c) => { requireCreate(c.get("user")); return previewCustom(c); });

// Mitgliedersuche für die Einzelauswahl; wer freie Vorlagen versenden darf, darf suchen.
mailTemplateRoutes.get("/search-members", async (c) => {
  if (!maySend(c.get("user"))) return forbidden();
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.html("");
  const needle = `%${q}%`;
  const rows = await db.select({ id: members.id, firstName: persons.firstName, lastName: persons.lastName }).from(members)
    .innerJoin(persons, eq(persons.id, members.personId))
    .where(and(or(ilike(persons.firstName, needle), ilike(persons.lastName, needle)), isNull(members.exitDate), isNull(members.deathDate)))
    .orderBy(asc(persons.lastName), asc(persons.firstName)).limit(10);
  return c.html(<PickerOptions empty={t("picker.noResults", { query: q })} options={rows.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}` }))} />);
});

// Schnellvorschau aus der Liste: aktueller Text mit Beispieldaten (nur lesen, Recht wie beim Anzeigen/Versenden).
mailTemplateRoutes.get("/:key/quick", async (c) => {
  const user = c.get("user");
  const key = c.req.param("key");
  const tpl = (await listTemplates()).find((x) => x.key === key && (CATALOG[x.key] || x.custom));
  if (!tpl) return notFound();
  if (!(mayEdit(user, tpl.editPermissions) || (tpl.custom && maySend(user)))) return forbidden();
  const cur = tpl.override ?? tpl.system;
  const out = tpl.custom ? renderMail({ prefix: tpl.prefix, ...cur }, customPreviewVars(tpl.custom.meta.fields)) : renderMail({ prefix: tpl.prefix, ...cur }, previewVars(key));
  return c.html(<><h2 class="text-lg font-semibold mb-3">{tpl.custom ? tpl.custom.meta.name : CATALOG[key].name}</h2><MailPreview subject={out.subject} text={out.text} /></>);
});

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
    const d = await readCustom(c, !!tpl.custom.meta.urgent);
    const errors = await customErrors({ ...d, key: tpl.key }, null, false);
    if (errors.length) return renderCustom(c, tpl, d, false, errors, HTTP_STATUS.UNPROCESSABLE_ENTITY);
    if ((await saveCustom(tpl.key, toInput(d, { ...tpl, topic: tpl.custom.topic }, false, d.urgent), user.id, d.expected)) === "conflict") return renderCustom(c, tpl, d, false, [], HTTP_STATUS.CONFLICT);
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
  if (tpl.custom) return previewCustom(c, !!tpl.custom.meta.urgent);
  const f = await c.req.parseBody();
  const { subject, body } = await readForm(c);
  const cases = CATALOG[tpl.key].previewCases;
  const caseId = cases.find((x) => x.id === String(f.case ?? ""))?.id ?? cases[0].id;
  if (f.part === "checklist") return c.html(<RequiredChecklist status={requiredStatus(tpl.key, { prefix: tpl.prefix, subject, body })} oob />);
  const errors = validateTemplate(tpl.key, { prefix: tpl.prefix, subject, body });
  // strukturiert: Zeile aus der Meldung
  const issues = errors.map((e) => ({ line: /Zeile (\d+)/.exec(e)?.[1], missing: e.startsWith("Pflichtplatzhalter"), text: e.replace(/^\w+: /, "") }));
  const missing = requiredStatus(tpl.key, { prefix: tpl.prefix, subject, body }).items.filter((r) => !r.ok).map((r) => r.name);
  if (errors.length) return c.html(<div role="alert" class="alert alert-error" data-missing={missing.join(",")}><ul>{issues.map((i) => <li data-line={i.line}>{i.text}</li>)}</ul><a class="link" href="#" onclick="document.querySelector('[data-tab=edit]').click();return false">{t("mailTemplates.preview.toEditor")}</a></div>);
  const out = renderMail({ prefix: tpl.prefix, subject, body }, previewVars(tpl.key, caseId));
  return c.html(
    <MailPreview subject={out.subject} text={out.text} />,
  );
});

mailTemplateRoutes.post("/:key/delete", async (c) => {
  const tpl = await load(c.get("user"), c.req.param("key"));
  if (!tpl.custom) return notFound();
  if (isSending(tpl.key)) { setFlash(c, t("mailTemplates.delete.busy"), "error"); return c.redirect(`/mail/templates/${tpl.key}${fromQs(backTo(c.req.query("from")))}`); }
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

// ---- Manueller Versand (Backlog 156): Recht = editPermissions, alle Felder Pflicht ----------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["active", "youth", "children", "passive", "supporting"] as const;
// „Alle“ (status=all) ist exklusiv und entspricht der leeren Auswahl.
const readSelection = (f: Record<string, unknown>) => asArray(f.status).includes("all") ? { statuses: [], roleIds: [], memberIds: [] } : ({ statuses: asArray(f.status).filter((x) => (STATUSES as readonly string[]).includes(x)), roleIds: asArray(f.role).filter((x) => UUID_RE.test(x)), memberIds: asArray(f.member).filter((x) => UUID_RE.test(x)) });

// Ein Formular: Änderung der Auswahl lädt per GET neu (Zähler, Feldwerte bleiben in der Query), „Versenden“ sendet per POST.
async function sendForm(c: any, tpl: TemplateView, values: Record<string, string>, sel: ReturnType<typeof readSelection>, errors: string[] = [], status?: number) {
  const back = backTo(c.req.query("from"));
  const meta = tpl.custom!.meta;
  const recipients = await customRecipients(tpl.custom!.topic, sel, !!meta.urgent);
  const counts = { ...countRecipients(recipients), ...countMails(recipients) };
  const roles = await db.select({ id: memberRoles.id, title: memberRoles.title }).from(memberRoles).orderBy(asc(memberRoles.sortOrder));
  const picked = sel.memberIds.length
    ? await db.select({ id: members.id, firstName: persons.firstName, lastName: persons.lastName }).from(members).innerJoin(persons, eq(persons.id, members.personId)).where(inArray(members.id, sel.memberIds))
    : [];
  const smtp = isSmtpConfigured();
  const action = `/mail/templates/${tpl.key}/send${fromQs(back)}`;
  return c.html(
    <Layout title={meta.name} user={c.get("user")}>
      <div class="max-w-2xl mx-auto">
        <PageHeader title={T("mailTemplates.send.title", { name: meta.name })} backHref={`/mail/templates/${tpl.key}${fromQs(back)}`}
          actions={<>
            <HeaderAction icon="icon-[tabler--mailbox]" label={t("mailTemplates.log")} href={`/mail/templates/${tpl.key}/log${fromQs(back)}`} />
            <HeaderAction variant="primary" class="btn-primary" icon="icon-[tabler--mail]" label={t("mailTemplates.send")} form="send-form" attrs={{ formmethod: "post", ...(!smtp || !counts.send ? { disabled: "" } : {}) }} onclick={`return confirm(${JSON.stringify(T("mailTemplates.send.confirm", { send: counts.send, mails: counts.mails }))})`} />
          </>} />
        {errors.length > 0 && <div role="alert" class="alert alert-error mb-4"><ul>{errors.map((e) => <li>{e}</li>)}</ul></div>}
        {!smtp && <div role="alert" class="alert alert-warning mb-4">{t("mailTemplates.send.noSmtp")}</div>}
        <form id="send-form" method="get" action={action} class="space-y-4" onchange="if(event.target.closest('[data-sel]'))this.submit()">
          {back !== "/mail/templates" && <input type="hidden" name="from" value={back} />}
          <FieldGroup legend={t("mailTemplates.send.selection")}>
            <p class="text-sm opacity-70">{meta.urgent ? t("mailTemplates.send.urgent") : t("mailTemplates.send.selection.hint")}</p>
            <div class="join flex-wrap" data-sel>
              <input type="checkbox" name="status" value="all" class="join-item btn btn-sm" aria-label={t("mailTemplates.send.all")} checked={!sel.statuses.length && !sel.roleIds.length && !sel.memberIds.length} />
              {STATUSES.map((st) => <input type="checkbox" name="status" value={st} class="join-item btn btn-sm" aria-label={T(`status.${st}`)} checked={sel.statuses.includes(st)} />)}
            </div>
            {roles.length > 0 && <ChipInput name="role" label={t("mailTemplates.send.roles")} placeholder={t("mailTemplates.send.rolesPlaceholder")} values={sel.roleIds} presets={roles.map((r) => ({ key: r.id, label: r.title, badge: "badge-outline" }))} presetButtons={false} suggestionsFrom="#role-suggestions" caseSensitive={false} />}
            <script type="application/json" id="role-suggestions" dangerouslySetInnerHTML={{ __html: tagSuggestionsJson(roles.map((r) => r.title)) }} />
            <EntityPicker multiple name="member" searchUrl="/mail/templates/search-members" label={t("mailTemplates.send.members")} placeholder={t("events.form.membersSearch")} selected={picked.map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}` }))} />
          </FieldGroup>
          <script dangerouslySetInnerHTML={{ __html: SEND_SCRIPT }} />
          <div class="stats stats-vertical sm:stats-horizontal bg-base-200 w-full" role="status">
            {(["send", "mails", "noEmail", "optedOut"] as const).map((k) => (
              <div class="stat px-4 py-2">
                <div class="stat-title text-xs whitespace-normal">{t(`mailTemplates.send.stats.${k}`)}</div>
                <div class="stat-value text-2xl">{counts[k]}</div>
              </div>
            ))}
          </div>
          {meta.fields.map((f) => (
            <Field label={f.label || fieldLabel(f.name)} required>
              <textarea name={`f_${f.name}`} rows={3} class="textarea w-full" required placeholder={f.label || fieldLabel(f.name)}>{values[f.name] ?? f.example ?? ""}</textarea>
            </Field>
          ))}
          <div role="tablist" class="tabs tabs-lift">
            {(["default", "multiple"] as const).map((id) => (
              <>
                <input type="radio" name="case" value={id} class="tab text-secondary checked:font-semibold [--tab-bg:var(--color-base-200)] [--tab-border-color:var(--color-secondary)]" aria-label={t(`mailTemplates.case.${id}`)} checked={(c.req.query("case") ?? "default") === id} />
                <div class="tab-content bg-base-100 border-secondary p-4">
                  <div id={`send-preview-${id}`} hx-post={`/mail/templates/${tpl.key}/send/preview`} hx-include="closest form" hx-vals={JSON.stringify({ case: id })} hx-trigger="load, input delay:300ms from:closest form" />
                </div>
              </>
            ))}
          </div>
        </form>
      </div>
    </Layout>, status);
}

// Änderung der Chips (Funktionen oder Mitglieder) lädt neu (Zähler).
// „Alle“ ist exklusiv: wer etwas anderes wählt, nimmt „Alle“ heraus; „Alle“ wählen leert die Statusgruppen (Funktionen/Personen verwirft der Server).
const SEND_SCRIPT = `(function(){var f=document.currentScript.closest('form');
var all=f.querySelector('input[name=status][value=all]');
function other(){all.checked=false;f.submit();}
f.addEventListener('chip:change',other);f.addEventListener('picker:change',other);
f.addEventListener('change',function(e){var t=e.target;if(t.name!=='status')return;
if(t===all){all.checked=true;f.querySelectorAll('input[name=status]:not([value=all])').forEach(function(i){i.checked=false;});}else all.checked=false;},true);})();`; // Capture: muss vor dem onchange-Submit des Formulars laufen

const readValues = (tpl: TemplateView, f: Record<string, unknown>) =>
  Object.fromEntries(tpl.custom!.meta.fields.map((x) => [x.name, String(asArray(f[`f_${x.name}`])[0] ?? "").replace(/\r\n/g, "\n").trim()]));

mailTemplateRoutes.get("/:key/send", async (c) => {
  const tpl = await load(c.get("user"), c.req.param("key"), true);
  const q = c.req.queries();
  return sendForm(c, tpl, readValues(tpl, q), readSelection(q));
});

// Vorschau mit den eingetragenen Werten (echte Eingaben, Beispieldaten für den Empfänger).
mailTemplateRoutes.post("/:key/send/preview", async (c) => {
  const tpl = await load(c.get("user"), c.req.param("key"), true);
  const f = await c.req.parseBody({ all: true });
  const values = readValues(tpl, f);
  const vars = customPreviewVars([]);
  if (f.case === "multiple") { vars.multiple = true; vars.you = t("mail.event.you.many"); }
  for (const x of tpl.custom!.meta.fields) vars[x.name] = values[x.name] || `\u0001${x.name}\u0002`; // leer: hervorgehoben
  if (tpl.custom!.meta.urgent) vars.unsubscribeUrl = "";
  const out = renderMail({ prefix: tpl.prefix, ...tpl.system }, vars);
  return c.html(<MailPreview subject={out.subject} text={out.text} />);
});

mailTemplateRoutes.post("/:key/send", async (c) => {
  const tpl = await load(c.get("user"), c.req.param("key"), true);
  const f = await c.req.parseBody({ all: true });
  const values = readValues(tpl, f), sel = readSelection(f);
  const fail = (msg: string, status: number) => sendForm(c, tpl, values, sel, [msg], status);
  if (Object.values(values).some((v) => !v)) return fail(t("mailTemplates.send.missing"), HTTP_STATUS.UNPROCESSABLE_ENTITY);
  if (!isSmtpConfigured()) return fail(t("mailTemplates.send.noSmtp"), HTTP_STATUS.UNPROCESSABLE_ENTITY);
  const res = await startCustomMail(tpl.key, values, sel, !!tpl.custom!.meta.urgent);
  if (res === "busy") return fail(t("mailTemplates.send.busy"), HTTP_STATUS.CONFLICT);
  if (res === "invalid") return fail(t("mailTemplates.send.invalid"), HTTP_STATUS.UNPROCESSABLE_ENTITY);
  if (res === "none") return fail(t("mailTemplates.send.noRecipients"), HTTP_STATUS.UNPROCESSABLE_ENTITY);
  setFlash(c, T("mailTemplates.send.started", { count: res }), "success");
  return c.redirect(`/mail/templates/${tpl.key}${fromQs(backTo(c.req.query("from")))}`);
});

// Versandprotokoll der Vorlage: Zähler und die letzten Einträge je Person (mail_log trägt nur den key).
mailTemplateRoutes.get("/:key/log", async (c) => {
  const tpl = await load(c.get("user"), c.req.param("key"), true);
  const back = backTo(c.req.query("from"));
  const where = eq(mailLog.template, tpl.key);
  const [rows, totals] = await Promise.all([
    db.select({ status: mailLog.status, at: mailLog.sentAt, firstName: persons.firstName, lastName: persons.lastName }).from(mailLog)
      .innerJoin(persons, eq(persons.id, mailLog.personId)).where(where).orderBy(desc(mailLog.sentAt)).limit(200),
    db.select({ status: mailLog.status, n: sql<number>`count(*)::int` }).from(mailLog).where(where).groupBy(mailLog.status),
  ]);
  const n = (s: string) => totals.find((x) => x.status === s)?.n ?? 0;
  const tz = resolveTimezone(c), locale = resolveLocale();
  return c.html(
    <Layout title={tpl.custom!.meta.name} user={c.get("user")}>
      <div class="max-w-2xl mx-auto">
        <PageHeader title={T("mailTemplates.log.title", { name: tpl.custom!.meta.name })} backHref={`/mail/templates/${tpl.key}/send${fromQs(back)}`} />
        <div class="stats stats-vertical sm:stats-horizontal border border-base-300 mb-4">
          <div class="stat"><div class="stat-title">{t("mailTemplates.log.sent")}</div><div class="stat-value text-success">{n("sent")}</div></div>
          <div class="stat"><div class="stat-title">{t("mailTemplates.log.failed")}</div><div class="stat-value text-error">{n("failed")}</div></div>
        </div>
        {!rows.length ? <p class="opacity-70">{t("mailTemplates.log.empty")}</p> : (
          <div class="overflow-x-auto"><table class="table table-zebra w-full">
            <tbody>{rows.map((r) => (
              <tr><td>{formatDateTime(r.at, tz, locale)}</td><td>{r.firstName} {r.lastName}</td>
                <td><span class={`badge badge-sm ${r.status === "sent" ? "badge-success" : "badge-error"}`}>{T(`mailTemplates.log.${r.status}`)}</span></td></tr>
            ))}</tbody>
          </table></div>
        )}
        {rows.length === 200 && <p class="text-sm opacity-60 mt-2">{t("mailTemplates.log.limit")}</p>}
      </div>
    </Layout>,
  );
});
