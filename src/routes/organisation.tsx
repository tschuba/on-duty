import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { Field } from "../components/field.js";
import { db } from "../db/index.js";
import { orgConfig } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { FormActions, PageHeader } from "../components/page-header.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { loadOrgConfig, REQUIRED_RECEIPT_FIELDS, ORG_TABS as TABS, TAB_FIELDS, canReadOrgTab, canWriteOrgTab, missingReceiptFields, type OrgTab } from "../lib/org-config.js";
import { HTTP_STATUS } from "../lib/constants.js";

// Full class names so Tailwind's scanner picks them up.
const SPAN_CLASS = { 1: "sm:col-span-1", 2: "sm:col-span-2", 3: "sm:col-span-3", 4: "sm:col-span-4" } as const;

export const organisationRoutes = new Hono<{ Variables: Variables }>();

const TAB_ORDER = ["master", "tax"] as const;

const guard = requireAuth(["org:read", "org:write", "org:tax-data:read", "org:tax-data:write"]);

function OrgSection({ tab, values, editable, missing }: { tab: OrgTab; values: Record<string, string>; editable: boolean; missing: string[] }) {
  return (
    <section id={TABS[tab].path} class="mb-8">
      <h2 class="text-xl font-semibold mb-4">{t(`organisation.tabs.${tab}`)}</h2>
      {missing.length > 0 && (
        <div class="alert alert-warning mb-4">
          <div>
            <h3 class="font-bold">{t("organisation.receiptIncomplete.title")}</h3>
            <p>{t("organisation.receiptIncomplete.body")}</p>
          </div>
        </div>
      )}
      <div class="card bg-base-200 shadow">
        <div class="card-body grid grid-cols-1 sm:grid-cols-4 gap-4">
          {TAB_FIELDS[tab].map(({ key, type, span, placeholder, hint, attrs }) => (
            <>
            <Field
              label={t(`admin.orgConfig.field.${key}` as never)}
              required={(REQUIRED_RECEIPT_FIELDS as readonly string[]).includes(key)}
              floating={type !== "date"}
              class={SPAN_CLASS[span ?? 4]}
            >
              <input
                type={type}
                name={key}
                value={values[key] ?? ""}
                disabled={!editable}
                placeholder={editable && placeholder ? t(placeholder as never) : t(`admin.orgConfig.field.${key}` as never)}
                {...(editable ? attrs : {})}
              />
            </Field>
            {editable && hint && <p class="text-sm text-base-content/70 sm:col-span-4 -mt-2">{t(hint as never)}</p>}
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
    <Layout title={t("common.nav.organisation")} user={user} activeNav="organisation">
      <PageHeader title={t("common.nav.organisation")} actions={anyEditable && <FormActions formId="org-form" />} />
      <form id="org-form" method="post" action="/organisation" class="max-w-4xl mx-auto">
        {tabs.map((tab) => (
          <OrgSection tab={tab} values={values} editable={canWriteOrgTab(perms, tab)} missing={missingByTab[tab]} />
        ))}
      </form>
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
