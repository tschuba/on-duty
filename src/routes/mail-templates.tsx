import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { Layout } from "../components/layout.js";
import { FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { HTTP_STATUS } from "../lib/constants.js";
import { setFlash } from "../lib/flash.js";
import { formatDay } from "../lib/datetime.js";
import { env } from "../env.js";
import { CATALOG, buildVars, mayEdit, renderMail, validateTemplate, type MailRecipient } from "../lib/mail-templates.js";
import { listTemplates, resetOverride, saveOverride, type TemplateView } from "../lib/mail-template-store.js";
import { t } from "../i18n/index.js";

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
const stamp = (u: { updatedAt: Date; updatedBy: string | null }) => ({
  name: u.updatedBy ?? t("mailTemplates.unknownUser" as never), date: formatDay(u.updatedAt, env.APP_TIMEZONE).replace(/^[^,]*,\s*/, ""),
});

mailTemplateRoutes.get("/", async (c) => {
  const user = c.get("user");
  const list = await editable(user);
  if (!list.length) return forbidden();
  const groups = [...new Set(list.map((x) => CATALOG[x.key].category))];
  return c.html(
    <Layout title={t("mailTemplates.title")} user={user}>
      <div class="max-w-4xl mx-auto">
        <PageHeader title={t("mailTemplates.title")} />
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
                        <a href={`/mail/templates/${x.key}`} class="font-medium link link-hover">{T(`mailTemplates.name.${x.key}`)}</a>
                        <div class="text-sm opacity-60">{T(`mailTemplates.desc.${x.key}`)}</div>
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
last.setRangeText(v,s,e,'end');last.focus();dirty=true})});
document.querySelectorAll('[data-tab]').forEach(function(b){b.addEventListener('click',function(){var p=b.dataset.tab==='preview';
document.getElementById('pane-edit').classList.toggle('hidden',p);document.getElementById('pane-preview').classList.toggle('hidden',!p);
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

function Editor({ user, tpl, values, errors, expected, conflict }: { user: Variables["user"]; tpl: TemplateView; values: { subject: string; body: string }; errors: string[]; expected: string; conflict?: boolean }) {
  const key = tpl.key, entry = CATALOG[key];
  const bodyErr = errors.filter((e) => !e.startsWith("subject:"));
  return (
    <Layout title={T(`mailTemplates.name.${key}`)} user={user}>
      <div class="max-w-5xl mx-auto">
        <PageHeader
          title={T(`mailTemplates.name.${key}`)} backHref="/mail/templates" subtitle={T(`mailTemplates.desc.${key}`)}
          actions={<>
            {tpl.override && <HeaderAction icon="arrow-uturn-left" label={t("mailTemplates.reset")} class="btn-outline" onclick="document.getElementById('reset-dialog').showModal()" />}
            <FormActions formId="tpl-form" />
          </>}
        />
        <p class="mb-4">{tpl.override ? t("mailTemplates.status.custom", stamp(tpl.override)) : t("mailTemplates.status.system")}</p>
        {conflict && <div role="alert" class="alert alert-error mb-4"><span>{t("mailTemplates.conflict")} <a class="link" href={`/mail/templates/${key}`}>{t("mailTemplates.conflict.reload")}</a></span></div>}
        <div role="tablist" class="tabs tabs-border mb-4">
          <button type="button" role="tab" class="tab tab-active" data-tab="edit">{t("common.edit")}</button>
          <button type="button" role="tab" class="tab" data-tab="preview" hx-post={`/mail/templates/${key}/preview`} hx-include="#tpl-form" hx-target="#preview">{t("mailTemplates.preview")}</button>
        </div>
        <div id="pane-preview" class="hidden"><div id="preview" /></div>
        <div id="pane-edit" class="grid gap-4 md:grid-cols-[1fr_16rem]">
          <form id="tpl-form" method="post" action={`/mail/templates/${key}`} class="space-y-4">
            <input type="hidden" name="updatedAt" value={expected} />
            <div>
              <label class="label" for="tpl-subject">{t("mailTemplates.field.subject")}</label>
              <input id="tpl-subject" name="subject" class="input w-full font-mono" value={values.subject} required aria-describedby={errors.some((e) => e.startsWith("subject:")) ? "err-subject" : undefined} />
              {errors.filter((e) => e.startsWith("subject:")).map((e) => <p id="err-subject" class="text-error text-sm">{e.replace(/^subject: /, "")}</p>)}
            </div>
            <div>
              <label class="label" for="tpl-body">{t("mailTemplates.field.body")}</label>
              <textarea id="tpl-body" name="body" rows={18} class="textarea w-full font-mono" required aria-describedby={bodyErr.length ? "err-body" : undefined}>{values.body}</textarea>
              {bodyErr.map((e) => <p id="err-body" class="text-error text-sm">{e.replace(/^(body|prefix): /, "")}</p>)}
            </div>
            <details class="text-sm opacity-80">
              <summary class="cursor-pointer">{t("mailTemplates.technical")}</summary>
              <dl class="mt-2">
                <dt class="font-medium">{t("mailTemplates.technical.category")}</dt><dd>{T(`mail.type.${entry.category}`)}</dd>
                <dt class="font-medium">{t("mailTemplates.technical.audience")}</dt><dd>{T(`mailTemplates.audience.${tpl.audience}`)}</dd>
                <dt class="font-medium">{t("mailTemplates.technical.prefix")}</dt><dd><code>{tpl.prefix}</code></dd>
              </dl>
            </details>
          </form>
          <aside aria-label={t("mailTemplates.placeholders")}>
            <h2 class="font-semibold mb-2">{t("mailTemplates.placeholders")}</h2>
            <ul class="space-y-1 text-sm">
              {Object.entries(entry.vars).filter(([k, v]) => !k.includes("[]") && v.type !== "list").map(([k, v]) => (
                <li><button type="button" class="btn btn-ghost btn-xs h-auto w-full justify-start text-left whitespace-normal" data-ph={k} title={`${v.example}`}>+ {v.desc}</button></li>
              ))}
            </ul>
          </aside>
        </div>
        {tpl.override && (
          <dialog id="reset-dialog" class="modal">
            <div class="modal-box">
              <p>{t("mailTemplates.reset.body")}</p>
              <pre class="mt-3 text-sm whitespace-pre-wrap font-mono bg-base-200 p-3 rounded-box">{tpl.system.subject}{"\n\n"}{tpl.system.body}</pre>
              <form method="post" action={`/mail/templates/${key}/reset`} class="modal-action">
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

const readForm = async (c: any) => {
  const f = await c.req.parseBody();
  return { subject: String(f.subject ?? "").trim(), body: String(f.body ?? "").replace(/\r\n/g, "\n"), expected: String(f.updatedAt ?? "") };
};

mailTemplateRoutes.get("/:key", async (c) => {
  const tpl = await load(c.get("user"), c.req.param("key"));
  const cur = tpl.override ?? tpl.system;
  return c.html(<Editor user={c.get("user")} tpl={tpl} values={cur} errors={[]} expected={tpl.override?.updatedAt.toISOString() ?? ""} />);
});

mailTemplateRoutes.post("/:key", async (c) => {
  const user = c.get("user");
  const tpl = await load(user, c.req.param("key"));
  const { subject, body, expected } = await readForm(c);
  const errors = validateTemplate(tpl.key, { prefix: tpl.prefix, subject, body });
  const again = (errs: string[], conflict = false) =>
    c.html(<Editor user={c.get("user")} tpl={tpl} values={{ subject, body }} errors={errs} expected={expected} conflict={conflict} />, conflict ? HTTP_STATUS.CONFLICT : HTTP_STATUS.UNPROCESSABLE_ENTITY);
  if (errors.length) return again(errors);
  if ((await saveOverride(tpl, { subject, body }, user.id, expected)) === "conflict") return again([], true);
  setFlash(c, t("mailTemplates.flash.saved"), "success");
  return c.redirect(`/mail/templates/${tpl.key}`);
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
  return c.redirect(`/mail/templates/${tpl.key}`);
});
