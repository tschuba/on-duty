import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { setCookie } from "hono/cookie";
import { auth, type AppUser } from "../auth.js";
import { db } from "../db/index.js";
import { sessions, userAppRoles, appRolePermissions } from "../db/schema/index.js";
import type { Permission } from "../lib/roles.js";

export type { Permission };
export type AuthedUser = AppUser & { permissions: Set<Permission> };
export type Variables = { user: AuthedUser };

export function requireAuth(required?: Permission) {
  return createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      setCookie(c, "returnTo", c.req.path, { httpOnly: true, maxAge: 300, path: "/" });
      return c.redirect("/login");
    }

    const { user } = session;

    if (user.disabled) {
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      return c.redirect("/login?error=disabled");
    }

    const rows = await db
      .select({ permission: appRolePermissions.permission })
      .from(userAppRoles)
      .innerJoin(appRolePermissions, eq(appRolePermissions.roleId, userAppRoles.roleId))
      .where(eq(userAppRoles.userId, user.id));
    const permissions = new Set(rows.map((r) => r.permission));

    if (required && !permissions.has(required)) {
      return c.html("<h1>403 Zugriff verweigert</h1>", 403);
    }

    c.set("user", { ...user, permissions });
    await next();
  });
}
