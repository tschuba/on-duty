import { describe, it, expect } from "vitest";
import { groupPermissionsForBadges } from "../lib/roles.js";

describe("groupPermissionsForBadges", () => {
  it("collapses every permission into one full-access badge", () => {
    expect(groupPermissionsForBadges(["members:read", "members:write", "system:admin", "donations:manage"])).toEqual([
      { kind: "full" },
    ]);
  });

  it("collapses every permission of a resource into one resource-full badge", () => {
    expect(groupPermissionsForBadges(["members:read", "members:write"])).toEqual([
      { kind: "resource-full", resource: "members" },
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
