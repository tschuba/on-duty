import { describe, it, expect, vi } from "vitest";

vi.mock("../db/index.js", () => ({ db: {} }));
const { parseSettingsForm } = await import("../lib/settings.js");

const ok = async () => "ok" as const;

describe("parseSettingsForm", () => {
  it("defaults checkboxes to false and role to empty", async () => {
    expect(await parseSettingsForm({}, ok)).toEqual({
      values: { registrationEnabled: "false", registrationAutoApprove: "false", registrationDefaultRoleId: "" },
    });
  });
  it("rejects auto-approve without a default role", async () => {
    expect(await parseSettingsForm({ registrationAutoApprove: "1" }, ok)).toEqual({ error: "autoApproveNeedsRole" });
  });
  it("accepts auto-approve with a valid role", async () => {
    const r = await parseSettingsForm({ registrationAutoApprove: "1", registrationDefaultRoleId: "r1" }, ok);
    expect(r).toEqual({ values: { registrationEnabled: "false", registrationAutoApprove: "true", registrationDefaultRoleId: "r1" } });
  });
  it("rejects unknown role and role without permissions", async () => {
    expect(await parseSettingsForm({ registrationDefaultRoleId: "x" }, async () => "unknownRole")).toEqual({ error: "unknownRole" });
    expect(await parseSettingsForm({ registrationDefaultRoleId: "x" }, async () => "roleWithoutPermissions")).toEqual({ error: "roleWithoutPermissions" });
  });
});
