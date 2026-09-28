export const PERMISSIONS = [
  "members:read",
  "members:write",
  "inventory:read",
  "inventory:manage",
  "training:read",
  "training:manage",
  "donations:manage",
  "applications:review",
  "system:admin",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
