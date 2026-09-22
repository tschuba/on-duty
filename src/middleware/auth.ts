import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { getCookie, setCookie } from "hono/cookie";
import { auth, type AppUser } from "../auth.js";
import { db } from "../db/index.js";
import { sessions } from "../db/schema/index.js";

export type AppRole = "read" | "editor" | "admin";
const ROLE_ORDER: AppRole[] = ["read", "editor", "admin"];

export type Variables = { user: AppUser };

export function requireAuth(minRole: AppRole = "read") {
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

    if (ROLE_ORDER.indexOf(user.appRole as AppRole) < ROLE_ORDER.indexOf(minRole)) {
      return c.html("<h1>403 Zugriff verweigert</h1>", 403);
    }

    c.set("user", user);
    await next();
  });
}
