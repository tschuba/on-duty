import bcrypt from "bcryptjs";
import { eq, and } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie, deleteCookie } from "hono/cookie";
import { auth } from "../auth.js";
import { db } from "../db/index.js";
import { accounts } from "../db/schema/index.js";
import { Layout } from "../components/layout.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { env } from "../env.js";
import { checkRateLimit, recordFailedAttempt, resetRateLimit } from "../lib/ratelimit.js";

export const loginRoutes = new Hono<{ Variables: Variables }>();

// ── /login — OIDC entry point ─────────────────────────────────────────────────

loginRoutes.get("/login", (c) => {
  const error = c.req.query("error");
  const errorMsg =
    error === "unknown_user"
      ? "Ihr Konto ist nicht für die Anmeldung freigeschaltet. Bitte wenden Sie sich an einen Administrator."
      : error === "disabled"
        ? "Ihr Konto wurde deaktiviert."
        : null;

  return c.html(
    <Layout title="Anmelden">
      <div class="flex min-h-[60vh] items-center justify-center">
        <div class="card bg-base-200 w-full max-w-sm shadow">
          <div class="card-body gap-4">
            <h1 class="card-title text-2xl" style="font-family: var(--font-heading)">
              Anmelden
            </h1>
            {errorMsg && (
              <div class="alert alert-error text-sm">
                <span>{errorMsg}</span>
              </div>
            )}
            <a href="/auth/oidc-start" class="btn btn-primary w-full">
              Mit OIDC anmelden
            </a>
          </div>
        </div>
      </div>
    </Layout>
  );
});

// Initiates the OIDC flow server-side and redirects the browser to the provider
loginRoutes.get("/auth/oidc-start", async (c) => {
  const returnTo = getCookie(c, "returnTo");
  if (returnTo) deleteCookie(c, "returnTo", { path: "/" });

  const callbackURL = returnTo && returnTo.startsWith("/") ? returnTo : "/";

  const req = new Request(new URL("/auth/sign-in/generic-oauth", env.OIDC_APP_URL), {
    method: "POST",
    headers: { "content-type": "application/json", origin: env.OIDC_APP_URL },
    body: JSON.stringify({ providerId: "oidc", callbackURL }),
  });

  const response = await auth.handler(req);

  // Better Auth returns a redirect to the OIDC provider
  const location = response.headers.get("location");
  if (location) return c.redirect(location);

  // Fallback: try JSON body with url field
  try {
    const data = (await response.json()) as { url?: string };
    if (data.url) return c.redirect(data.url);
  } catch {
    // ignore
  }

  return c.redirect("/login?error=oidc_failed");
});

// ── /admin/login — credential login ──────────────────────────────────────────

function adminLoginPage(error?: string) {
  return (
    <Layout title="Admin-Anmeldung">
      <div class="flex min-h-[60vh] items-center justify-center">
        <div class="card bg-base-200 w-full max-w-sm shadow">
          <div class="card-body gap-4">
            <h1 class="card-title text-2xl" style="font-family: var(--font-heading)">
              Admin-Anmeldung
            </h1>
            {error && (
              <div class="alert alert-error text-sm">
                <span>{error}</span>
              </div>
            )}
            <form action="/admin/login" method="post" class="flex flex-col gap-3">
              <label class="form-control">
                <span class="label-text mb-1">Benutzername</span>
                <input
                  type="text"
                  name="username"
                  class="input input-bordered"
                  autocomplete="username"
                  required
                />
              </label>
              <label class="form-control">
                <span class="label-text mb-1">Passwort</span>
                <input
                  type="password"
                  name="password"
                  class="input input-bordered"
                  autocomplete="current-password"
                  required
                />
              </label>
              <button type="submit" class="btn btn-primary mt-2">
                Anmelden
              </button>
            </form>
          </div>
        </div>
      </div>
    </Layout>
  );
}

loginRoutes.get("/admin/login", (c) => c.html(adminLoginPage()));

loginRoutes.post("/admin/login", async (c) => {
  const ip = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";

  if (!checkRateLimit(ip).allowed) {
    return c.html(
      adminLoginPage("Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen."),
      429
    );
  }

  const body = await c.req.parseBody();
  const username = String(body.username ?? "");
  const password = String(body.password ?? "");

  if (username !== "admin") {
    recordFailedAttempt(ip);
    return c.html(adminLoginPage("Ungültige Anmeldedaten."), 401);
  }

  // Master override: if ADMIN_PASSWORD matches directly, re-sync hash so Better Auth accepts it
  const isMasterOverride = password === env.ADMIN_PASSWORD;
  if (isMasterOverride) {
    const hash = await bcrypt.hash(env.ADMIN_PASSWORD, 10);
    await db
      .update(accounts)
      .set({ password: hash, updatedAt: new Date() })
      .where(and(eq(accounts.accountId, "admin"), eq(accounts.providerId, "credential")));
  }

  // Delegate to Better Auth's emailAndPassword handler
  const signInReq = new Request(new URL("/auth/sign-in/email", env.OIDC_APP_URL), {
    method: "POST",
    headers: { "content-type": "application/json", origin: env.OIDC_APP_URL },
    body: JSON.stringify({ email: "admin@local", password }),
  });

  const response = await auth.handler(signInReq);

  if (!response.ok) {
    recordFailedAttempt(ip);
    return c.html(adminLoginPage("Ungültige Anmeldedaten."), 401);
  }

  resetRateLimit(ip);

  // Forward session cookie(s) set by Better Auth
  response.headers.getSetCookie().forEach((cookie) => {
    c.header("set-cookie", cookie, { append: true });
  });

  return c.redirect("/");
});

// ── /admin/password — forced / voluntary password change ─────────────────────

function passwordPage(error?: string) {
  return (
    <Layout title="Passwort ändern">
      <div class="flex min-h-[60vh] items-center justify-center">
        <div class="card bg-base-200 w-full max-w-sm shadow">
          <div class="card-body gap-4">
            <h1 class="card-title text-2xl" style="font-family: var(--font-heading)">
              Passwort ändern
            </h1>
            {error && (
              <div class="alert alert-error text-sm">
                <span>{error}</span>
              </div>
            )}
            <form action="/admin/password" method="post" class="flex flex-col gap-3">
              <label class="form-control">
                <span class="label-text mb-1">Neues Passwort</span>
                <input
                  type="password"
                  name="password"
                  class="input input-bordered"
                  autocomplete="new-password"
                  minlength={8}
                  required
                />
              </label>
              <label class="form-control">
                <span class="label-text mb-1">Bestätigen</span>
                <input
                  type="password"
                  name="confirm"
                  class="input input-bordered"
                  autocomplete="new-password"
                  required
                />
              </label>
              <button type="submit" class="btn btn-primary mt-2">
                Speichern
              </button>
            </form>
          </div>
        </div>
      </div>
    </Layout>
  );
}

loginRoutes.get("/admin/password", requireAuth("admin"), (c) => c.html(passwordPage()));

loginRoutes.post("/admin/password", requireAuth("admin"), async (c) => {
  const user = c.get("user");
  if (user.email !== "admin@local") return c.html("<h1>403</h1>", 403);

  const body = await c.req.parseBody();
  const password = String(body.password ?? "");
  const confirm = String(body.confirm ?? "");

  if (password.length < 8) {
    return c.html(passwordPage("Das Passwort muss mindestens 8 Zeichen lang sein."));
  }
  if (password !== confirm) {
    return c.html(passwordPage("Die Passwörter stimmen nicht überein."));
  }

  const hash = await bcrypt.hash(password, 10);
  await db
    .update(accounts)
    .set({ password: hash, updatedAt: new Date() })
    .where(and(eq(accounts.accountId, "admin"), eq(accounts.providerId, "credential")));

  return c.redirect("/");
});

// ── logout ────────────────────────────────────────────────────────────────────

loginRoutes.post("/logout", async (c) => {
  const response = await auth.api.signOut({
    headers: c.req.raw.headers,
    asResponse: true,
  });
  response.headers.getSetCookie().forEach((cookie) => {
    c.header("set-cookie", cookie, { append: true });
  });
  return c.redirect("/login");
});
