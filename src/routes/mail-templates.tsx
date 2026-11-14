import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { Layout } from "../components/layout.js";
import { FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { HTTP_STATUS } from "../lib/constants.js";
import { setFlash } from "../lib/flash.js";
import { formatDay } from "../lib/datetime.js";
import { env } from "../env.js";
import { CATALOG, mayEdit, previewVars, renderMail, validateTemplate, type VarSpec } from "../lib/mail-templates.js";
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
  // Reihenfolge = Katalog (die DB liefert ohne ORDER BY keine stabile Reihenfolge)
  const order = Object.keys(CATALOG);
  return (await listTemplates()).filter((x) => CATALOG[x.key] && mayEdit(user, x.editPermissions)).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
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

const GROUPS = ["event", "recipient", "details", "org", "link"] as const;
const groupOf = (k: string, v: VarSpec) =>
  v.source === "link" ? "link" : k.startsWith("event.") ? "event" : /^(item|applicant|user)\.|^(rejoin)$/.test(k) ? "details" : k.startsWith("org.") || k === "type" ? "org" : "recipient";

function Editor({ user, back, tpl, values, errors, expected, conflict }: { user: Variables["user"]; back: string; tpl: TemplateView; values: { subject: string; body: string }; errors: string[]; expected: string; conflict?: boolean }) {
  const key = tpl.key, entry = CATALOG[key];
  const requiredNames = new Set(entry.required.map((r) => (r.list ? `${r.list}[].${r.name}` : r.name)));
  const phData = Object.entries(entry.vars).map(([name, v]) => ({ name, desc: v.desc, example: v.example, optional: !!v.optional, type: v.type, group: groupOf(name, v), list: name.includes("[]") || v.type === "list", required: requiredNames.has(name) }));
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
        <div class="flex justify-end mb-2 md:hidden">
          <button type="button" id="ph-toggle" class="btn btn-ghost btn-square" aria-expanded="false" aria-controls="ph-col" aria-label={t("mailTemplates.sidebar")}><Icon name="sidebar-expand" class="h-5 w-5 text-gold" /></button>
        </div>
        <div role="tablist" class="tabs tabs-lift">
          <input type="radio" name="tpl-tabs" class="tab" aria-label={t("common.edit")} data-tab="edit" checked />
          <div class="tab-content bg-base-100 border-base-300 p-4">
        <div id="pane-edit" data-open="false" class="group grid gap-4 md:grid-rows-[minmax(0,1fr)] md:grid-cols-[1fr_3.25rem] md:relative md:data-[open=true]:grid-cols-[1fr_var(--ph-w,22rem)] md:data-[open=false]:grid-cols-1">
          <div id="ph-resize" role="separator" aria-orientation="vertical" class="hidden md:group-data-[open=true]:block absolute inset-y-0 z-10 w-2 cursor-col-resize rounded hover:bg-base-300 touch-none" style="right:calc(var(--ph-w,22rem) + 0.25rem)" />
          <div id="ph-backdrop" class="fixed inset-0 z-40 bg-black/40 md:hidden group-data-[open=false]:hidden" aria-hidden="true" />
          <form id="tpl-form" method="post" action={`/mail/templates/${key}${fromQs(back)}`} class="space-y-4 min-w-0 md:overflow-y-auto">
            <input type="hidden" name="updatedAt" value={expected} />
            <Field label={t("mailTemplates.field.subject")} required class="md:group-data-[open=false]:pr-12" after={errors.filter((e) => e.startsWith("subject:")).map((e) => <p id="err-subject" class="text-error text-sm">{e.replace(/^subject: /, "")}</p>)}>
              <input id="tpl-subject" name="subject" class="input w-full font-mono" placeholder={t("mailTemplates.field.subject")} value={values.subject} required aria-describedby={errors.some((e) => e.startsWith("subject:")) ? "err-subject" : undefined} />
            </Field>
            <Field label={t("mailTemplates.field.body")} required after={bodyErr.map((e) => <p id="err-body" class="text-error text-sm">{e.replace(/^(body|prefix): /, "")}</p>)}>
              <textarea id="tpl-body" name="body" rows={18} class="textarea w-full font-mono" placeholder={t("mailTemplates.field.body")} required aria-describedby={bodyErr.length ? "err-body" : undefined}>{values.body}</textarea>
            </Field>
          </form>
          <aside id="ph-col" aria-label={t("mailTemplates.placeholders")} class="fixed inset-y-0 right-0 z-50 w-80 max-w-[85vw] overflow-auto bg-base-100 shadow-xl transition-transform group-data-[open=false]:invisible group-data-[open=false]:translate-x-full md:static md:inset-auto md:z-auto md:w-auto md:max-w-none md:group-data-[open=true]:[contain:size] md:overflow-y-auto md:rounded-box md:border md:border-base-300 md:shadow-none md:group-data-[open=false]:visible md:group-data-[open=false]:translate-x-0 md:group-data-[open=false]:absolute md:group-data-[open=false]:-top-px md:group-data-[open=false]:-right-px md:group-data-[open=false]:w-[calc(2.5rem+2px)] md:group-data-[open=false]:border-transparent md:group-data-[open=false]:overflow-visible motion-reduce:transition-none">
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
                const items = Object.entries(entry.vars).filter(([k, v]) => v.type !== "list" && groupOf(k, v) === g);
                return items.length > 0 && (
                  <section data-g>
                    <h3 class="px-1 pt-1 text-xs font-bold uppercase tracking-wide text-base-content/60">{t(`mailTemplates.group.${g}`)}</h3>
                    <ul class="space-y-1 p-1">
                      {items.map(([k, v]) => (
                        <li data-s={`${k} ${v.desc} ${v.example}`} class={cond(k, v) ? "rounded-box bg-base-200 p-1 space-y-1" : undefined}>
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
              <div><dt class="text-xs uppercase tracking-wide text-base-content/60">{t("mailTemplates.technical.prefix")}</dt><dd><code>{tpl.prefix}</code></dd></div>
              <div><dt class="text-xs uppercase tracking-wide text-base-content/60">{t("mailTemplates.technical.headers")}</dt>
                <dd class="break-all"><code class="block">X-On-Duty-Category: {tpl.category}</code><code class="block">X-On-Duty-Event: {tpl.key}</code><code class="block">X-On-Duty-Audience: {tpl.audience}</code></dd></div>
            </dl>
          </aside>
        </div>
          </div>
          {entry.previewCases.length > 1 && <input type="radio" name="tpl-tabs" class="tab" aria-label={t("mailTemplates.preview")} data-tab="entry" />}
          {entry.previewCases.map((x) => (
            <>
              <input type="radio" name="tpl-tabs" class={entry.previewCases.length > 1 ? "tab hidden text-secondary checked:font-semibold [--tab-bg:var(--color-base-200)] [--tab-border-color:var(--color-secondary)]" : "tab"} aria-label={entry.previewCases.length > 1 ? x.label : t("mailTemplates.preview")} data-tab="preview" data-case={x.id} hx-post={`/mail/templates/${key}/preview`} hx-include="#tpl-form" hx-vals={JSON.stringify({ case: x.id })} hx-target={`#preview-${x.id}`} />
              <div class="tab-content bg-base-100 border-secondary p-4"><div id={`preview-${x.id}`} /></div>
            </>
          ))}
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
        <script id="ph-data" type="application/json" dangerouslySetInnerHTML={{ __html: JSON.stringify(phData).replace(/</g, "\\u003c") }} />
        <script src="/js/mail-placeholders.min.js" data-leave={t("mailTemplates.leaveWarning")} defer></script>
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

// Nur Beispieldaten: kein Versand, keine Speicherung, keine Fachdaten.
mailTemplateRoutes.post("/:key/preview", async (c) => {
  const tpl = await load(c.get("user"), c.req.param("key"));
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

mailTemplateRoutes.post("/:key/reset", async (c) => {
  const tpl = await load(c.get("user"), c.req.param("key"));
  await resetOverride(tpl.key);
  setFlash(c, t("mailTemplates.flash.reset"), "success");
  return c.redirect(`/mail/templates/${tpl.key}${fromQs(backTo(c.req.query("from")))}`);
});
