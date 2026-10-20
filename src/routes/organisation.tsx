import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { orgConfig } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { CountBadge, Layout } from "../components/layout.js";
import { HeaderAction, PageHeader } from "../components/page-header.js";
import { SubNav } from "../components/sub-nav.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { loadOrgConfig, REQUIRED_RECEIPT_FIELDS, ORG_TABS as TABS, TAB_FIELDS, canReadOrgTab, missingReceiptFields, type OrgTab } from "../lib/org-config.js";
import { HTTP_STATUS } from "../lib/constants.js";

export const organisationRoutes = new Hono<{ Variables: Variables }>();

type Tab = OrgTab;

const guard = requireAuth(["org:read", "org:write", "org:tax-data:read", "org:tax-data:write"]);

const canRead = canReadOrgTab;

function OrganisationTabs({ active, perms, counts }: { active: Tab; perms: Set<string>; counts: Record<Tab, number> }) {
  return (
    <SubNav items={(["master", "tax"] as const).filter((tab) => canRead(perms, tab)).map((tab) => ({
      href: `/organisation/${TABS[tab].path}`, active: active === tab, label: t(`organisation.tabs.${tab}`), badge: <CountBadge count={counts[tab]} />,
    }))} />
  );
}

organisationRoutes.get("/", guard, (c) => {
  const perms = c.get("user").permissions;
  const tab = canRead(perms, "master") ? "master" : "tax";
  return c.redirect(`/organisation/${TABS[tab].path}`);
});

for (const tab of ["master", "tax"] as const) {
  const { path, write } = TABS[tab];

  organisationRoutes.get(`/${path}`, guard, async (c) => {
    const user = c.get("user");
    if (!canRead(user.permissions, tab)) return c.html("<h1>403 Zugriff verweigert</h1>", HTTP_STATUS.FORBIDDEN);
    const values = await loadOrgConfig();
    const editable = user.permissions.has(write);
    // Per tab: a viewer only sees (and can only fix) the fields of the tabs they may read.
    const missingByTab = missingReceiptFields(values);
    const missing = missingByTab[tab];
    return c.html(
      <Layout title={t(`organisation.tabs.${tab}`)} user={user} activeNav="organisation">
        <OrganisationTabs active={tab} perms={user.permissions} counts={{ master: missingByTab.master.length, tax: missingByTab.tax.length }} />
        <PageHeader title={t(`organisation.tabs.${tab}`)} actions={editable && <HeaderAction variant="primary" icon="check" label={t("common.save")} form="org-form" class="btn-primary" />} />
        <form id="org-form" method="post" action={`/organisation/${path}`} class="max-w-4xl mx-auto">
          {missing.length > 0 && (
            <div class="alert alert-warning mb-4">
              <div>
                <h3 class="font-bold">{t("organisation.receiptIncomplete.title")}</h3>
                <p>{t("organisation.receiptIncomplete.body")}</p>
              </div>
            </div>
          )}
          <div class="card bg-base-200 shadow">
            <div class="card-body gap-4">
              {TAB_FIELDS[tab].map(({ key, type }) => (
                <div class="form-control">
                  <label class="label">
                    <span class="label-text">
                      {t(`admin.orgConfig.field.${key}` as never)}
                      {(REQUIRED_RECEIPT_FIELDS as readonly string[]).includes(key) && <span class="text-error" title={t("organisation.receiptRequired")}> *</span>}
                    </span>
                  </label>
                  <input
                    type={type}
                    name={key}
                    class="input input-bordered w-full"
                    value={values[key] ?? ""}
                    disabled={!editable}
                  />
                </div>
              ))}
            </div>
          </div>
        </form>
      </Layout>,
    );
  });

  organisationRoutes.post(`/${path}`, requireAuth(write), async (c) => {
    const body = await c.req.parseBody();

    if (tab === "tax") {
      const from = String(body.taxAssessmentPeriodFrom ?? "").trim();
      const to = String(body.taxAssessmentPeriodTo ?? "").trim();
      if (from && to && Number(to) < Number(from)) {
        setFlash(c, t("admin.orgConfig.flash.invalidPeriod"), "error");
        return c.redirect(`/organisation/${path}`);
      }
    }

    for (const { key } of TAB_FIELDS[tab]) {
      const value = String(body[key] ?? "").trim();
      if (value) {
        await db.insert(orgConfig).values({ key, value }).onConflictDoUpdate({ target: orgConfig.key, set: { value } });
      } else {
        await db.delete(orgConfig).where(eq(orgConfig.key, key));
      }
    }
    setFlash(c, t("admin.orgConfig.flash.saved"), "success");
    return c.redirect(`/organisation/${path}`);
  });
}
