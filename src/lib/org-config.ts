import { db } from "../db/index.js";
import { orgConfig } from "../db/schema/index.js";

// Fields the amtliche Muster requires on every Zuwendungsbestätigung. org_config
// is a free key/value store (nothing required in the admin form), so a fresh
// install could otherwise print a receipt with blank tax data — callers must
// check completeness before rendering.
const REQUIRED_RECEIPT_FIELDS = [
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
