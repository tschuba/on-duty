import { eq, inArray, count } from "drizzle-orm";
import { db } from "../db/index.js";
import { appSettings, appRoles, appRolePermissions } from "../db/schema/index.js";

// Writable runtime settings (/admin/config). Env values stay read-only there.
// Add a new setting by adding one entry here — the UI and the POST handler are generic.
export type SettingType = "boolean" | "role" | "number";
export const SETTINGS = [
  { key: "registrationEnabled", type: "boolean", default: "false" },
  { key: "registrationAutoApprove", type: "boolean", default: "false" },
  { key: "registrationDefaultRoleId", type: "role", default: "" },
  { key: "loanRequestRetentionDays", type: "number", default: "90" },
] as const satisfies readonly { key: string; type: SettingType; default: string }[];
export type SettingKey = (typeof SETTINGS)[number]["key"];

export async function getSettings(): Promise<Record<SettingKey, string>> {
  const rows = await db.select().from(appSettings);
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(SETTINGS.map((s) => [s.key, stored.get(s.key) ?? s.default])) as Record<SettingKey, string>;
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

export async function roleHasPermissions(roleId: string): Promise<boolean> {
  const [{ cnt }] = await db.select({ cnt: count() }).from(appRolePermissions).where(eq(appRolePermissions.roleId, roleId));
  return cnt > 0;
}

export type SettingsError = "unknownRole" | "roleWithoutPermissions" | "autoApproveNeedsRole" | "invalidRetentionDays";

// Pure parsing/validation of the submitted form; role existence/permissions are injected so it stays unit-testable.
export async function parseSettingsForm(
  body: Record<string, unknown>,
  roleOk: (id: string) => Promise<"ok" | "unknownRole" | "roleWithoutPermissions">,
): Promise<{ values: Record<SettingKey, string> } | { error: SettingsError }> {
  const values = {} as Record<SettingKey, string>;
  for (const s of SETTINGS) {
    const raw = body[s.key];
    values[s.key] = s.type === "boolean" ? (raw === "1" ? "true" : "false") : String(raw ?? "").trim() || s.default;
  }
  if (values.registrationDefaultRoleId) {
    const r = await roleOk(values.registrationDefaultRoleId);
    if (r !== "ok") return { error: r };
  }
  if (values.registrationAutoApprove === "true" && !values.registrationDefaultRoleId) {
    return { error: "autoApproveNeedsRole" };
  }
  const retentionDays = Number(values.loanRequestRetentionDays);
  if (!Number.isInteger(retentionDays) || retentionDays < 1) return { error: "invalidRetentionDays" };
  return { values };
}

export async function checkRole(id: string): Promise<"ok" | "unknownRole" | "roleWithoutPermissions"> {
  const found = await db.select({ id: appRoles.id }).from(appRoles).where(inArray(appRoles.id, [id]));
  if (found.length === 0) return "unknownRole";
  return (await roleHasPermissions(id)) ? "ok" : "roleWithoutPermissions";
}

// Called when an app role is deleted: a dangling default role must not stay configured.
export async function clearDefaultRoleIfDeleted(roleId: string): Promise<void> {
  const s = await getSettings();
  if (s.registrationDefaultRoleId !== roleId) return;
  await setSetting("registrationDefaultRoleId", "");
  await setSetting("registrationAutoApprove", "false");
}
