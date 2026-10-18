import { boolean, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

/* v8 ignore start -- table schema declarations, no branching logic to unit-test */
// Keep in sync with PERMISSIONS in src/lib/roles.ts — duplicated here (not imported)
// because drizzle-kit's config loader can't resolve a cross-directory ../../lib import.
export const permissionEnum = pgEnum("permission", [
  "members:read",
  "members:write",
  "members:delete",
  "members:bank-data:read",
  "members:bank-data:write",
  "system:admin",
  "donations:read",
  "donations:record",
  "donations:delete",
  "donations:issue-receipts",
  "applications:read",
  "applications:record",
  "applications:review",
  "applications:manage-forms",
  "inventory:read",
  "inventory:manage",
  "lending:read",
  "lending:manage",
  "org:read",
  "org:write",
  "org:tax-data:read",
  "org:tax-data:write",
]);

export const appRoles = pgTable("app_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  isProtected: boolean("is_protected").notNull().default(false),
});

export const appRolePermissions = pgTable(
  "app_role_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => appRoles.id, { onDelete: "cascade" }),
    permission: permissionEnum("permission").notNull(),
  },
  (t) => [uniqueIndex("app_role_permissions_role_permission_idx").on(t.roleId, t.permission)],
);

export const userAppRoles = pgTable(
  "user_app_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => appRoles.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("user_app_roles_user_role_idx").on(t.userId, t.roleId)],
);
/* v8 ignore stop */
