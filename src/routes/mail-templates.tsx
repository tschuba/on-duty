import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { Layout } from "../components/layout.js";
import { FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { HTTP_STATUS } from "../lib/constants.js";
import { setFlash } from "../lib/flash.js";
import { formatDay } from "../lib/datetime.js";
import { env } from "../env.js";
import { CATALOG, buildVars, mayEdit, renderMail, validateTemplate, type MailRecipient, type VarSpec } from "../lib/mail-templates.js";
import { listTemplates, resetOverride, saveOverride, type TemplateView } from "../lib/mail-template-store.js";
import { t } from "../i18n/index.js";
import { Icon } from "../components/icon.js";
import { Field } from "../components/field.js";

export const mailTemplateRoutes = new Hono<{ Variables: Variables }>();
mailTemplateRoutes.use("*", requireAuth()); // Recht je Vorlage wird im Handler geprüft

const T = (k: string, p?: Record<string, string | number>) => t(k as never, p);
const forbidden = () => { throw new HTTPException(HTTP_STATUS.FORBIDDEN); };
const notFound = () => { throw new HTTPException(HTTP_STATUS.NOT_FOUND); };

async function editable(user: Variables["user"]): Promise<TemplateView[]> {
  return (await listTemplates()).filter((x) => CATALOG[x.key] && mayEdit(user, x.editPermissions));
}
async function load(user: Variables["user"], key: string): Promise<TemplateView> {
  const tpl = (await listTemplates()).find((x) => x.key === key && CATALOG[x.key]);
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
  const groups = [...new Set(list.map((x) => CATALOG[x.key].category))];
  return c.html(
    <Layout title={t("mailTemplates.title")} user={user}>
      <div class="max-w-4xl mx-auto">
        <PageHeader title={t("mailTemplates.title")} />
        {!list.length && <p class="opacity-70">{t("mailTemplates.empty")}</p>}
        {groups.map((g) => (
          <section class="mb-6">
            <h2 class="text-lg font-semibold mb-2">{T(`mail.type.${g}`)}</h2>
            <div class="overflow-x-auto">
              <table class="table table-zebra w-full">
                <thead><tr><th>{t("mailTemplates.col.name")}</th><th>{t("mailTemplates.col.state")}</th></tr></thead>
                <tbody>
                  {list.filter((x) => CATALOG[x.key].category === g).map((x) => (
                    <tr class="cursor-pointer hover" onclick={`location.href='/mail/templates/${x.key}'`}>
                      <td>
                        <a href={`/mail/templates/${x.key}`} class="font-medium link link-hover">{CATALOG[x.key].name}</a>
                        <div class="text-sm opacity-60">{CATALOG[x.key].description}</div>
                      </td>
                      <td>{x.override ? t("mailTemplates.state.custom", stamp(x.override)) : t("mailTemplates.state.system")}</td>
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

const LEAVE_SCRIPT = (msg: string) => `(function(){var f=document.getElementById('tpl-form'),dirty=false,last=f.elements.subject;
f.addEventListener('input',function(){dirty=true});f.addEventListener('submit',function(){dirty=false});
window.addEventListener('beforeunload',function(e){if(dirty){e.preventDefault();e.returnValue=${JSON.stringify(msg)}}});
f.querySelectorAll('input,textarea').forEach(function(el){el.addEventListener('focus',function(){last=el})});
document.querySelectorAll('[data-ph]').forEach(function(b){b.addEventListener('click',function(){var v='{{'+b.dataset.ph+'}}',s=last.selectionStart||0,e=last.selectionEnd||0;
last.setRangeText(v,s,e,'end');if(!md.matches)setPh(false);last.focus();dirty=true})});
var pg=document.getElementById('ph-toggle'),cl=document.getElementById('ph-close'),pane=document.getElementById('pane-edit'),md=matchMedia('(min-width: 768px)');
function setPh(o,save){pane.dataset.open=o;pg.setAttribute('aria-expanded',o);cl.setAttribute('aria-expanded',o);if(!o)side('ph');if(save&&md.matches)try{localStorage.setItem('mailPlaceholders',o)}catch(e){}}
function shut(){setPh(false,true);(md.matches?cl:pg).focus()}
var sv=null;try{sv=localStorage.getItem('mailPlaceholders')}catch(e){}
setPh(md.matches&&sv!=='false');pg.addEventListener('click',function(){setPh(pane.dataset.open!=='true',true)});
document.getElementById('ph-backdrop').addEventListener('click',shut);cl.addEventListener('click',function(){if(md.matches){setPh(pane.dataset.open!=='true',true)}else shut()});
document.getElementById('ph-col').addEventListener('keydown',function(e){if(e.key==='Escape'){e.stopPropagation();shut()}});
function side(n){var t=n==='tech';document.getElementById('side-ph').classList.toggle('hidden',t);document.getElementById('side-tech').classList.toggle('hidden',!t);
document.querySelectorAll('[data-side]').forEach(function(o){o.classList.toggle('tab-active',o.dataset.side===n)})}
document.querySelectorAll('[data-side]').forEach(function(b){b.addEventListener('click',function(){side(b.dataset.side)})});
var se=document.getElementById('ph-search'),nf=function(x){return x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')};
se.addEventListener('input',function(){var q=nf(se.value.trim()),any=false;
document.querySelectorAll('#side-ph section[data-g]').forEach(function(d){var n=0;
d.querySelectorAll('li[data-s]').forEach(function(li){var m=!q||nf(li.dataset.s).indexOf(q)>-1;li.hidden=!m;if(m)n++});
d.hidden=n===0;if(n)any=true});
document.getElementById('ph-empty').classList.toggle('hidden',any)});
se.addEventListener('keydown',function(e){if(e.key==='Escape'&&se.value){e.stopPropagation();se.value='';se.dispatchEvent(new Event('input'))}
if(e.key==='Enter'){e.preventDefault();var v=document.querySelectorAll('#side-ph li[data-s]:not([hidden]) [data-ph]');if(v.length===1)v[0].click()}});
document.querySelectorAll('[data-tab]').forEach(function(b){b.addEventListener('click',function(){var p=b.dataset.tab==='preview';
document.getElementById('pane-edit').classList.toggle('hidden',p);document.getElementById('pane-preview').classList.toggle('hidden',!p);pg.disabled=cl.disabled=p;
document.querySelectorAll('[data-tab]').forEach(function(o){o.classList.toggle('tab-active',o===b)})})})})();`;

const SAMPLE_PEOPLE: MailRecipient[] = [
  { firstName: "Anna", lastName: "Beispiel", email: "anna@example.org", optOutUrl: "https://portal.example.org/o/1", rsvpYesUrl: "https://portal.example.org/r/yes", rsvpNoUrl: "https://portal.example.org/r/no" },
  { firstName: "Ben", lastName: "Beispiel", email: "ben@example.org", optOutUrl: "https://portal.example.org/o/2", rsvpYesUrl: "https://portal.example.org/r/yes", rsvpNoUrl: "https://portal.example.org/r/no" },
];
// Nur Beispieldaten, nie Echtdaten.
const SAMPLE_RECORD = {
  event: { id: "beispiel", title: "Übung Atemschutz", startsAt: new Date("2026-04-12T16:00:00Z"), endsAt: new Date("2026-04-12T18:00:00Z"), allDay: false, location: "Gerätehaus", rsvpEnabled: true, rsvpDeadline: null, maxParticipants: 20 },
  changes: "Ort: Halle → Gerätehaus", optOutAllUrl: "https://portal.example.org/o/all", orgContactEmail: "info@example.org",
  settingsUrl: "https://portal.example.org/link/abc", validMinutes: 30,
};

const GROUPS = ["event", "recipient", "org", "link"] as const;
const groupOf = (k: string, v: VarSpec) =>
  v.source === "link" ? "link" : k.startsWith("event.") ? "event" : k.startsWith("org.") || k === "type" ? "org" : "recipient";

function Editor({ user, back, tpl, values, errors, expected, conflict }: { user: Variables["user"]; back: string; tpl: TemplateView; values: { subject: string; body: string }; errors: string[]; expected: string; conflict?: boolean }) {
  const key = tpl.key, entry = CATALOG[key];
  const bodyErr = errors.filter((e) => !e.startsWith("subject:"));
  return (
    <Layout title={entry.name} user={user}>
      <div class="max-w-5xl mx-auto">
        <PageHeader
          title={entry.name} backHref={back} backLabel={back === "/mail/templates" ? undefined : t("mailTemplates.back")} subtitle={entry.description}
          actions={<>
            {tpl.override && <HeaderAction icon="arrow-uturn-left" label={t("mailTemplates.reset")} class="btn-outline" onclick="document.getElementById('reset-dialog').showModal()" />}
            <FormActions formId="tpl-form" />
          </>}
        />
        {tpl.override ? <p class="mb-4">{t("mailTemplates.status.custom", stamp(tpl.override))}</p> : <div role="status" class="alert alert-info alert-soft mb-4">{t("mailTemplates.status.system")}</div>}
        {conflict && <div role="alert" class="alert alert-error mb-4"><span>{t("mailTemplates.conflict")} <a class="link" href={`/mail/templates/${key}`}>{t("mailTemplates.conflict.reload")}</a></span></div>}
        <div class="flex items-center justify-between gap-2 mb-4">
        <div role="tablist" class="tabs tabs-border">
          <button type="button" role="tab" class="tab tab-active" data-tab="edit">{t("common.edit")}</button>
          <button type="button" role="tab" class="tab" data-tab="preview" hx-post={`/mail/templates/${key}/preview`} hx-include="#tpl-form" hx-target="#preview">{t("mailTemplates.preview")}</button>
        </div>
        <button type="button" id="ph-toggle" class="btn btn-ghost btn-square md:hidden" aria-expanded="false" aria-controls="ph-col" aria-label={t("mailTemplates.sidebar")}><Icon name="sidebar-expand" class="h-5 w-5 text-gold" /></button>
        </div>
        <div id="pane-preview" class="hidden"><div id="preview" /></div>
        <div id="pane-edit" data-open="false" class="group grid gap-4 md:grid-cols-[1fr_3.25rem] md:data-[open=true]:grid-cols-[1fr_22rem] md:data-[open=false]:relative md:data-[open=false]:grid-cols-1">
          <div id="ph-backdrop" class="fixed inset-0 z-40 bg-black/40 md:hidden group-data-[open=false]:hidden" aria-hidden="true" />
          <form id="tpl-form" method="post" action={`/mail/templates/${key}${fromQs(back)}`} class="space-y-4 min-w-0">
            <input type="hidden" name="updatedAt" value={expected} />
            <Field label={t("mailTemplates.field.subject")} required class="md:group-data-[open=false]:pr-12" after={errors.filter((e) => e.startsWith("subject:")).map((e) => <p id="err-subject" class="text-error text-sm">{e.replace(/^subject: /, "")}</p>)}>
              <input id="tpl-subject" name="subject" class="input w-full font-mono" placeholder={t("mailTemplates.field.subject")} value={values.subject} required aria-describedby={errors.some((e) => e.startsWith("subject:")) ? "err-subject" : undefined} />
            </Field>
            <Field label={t("mailTemplates.field.body")} required after={bodyErr.map((e) => <p id="err-body" class="text-error text-sm">{e.replace(/^(body|prefix): /, "")}</p>)}>
              <textarea id="tpl-body" name="body" rows={18} class="textarea w-full font-mono" placeholder={t("mailTemplates.field.body")} required aria-describedby={bodyErr.length ? "err-body" : undefined}>{values.body}</textarea>
            </Field>
          </form>
          <aside id="ph-col" aria-label={t("mailTemplates.placeholders")} class="fixed inset-y-0 right-0 z-50 w-80 max-w-[85vw] overflow-auto bg-base-100 shadow-xl transition-transform group-data-[open=false]:invisible group-data-[open=false]:translate-x-full md:static md:inset-auto md:z-auto md:w-auto md:max-w-none md:self-start md:sticky md:top-32 md:overflow-hidden md:rounded-box md:border md:border-base-300 md:shadow-none md:group-data-[open=false]:visible md:group-data-[open=false]:translate-x-0 md:group-data-[open=false]:absolute md:group-data-[open=false]:-top-px md:group-data-[open=false]:-right-px md:group-data-[open=false]:w-[calc(2.5rem+2px)] md:group-data-[open=false]:border-transparent md:group-data-[open=false]:overflow-visible motion-reduce:transition-none">
            <div class="bg-base-300 flex items-center justify-between gap-1 p-0 md:group-data-[open=false]:justify-center md:group-data-[open=false]:bg-transparent">
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
                const items = Object.entries(entry.vars).filter(([k, v]) => !k.includes("[]") && v.type !== "list" && groupOf(k, v) === g);
                return items.length > 0 && (
                  <section data-g>
                    <h3 class="px-1 pt-1 text-xs font-bold uppercase tracking-wide text-base-content/60">{t(`mailTemplates.group.${g}`)}</h3>
                    <ul class="space-y-1 p-1">
                      {items.map(([k, v]) => (
                        <li data-s={`${k} ${v.desc} ${v.example}`}>
                          <button type="button" class="btn btn-ghost btn-xs h-auto w-full justify-start text-left whitespace-normal flex-col items-start gap-0" data-ph={k} title={k}>
                            <span>+ {v.desc}{v.optional && <span class="text-base-content/60"> ({t("mailTemplates.optional")})</span>}</span>
                            {v.example && <span class="font-normal text-xs text-base-content/60 break-all">{v.example}</span>}
                          </button>
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
              <div><dt class="text-xs uppercase tracking-wide text-base-content/60">{t("mailTemplates.technical.prefix")}</dt><dd><code>{tpl.prefix}</code></dd></div>
              <div><dt class="text-xs uppercase tracking-wide text-base-content/60">{t("mailTemplates.technical.headers")}</dt>
                <dd class="break-all"><code class="block">X-On-Duty-Category: {tpl.category}</code><code class="block">X-On-Duty-Event: {tpl.key}</code><code class="block">X-On-Duty-Audience: {tpl.audience}</code></dd></div>
            </dl>
          </aside>
        </div>
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
        <script dangerouslySetInnerHTML={{ __html: LEAVE_SCRIPT(t("mailTemplates.leaveWarning")) }} />
      </div>
    </Layout>
  );
}

const fromQs = (back: string) => (back === "/mail/templates" ? "" : `?from=${encodeURIComponent(back)}`);
const readForm = async (c: any) => {
  const f = await c.req.parseBody();
  return { subject: String(f.subject ?? "").trim(), body: String(f.body ?? "").replace(/\r\n/g, "\n"), expected: String(f.updatedAt ?? "") };
};

mailTemplateRoutes.get("/:key", async (c) => {
  const tpl = await load(c.get("user"), c.req.param("key"));
  const cur = tpl.override ?? tpl.system;
  return c.html(<Editor user={c.get("user")} back={backTo(c.req.query("from"))} tpl={tpl} values={cur} errors={[]} expected={tpl.override?.updatedAt.toISOString() ?? ""} />);
});

mailTemplateRoutes.post("/:key", async (c) => {
  const user = c.get("user");
  const tpl = await load(user, c.req.param("key"));
  const { subject, body, expected } = await readForm(c);
  const errors = validateTemplate(tpl.key, { prefix: tpl.prefix, subject, body });
  const again = (errs: string[], conflict = false) =>
    c.html(<Editor user={c.get("user")} back={backTo(c.req.query("from"))} tpl={tpl} values={{ subject, body }} errors={errs} expected={expected} conflict={conflict} />, conflict ? HTTP_STATUS.CONFLICT : HTTP_STATUS.UNPROCESSABLE_ENTITY);
  if (errors.length) return again(errors);
  if ((await saveOverride(tpl, { subject, body }, user.id, expected)) === "conflict") return again([], true);
  setFlash(c, t("mailTemplates.flash.saved"), "success");
  return c.redirect(`/mail/templates/${tpl.key}${fromQs(backTo(c.req.query("from")))}`);
});

mailTemplateRoutes.post("/:key/preview", async (c) => {
  const tpl = await load(c.get("user"), c.req.param("key"));
  const { subject, body } = await readForm(c);
  const errors = validateTemplate(tpl.key, { prefix: tpl.prefix, subject, body });
  if (errors.length) return c.html(<div role="alert" class="alert alert-error"><ul>{errors.map((e) => <li>{e.replace(/^\w+: /, "")}</li>)}</ul></div>);
  const out = renderMail({ prefix: tpl.prefix, subject, body }, buildVars(tpl.key, SAMPLE_RECORD as never, SAMPLE_PEOPLE));
  return c.html(<div class="border border-base-300 rounded-box p-4"><p class="font-semibold mb-3">{out.subject}</p><pre class="whitespace-pre-wrap font-sans text-sm">{out.text}</pre></div>);
});

mailTemplateRoutes.post("/:key/reset", async (c) => {
  const tpl = await load(c.get("user"), c.req.param("key"));
  await resetOverride(tpl.key);
  setFlash(c, t("mailTemplates.flash.reset"), "success");
  return c.redirect(`/mail/templates/${tpl.key}${fromQs(backTo(c.req.query("from")))}`);
});
