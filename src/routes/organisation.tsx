import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { orgConfig } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { loadOrgConfig, REQUIRED_RECEIPT_FIELDS } from "../lib/org-config.js";
import { HTTP_STATUS } from "../lib/constants.js";

export const organisationRoutes = new Hono<{ Variables: Variables }>();

type Tab = "master" | "tax";
type FieldKey = keyof typeof FIELD_LABEL_KEYS;

// Each tab is gated as a whole; write implies read (OR check, no implies mechanism in RBAC).
const TABS = {
  master: { path: "stammdaten", read: ["org:read", "org:write"], write: "org:write" },
  tax: { path: "steuerdaten", read: ["org:tax-data:read", "org:tax-data:write"], write: "org:tax-data:write" },
} as const;

const FIELD_LABEL_KEYS = {
  orgName: "admin.orgConfig.field.orgName",
  orgStreet: "admin.orgConfig.field.orgStreet",
  orgHouseNumber: "admin.orgConfig.field.orgHouseNumber",
  orgZip: "admin.orgConfig.field.orgZip",
  orgCity: "admin.orgConfig.field.orgCity",
  applicationNotifyEmail: "admin.orgConfig.field.applicationNotifyEmail",
  taxExemptionDate: "admin.orgConfig.field.taxExemptionDate",
  taxExemptionNumber: "admin.orgConfig.field.taxExemptionNumber",
  taxOffice: "admin.orgConfig.field.taxOffice",
  taxAssessmentPeriodFrom: "admin.orgConfig.field.taxAssessmentPeriodFrom",
  taxAssessmentPeriodTo: "admin.orgConfig.field.taxAssessmentPeriodTo",
  charitablePurpose: "admin.orgConfig.field.charitablePurpose",
} as const;

const TAB_FIELDS: Record<Tab, { key: FieldKey; type: string }[]> = {
  master: [
    { key: "orgName", type: "text" },
    { key: "orgStreet", type: "text" },
    { key: "orgHouseNumber", type: "text" },
    { key: "orgZip", type: "text" },
    { key: "orgCity", type: "text" },
    { key: "applicationNotifyEmail", type: "email" },
  ],
  tax: [
    { key: "taxExemptionDate", type: "date" },
    { key: "taxExemptionNumber", type: "text" },
    { key: "taxOffice", type: "text" },
    { key: "taxAssessmentPeriodFrom", type: "number" },
    { key: "taxAssessmentPeriodTo", type: "number" },
    { key: "charitablePurpose", type: "text" },
  ],
};

const guard = requireAuth(["org:read", "org:write", "org:tax-data:read", "org:tax-data:write"]);

function canRead(perms: Set<string>, tab: Tab) {
  return TABS[tab].read.some((p) => perms.has(p));
}

function OrganisationTabs({ active, perms }: { active: Tab; perms: Set<string> }) {
  return (
    <div role="tablist" class="tabs tabs-lifted mb-6">
      {(["master", "tax"] as const).filter((tab) => canRead(perms, tab)).map((tab) => (
        <a href={`/organisation/${TABS[tab].path}`} role="tab" class={`tab${active === tab ? " tab-active" : ""}`}>
          {t(`organisation.tabs.${tab}`)}
        </a>
      ))}
    </div>
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
    const missing = TAB_FIELDS[tab].map((f) => f.key).filter((k) => (REQUIRED_RECEIPT_FIELDS as readonly string[]).includes(k) && !values[k]);
    return c.html(
      <Layout title={t(`organisation.tabs.${tab}`)} user={user} activeNav="organisation">
        <OrganisationTabs active={tab} perms={user.permissions} />
        <div class="max-w-4xl mx-auto">
          {missing.length > 0 && (
            <div class="alert alert-warning mb-4">
              <div>
                <h3 class="font-bold">{t("organisation.receiptIncomplete.title")}</h3>
                <p>{t("organisation.receiptIncomplete.body", { fields: missing.map((k) => t(FIELD_LABEL_KEYS[k])).join(", ") })}</p>
              </div>
            </div>
          )}
          <form method="post" action={`/organisation/${path}`} class="card bg-base-200 shadow">
            <div class="card-body gap-4">
              <div class="flex items-center justify-between">
                <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">
                  {t(`organisation.tabs.${tab}`)}
                </h1>
                {editable && <button type="submit" class="btn btn-primary">{t("common.save")}</button>}
              </div>
              {TAB_FIELDS[tab].map(({ key, type }) => (
                <div class="form-control">
                  <label class="label">
                    <span class="label-text">
                      {t(FIELD_LABEL_KEYS[key])}
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
          </form>
        </div>
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
