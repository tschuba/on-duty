import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { Icon } from "../components/icon.js";
import { Field, RichTextField } from "../components/field.js";
import { db } from "../db/index.js";
import { orgConfig } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { FormActions, PageHeader } from "../components/page-header.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { sanitizeRichText } from "../lib/sanitize.js";
import { loadOrgConfig, REQUIRED_RECEIPT_FIELDS, ORG_TABS as TABS, TAB_FIELDS, canReadOrgTab, canWriteOrgTab, missingReceiptFields, privacyMode, type OrgTab } from "../lib/org-config.js";
import { HTTP_STATUS } from "../lib/constants.js";

// Full class names so Tailwind's scanner picks them up.
const SPAN_CLASS = { 1: "sm:col-span-1", 2: "sm:col-span-2", 3: "sm:col-span-3", 4: "sm:col-span-4" } as const;

export const organisationRoutes = new Hono<{ Variables: Variables }>();

const TAB_ORDER = ["master", "privacy", "tax"] as const;

const guard = requireAuth(["org:read", "org:write", "org:tax-data:read", "org:tax-data:write"]);

// CSS-only Umschalter (has-[:checked]); beide Eingaben bleiben im Formular, damit der inaktive Wert erhalten bleibt.
function PrivacyGroup({ values, editable }: { values: Record<string, string>; editable: boolean }) {
  const mode = privacyMode(values);
  const opts = ["none", "url", "text"] as const;
  return (
    <fieldset class="fieldset sm:col-span-4 group">
      <div class="flex flex-wrap gap-x-6 gap-y-2">
        {opts.map((o) => (
          <label class="label cursor-pointer gap-2">
            <input type="radio" name="orgPrivacyMode" id={`pm-${o}`} value={o} class="radio radio-sm" checked={mode === o} disabled={!editable} />
            {t(`organisation.privacy.${o}`)}
          </label>
        ))}
      </div>
      <p class="text-xs text-base-content/60 hidden group-has-[#pm-none:checked]:block">{t("organisation.privacy.noneHint")}</p>
      <div class="hidden group-has-[#pm-url:checked]:block">
        <p class="text-xs text-base-content/60 mb-2">{t("organisation.privacy.urlHint")}</p>
        <Field label={t("organisation.privacy.url")}>
          <input type="url" name="orgPrivacyUrl" value={values.orgPrivacyUrl ?? ""} disabled={!editable} class="input w-full" placeholder={t("organisation.placeholder.orgPrivacyUrl")} />
        </Field>
      </div>
      <div class="hidden group-has-[#pm-text:checked]:block">
        <p class="text-xs text-base-content/60 mb-2">{t("organisation.privacy.textHint")}</p>
        <RichTextField name="orgPrivacyText" value={values.orgPrivacyText ?? ""} editable={editable} />
        {values.orgPrivacyText?.trim() && (
          <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href="/datenschutz" target="_blank" rel="noopener" class="btn btn-outline btn-sm">
              <Icon name="arrow-top-right-on-square" class="h-4 w-4 shrink-0" />
              {t("organisation.privacy.preview")}
            </a>
            <span class="text-xs text-base-content/60">{t("organisation.privacy.previewHint")}</span>
          </div>
        )}
      </div>
    </fieldset>
  );
}

// CSS-only: Toggle blendet das eigene Adressfeld ein; ohne Toggle gilt die Kontakt-E-Mail (Server leert das Feld dann; Hinweis steht dort).
function NotifyGroup({ values, editable }: { values: Record<string, string>; editable: boolean }) {
  return (
    <div class="sm:col-span-4 group">
      <label class="label cursor-pointer justify-start gap-3 whitespace-normal">
        <input type="checkbox" name="notifySeparate" id="notify-separate" class="toggle toggle-sm" checked={!!values.notificationEmail?.trim()} disabled={!editable} />
        <span class="min-w-0">{t("organisation.notify.toggle")}</span>
      </label>
      <div class="hidden group-has-[#notify-separate:checked]:block mt-2">
        <Field label={t("admin.orgConfig.field.notificationEmail")} floating>
          <input type="email" name="notificationEmail" value={values.notificationEmail ?? ""} disabled={!editable} class="input w-full" placeholder={t("admin.orgConfig.field.notificationEmail")} />
        </Field>
      </div>
    </div>
  );
}

function OrgSection({ tab, values, editable }: { tab: OrgTab; values: Record<string, string>; editable: boolean }) {
  return (
    <section id={TABS[tab].path} class="mb-8">
      <h2 class="text-xl font-semibold mb-4">{t(`organisation.tabs.${tab}`)}</h2>
      <div class="card bg-base-200 shadow">
        <div class="card-body grid grid-cols-1 sm:grid-cols-4 gap-4">
          {TAB_FIELDS[tab].map(({ key, type, span, placeholder, hint, attrs, inGroup }) => inGroup ? null : type === "privacy" ? (
            <PrivacyGroup values={values} editable={editable} />
          ) : type === "notify" ? (
            <NotifyGroup values={values} editable={editable} />
          ) : (
            <>
            <Field
              label={t(`admin.orgConfig.field.${key}` as never)}
              required={(REQUIRED_RECEIPT_FIELDS as readonly string[]).includes(key)}
              class={SPAN_CLASS[span ?? 4]}
              floating={type !== "richtext"}
            >
              {type === "textarea" ? (
                <textarea name={key} rows={10} disabled={!editable} class="textarea w-full" placeholder={t(`admin.orgConfig.field.${key}` as never)}>{values[key] ?? ""}</textarea>
              ) : type === "richtext" ? (
                <RichTextField name={key} value={values[key] ?? ""} editable={editable} />
              ) : <input
                type={type}
                name={key}
                value={values[key] ?? ""}
                disabled={!editable}
                class="input w-full"
                placeholder={editable && placeholder ? t(placeholder as never) : t(`admin.orgConfig.field.${key}` as never)}
                {...(editable ? attrs : {})}
              />}
            </Field>
            {editable && hint && <p class="text-xs text-base-content/60 sm:col-span-4 -mt-2">{t(hint as never)}</p>}
            </>
          ))}
        </div>
      </div>
    </section>
  );
}

organisationRoutes.get("/", guard, async (c) => {
  const user = c.get("user");
  const perms = user.permissions;
  const tabs = TAB_ORDER.filter((tab) => canReadOrgTab(perms, tab));
  if (tabs.length === 0) return c.html("<h1>403 Zugriff verweigert</h1>", HTTP_STATUS.FORBIDDEN);
  const values = await loadOrgConfig();
  // A viewer only sees (and can only fix) the fields of the sections they may read.
  const missingByTab = missingReceiptFields(values);
  const anyEditable = tabs.some((tab) => canWriteOrgTab(perms, tab));
  return c.html(
    <Layout title={t("common.nav.organisation")} user={user}>
      <PageHeader title={t("common.nav.organisation")} actions={anyEditable && <FormActions formId="org-form" />} />
      <form id="org-form" method="post" action="/organisation" class="max-w-4xl mx-auto">
        {tabs.some((tab) => missingByTab[tab].length > 0) && (
          <div class="alert alert-warning mb-8">
            <div>
              <h3 class="font-bold">{t("organisation.receiptIncomplete.title")}</h3>
              <p>{t("organisation.receiptIncomplete.body")}</p>
            </div>
          </div>
        )}
        {tabs.map((tab) => (
          <OrgSection tab={tab} values={values} editable={canWriteOrgTab(perms, tab)} />
        ))}
      </form>
      {tabs.includes("privacy") && (
        <>
          <link rel="stylesheet" href="/css/trix.css" />
          <script src="/js/trix.min.js"></script>
          <script dangerouslySetInnerHTML={{ __html: 'document.addEventListener("trix-file-accept",function(e){e.preventDefault()})' }}></script>
        </>
      )}
    </Layout>,
  );
});

// Old per-tab URLs (bookmarks) → anchors on the single page.
for (const tab of TAB_ORDER) {
  organisationRoutes.get(`/${TABS[tab].path}`, guard, (c) => c.redirect(`/organisation#${TABS[tab].path}`));
}

organisationRoutes.post("/", requireAuth([TABS.master.write, TABS.tax.write]), async (c) => {
  const perms = c.get("user").permissions;
  const body = await c.req.parseBody();
  const tabs = TAB_ORDER.filter((tab) => canWriteOrgTab(perms, tab));

  // Trix liefert HTML (z. B. "<div></div>" bei leerem Editor); vor der Leer-Prüfung und dem Speichern sanitizen.
  if (typeof body.orgPrivacyText === "string") body.orgPrivacyText = sanitizeRichText(body.orgPrivacyText);

  if (tabs.includes("master") && body.notifySeparate !== "on") body.notificationEmail = "";

  if (tabs.includes("privacy")) {
    const mode = String(body.orgPrivacyMode ?? "");
    const url = String(body.orgPrivacyUrl ?? "").trim();
    const privacyError =
      mode === "url" && !(/^https:\/\//i.test(url) && URL.canParse(url)) ? "privacyUrlInvalid"
      : mode === "text" && !String(body.orgPrivacyText ?? "").trim() ? "privacyTextEmpty"
      : null;
    if (privacyError) {
      setFlash(c, t(`admin.orgConfig.flash.${privacyError}`), "error");
      return c.redirect(`/organisation#${TABS.privacy.path}`);
    }
  }

  if (tabs.includes("tax")) {
    const from = String(body.taxAssessmentPeriodFrom ?? "").trim();
    const to = String(body.taxAssessmentPeriodTo ?? "").trim();
    if (from && to && Number(to) < Number(from)) {
      setFlash(c, t("admin.orgConfig.flash.invalidPeriod"), "error");
      return c.redirect(`/organisation#${TABS.tax.path}`);
    }
  }

  // Server-side per-section check: disabled inputs aren't submitted and would otherwise be deleted.
  for (const tab of tabs) {
    for (const { key } of TAB_FIELDS[tab]) {
      const value = String(body[key] ?? "").trim();
      if (value) {
        await db.insert(orgConfig).values({ key, value }).onConflictDoUpdate({ target: orgConfig.key, set: { value } });
      } else {
        await db.delete(orgConfig).where(eq(orgConfig.key, key));
      }
    }
  }
  setFlash(c, t("admin.orgConfig.flash.saved"), "success");
  return c.redirect("/organisation");
});
