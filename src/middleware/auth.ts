import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { setCookie } from "hono/cookie";
import { auth, type AppUser } from "../auth.js";
import { db } from "../db/index.js";
import { sessions, userAppRoles, appRolePermissions } from "../db/schema/index.js";
import type { Permission } from "../lib/roles.js";
import { HTTP_STATUS } from "../lib/constants.js";

export type { Permission };
export type AuthedUser = AppUser & { permissions: Set<Permission> };
export type Variables = { user: AuthedUser };

// allowPending: let users without any app role through (used by /pending and /account); all others are sent to /pending.
export function requireAuth(required?: Permission | Permission[], opts: { allowPending?: boolean } = {}) {
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

    // leftJoin: a role without permissions still yields a row (permission null) → counts as "has a role".
    const rows = await db
      .select({ roleId: userAppRoles.roleId, permission: appRolePermissions.permission })
      .from(userAppRoles)
      .leftJoin(appRolePermissions, eq(appRolePermissions.roleId, userAppRoles.roleId))
      .where(eq(userAppRoles.userId, user.id));
    const permissions = new Set(rows.flatMap((r) => (r.permission ? [r.permission] : [])));

    // Zero roles = self-registered and not yet approved. A role without the needed permission still gets the 403 below.
    if (!opts.allowPending && rows.length === 0) return c.redirect("/pending");

    const requiredList = required ? ([] as Permission[]).concat(required) : [];
    if (requiredList.length > 0 && !requiredList.some((p) => permissions.has(p))) {
      return c.html("<h1>403 Zugriff verweigert</h1>", HTTP_STATUS.FORBIDDEN);
    }

    c.set("user", { ...user, permissions });
    await next();
  });
}
