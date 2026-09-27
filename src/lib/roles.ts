export type AppRole = "read" | "editor" | "admin";
const ROLE_ORDER: AppRole[] = ["read", "editor", "admin"];

export function hasRequiredRole(userRole: string, minRole: AppRole): boolean {
  return ROLE_ORDER.indexOf(userRole as AppRole) >= ROLE_ORDER.indexOf(minRole);
}
