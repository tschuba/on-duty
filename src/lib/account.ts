import { eq, and, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, userAppRoles, appRolePermissions } from "../db/schema/index.js";
import { LOCAL_ADMIN_ACCOUNT_ID } from "./constants.js";

export type DeleteBlock = "localAdmin" | "lastAdmin";

// Pure decision: the local admin is never deletable; the last user-management account must not delete itself.
export function deleteBlock(userId: string, otherAdminCount: number, isAdmin: boolean): DeleteBlock | null {
  if (userId === LOCAL_ADMIN_ACCOUNT_ID) return "localAdmin";
  if (isAdmin && otherAdminCount === 0) return "lastAdmin";
  return null;
}

export async function countOtherAdmins(userId: string): Promise<number> {
  const rows = await db
    .selectDistinct({ id: userAppRoles.userId })
    .from(userAppRoles)
    .innerJoin(appRolePermissions, eq(appRolePermissions.roleId, userAppRoles.roleId))
    .innerJoin(users, eq(users.id, userAppRoles.userId))
    .where(and(eq(appRolePermissions.permission, "system:admin"), ne(userAppRoles.userId, userId), eq(users.disabled, false)));
  return rows.length;
}

export async function deleteOwnAccount(userId: string, isAdmin: boolean): Promise<DeleteBlock | null> {
  const block = deleteBlock(userId, isAdmin ? await countOtherAdmins(userId) : 0, isAdmin);
  if (block) return block;
  await db.delete(users).where(eq(users.id, userId));
  return null;
}
