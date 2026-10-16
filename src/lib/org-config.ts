import { db } from "../db/index.js";
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
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function isOrgConfigCompleteForReceipts(config: Record<string, string>): boolean {
  return REQUIRED_RECEIPT_FIELDS.every((key) => config[key]);
}

export type OrgTab = "master" | "tax";

// Single source of truth for tab → fields and tab → read permissions (write implies read; OR check, no implies mechanism in RBAC).
export const ORG_TABS = {
  master: { path: "stammdaten", read: ["org:read", "org:write"], write: "org:write" },
  tax: { path: "steuerdaten", read: ["org:tax-data:read", "org:tax-data:write"], write: "org:tax-data:write" },
} as const;

export const TAB_FIELDS: Record<OrgTab, { key: string; type: string }[]> = {
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

export function canReadOrgTab(perms: Set<string>, tab: OrgTab): boolean {
  return ORG_TABS[tab].read.some((p) => perms.has(p));
}

// Missing required receipt fields (empty value), grouped by tab.
export function missingReceiptFields(config: Record<string, string>): Record<OrgTab, string[]> {
  const required: readonly string[] = REQUIRED_RECEIPT_FIELDS;
  const missing = (tab: OrgTab) => TAB_FIELDS[tab].map((f) => f.key).filter((k) => required.includes(k) && !config[k]);
  return { master: missing("master"), tax: missing("tax") };
}
