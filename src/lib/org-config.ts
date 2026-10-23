import { db } from "../db/index.js";
import { env } from "../env.js";
import { orgConfig } from "../db/schema/index.js";

// Fields the amtliche Muster requires on every Zuwendungsbestätigung. org_config
// is a free key/value store (nothing required in the admin form), so a fresh
// install could otherwise print a receipt with blank tax data — callers must
// check completeness before rendering.
export const REQUIRED_RECEIPT_FIELDS = [
  "orgName", "orgStreet", "orgHouseNumber", "orgZip", "orgCity",
  "taxExemptionDate", "taxExemptionNumber", "taxOffice", "taxAssessmentPeriodFrom", "taxAssessmentPeriodTo", "charitablePurpose",
] as const;

export async function loadOrgConfig(): Promise<Record<string, string>> {
  const rows = await db.select().from(orgConfig);
  const config = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  // ORG_NAME is the default until an admin stores a Rechtsname.
  if (!config.orgName?.trim()) config.orgName = env.ORG_NAME;
  return config;
}

export function isOrgConfigCompleteForReceipts(config: Record<string, string>): boolean {
  return REQUIRED_RECEIPT_FIELDS.every((key) => config[key]);
}

export type OrgTab = "master" | "tax";

// Single source of truth for tab → fields and tab → read permissions (write implies read; OR check, no implies mechanism in RBAC).
export const ORG_TABS = {
  master: { path: "master-data", read: ["org:read", "org:write"], write: "org:write" },
  tax: { path: "tax-data", read: ["org:tax-data:read", "org:tax-data:write"], write: "org:tax-data:write" },
} as const;

// span: columns of 4 from sm up (default 4 = full width). placeholder/hint: i18n keys, shown only when editable.
export type TabField = {
  key: string; type: string; span?: 1 | 2 | 3;
  placeholder?: string; hint?: string; attrs?: Record<string, string>;
};

export const TAB_FIELDS: Record<OrgTab, TabField[]> = {
  master: [
    { key: "orgName", type: "text" },
    { key: "orgStreet", type: "text", span: 3 },
    { key: "orgHouseNumber", type: "text", span: 1 },
    { key: "orgZip", type: "text", span: 1 },
    { key: "orgCity", type: "text", span: 3 },
    { key: "applicationNotifyEmail", type: "email" },
  ],
  tax: [
    { key: "taxExemptionDate", type: "date", span: 2 },
    { key: "taxExemptionNumber", type: "text", span: 2, placeholder: "organisation.placeholder.taxExemptionNumber" },
    { key: "taxOffice", type: "text" },
    { key: "taxAssessmentPeriodFrom", type: "number", span: 2, placeholder: "organisation.placeholder.periodFrom", attrs: { inputmode: "numeric", min: "1900", max: "2200" } },
    { key: "taxAssessmentPeriodTo", type: "number", span: 2, placeholder: "organisation.placeholder.periodTo", hint: "organisation.hint.period", attrs: { inputmode: "numeric", min: "1900", max: "2200" } },
    { key: "charitablePurpose", type: "text" },
  ],
};

export function canReadOrgTab(perms: Set<string>, tab: OrgTab): boolean {
  return ORG_TABS[tab].read.some((p) => perms.has(p));
}

export function canWriteOrgTab(perms: Set<string>, tab: OrgTab): boolean {
  return perms.has(ORG_TABS[tab].write);
}

// Missing required receipt fields (empty value), grouped by tab.
export function missingReceiptFields(config: Record<string, string>): Record<OrgTab, string[]> {
  const required: readonly string[] = REQUIRED_RECEIPT_FIELDS;
  const missing = (tab: OrgTab) => TAB_FIELDS[tab].map((f) => f.key).filter((k) => required.includes(k) && !config[k]);
  return { master: missing("master"), tax: missing("tax") };
}
