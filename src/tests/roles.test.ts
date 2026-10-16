import { describe, it, expect } from "vitest";
import { groupPermissionsForBadges } from "../lib/roles.js";

describe("groupPermissionsForBadges", () => {
  it("collapses every permission into one full-access badge", () => {
    expect(
      groupPermissionsForBadges(["members:read", "members:write", "members:delete", "system:admin", "donations:record", "donations:issue-receipts", "applications:review", "applications:manage-forms", "inventory:read", "inventory:manage", "lending:read", "lending:manage", "org:read", "org:write", "org:tax-data:read", "org:tax-data:write"]),
    ).toEqual([{ kind: "full" }]);
  });

  it("collapses every permission of a resource into one resource-full badge", () => {
    expect(groupPermissionsForBadges(["members:read", "members:write", "members:delete"])).toEqual([
      { kind: "resource-full", resource: "members" },
    ]);
  });

  it("does not collapse a resource when only some of its permissions are held", () => {
    expect(groupPermissionsForBadges(["members:read", "members:write"])).toEqual([
      { kind: "single", permission: "members:read" },
      { kind: "single", permission: "members:write" },
    ]);
  });

  it("collapses both donations permissions into one resource-full badge", () => {
    expect(groupPermissionsForBadges(["donations:record", "donations:issue-receipts"])).toEqual([
      { kind: "resource-full", resource: "donations" },
    ]);
  });

  it("keeps a single permission of a resource as its own badge", () => {
    expect(groupPermissionsForBadges(["members:read"])).toEqual([
      { kind: "single", permission: "members:read" },
    ]);
  });

  it("does not collapse a lone permission per resource even when every resource is represented", () => {
    expect(groupPermissionsForBadges(["members:read", "system:admin"])).toEqual([
      { kind: "single", permission: "members:read" },
      { kind: "single", permission: "system:admin" },
    ]);
  });

  it("returns nothing for a role with no permissions", () => {
    expect(groupPermissionsForBadges([])).toEqual([]);
  });
});
