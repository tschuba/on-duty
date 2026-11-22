// Permission keys are added alongside the feature that enforces them, not upfront —
// see the backlog's 05_RBAC-Rollensystem.md reversal note. Each future feature doc
// (Inventar, Ausbildungsverzeichnis, Spenden, Digitale Anträge) lists which key(s) it adds.
export const PERMISSIONS = [
  "members:read",
  "members:write",
  "members:delete",
  "members:bank-data:read",
  "members:bank-data:write",
  "member-roles:read",
  "member-roles:write",
  "member-roles:delete",
  "member-role-types:read",
  "member-role-types:write",
  "member-role-types:delete",
  "anniversary-years:read",
  "anniversary-years:write",
  "anniversary-years:delete",
  "donations:read",
  "donations:record",
  "donations:delete",
  "donations:issue-receipts",
  "cash:read",
  "cash:report",
  "cash:manage",
  "cash:cancel",
  "cash:lending",
  "cash:reopen",
  "org:read",
  "org:write",
  "org:tax-data:read",
  "org:tax-data:write",
  "inventory:read",
  "inventory:inspect",
  "inventory:manage",
  "inventory:configure",
  "inventory:inspection:delete",
  "lending:read",
  "lending:manage",
  "applications:read",
  "applications:record",
  "applications:review",
  "applications:manage",
  "events:manage",
  "training:read",
  "training:write",
  "training:delete",
  "mail:send",
  "mail:templates",
  "system:admin",
  "import:run",
] as const;

// Display order of permission resources, grouped into areas (UI headings). Every resource must appear exactly once.
export const PERMISSION_AREAS = [
  { key: "members", resources: ["members", "member-roles", "member-role-types", "anniversary-years"] },
  { key: "finance", resources: ["donations", "cash", "org"] },
  { key: "stock", resources: ["inventory", "lending"] },
  { key: "organization", resources: ["applications", "events", "training", "mail"] },
  { key: "system", resources: ["system", "import"] },
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// Groups a role's permissions for badge display: a role holding every existing
// permission collapses to one "full" badge, a role holding every permission of
// one resource (the "members" in "members:read") collapses to one "resource-full"
// badge for that resource, everything else stays a badge per permission.
export type PermissionBadgeGroup =
  | { kind: "full" }
  | { kind: "resource-full"; resource: string }
  | { kind: "single"; permission: Permission };

export function groupPermissionsForBadges(permissions: Permission[]): PermissionBadgeGroup[] {
  if (permissions.length > 0 && PERMISSIONS.every((p) => permissions.includes(p))) {
    return [{ kind: "full" }];
  }

  const resourceOf = (p: Permission) => p.split(":")[0];
  const totalByResource = new Map<string, number>();
  for (const p of PERMISSIONS) totalByResource.set(resourceOf(p), (totalByResource.get(resourceOf(p)) ?? 0) + 1);

  const byResource = new Map<string, Permission[]>();
  for (const p of PERMISSIONS) {
    if (!permissions.includes(p)) continue;
    const r = resourceOf(p);
    byResource.set(r, [...(byResource.get(r) ?? []), p]);
  }

  const groups: PermissionBadgeGroup[] = [];
  for (const [resource, perms] of byResource) {
    if (perms.length > 1 && perms.length === totalByResource.get(resource)) {
      groups.push({ kind: "resource-full", resource });
    } else {
      for (const p of perms) groups.push({ kind: "single", permission: p });
    }
  }
  return groups;
}
