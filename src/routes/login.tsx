import { hashPassword } from "better-auth/crypto";
import { eq, and } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie, deleteCookie } from "hono/cookie";
import { auth } from "../auth.js";
import { db } from "../db/index.js";
import { accounts } from "../db/schema/index.js";
import { Icon } from "../components/icon.js";
import { Layout } from "../components/layout.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { env } from "../env.js";
import { checkRateLimit, recordFailedAttempt, resetRateLimit } from "../lib/ratelimit.js";
import { LOCAL_ADMIN_ACCOUNT_ID, LOCAL_ADMIN_EMAIL, HTTP_STATUS } from "../lib/constants.js";
import { t } from "../i18n/index.js";

export const loginRoutes = new Hono<{ Variables: Variables }>();

// ── /login — OIDC entry point ─────────────────────────────────────────────────

loginRoutes.get("/login", async (c) => {
  const error = c.req.query("error");
  const errorMsg =
    error === "unknown_user"
      ? t("login.error.unknownUser")
      : error === "disabled"
        ? t("login.error.disabled")
        : error === "registration_disabled"
          ? t("login.error.registrationDisabled")
          : error === "email_unverified"
            ? t("login.error.emailUnverified")
            : error
              ? t("login.error.generic")
              : null;

  // Without an error go straight to the provider; with one, stay (redirecting again would loop).
  if (!error) return c.redirect("/auth/oidc-start");

  const heading = env.ORG_NAME;

  return c.html(
    <Layout title={t("login.title")}>
      <div class="flex min-h-[70vh] items-center justify-center rounded-box bg-base-200 p-4">
        <div class="card bg-base-100 border border-base-300 w-full max-w-sm shadow">
          <div class="card-body gap-4 items-center text-center">
            <Icon name="fire" class="w-12 h-12 text-primary" />
            <h1 class="card-title text-2xl" style="font-family: var(--font-heading)">
              {heading}
            </h1>
            {errorMsg && (
              <div class="alert alert-error text-sm">
                <span>{errorMsg}</span>
              </div>
            )}
            <a href="/auth/oidc-start" class="btn btn-primary w-full">
              {t("login.oidcButton")}
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

  const req = new Request(new URL("/auth/sign-in/social", env.OIDC_APP_URL), {
    method: "POST",
    headers: { "content-type": "application/json", origin: env.OIDC_APP_URL },
    body: JSON.stringify({ provider: "oidc", callbackURL }),
  });

  const response = await auth.handler(req);

  // Better Auth returns a redirect to the OIDC provider
  const location = response.headers.get("location");
  if (location) return c.redirect(location);

  // Better Auth returns { url: "..." } for social sign-in
  try {
    const data = (await response.json()) as { url?: string };
    if (data.url) return c.redirect(data.url);
    logger.error({ keys: Object.keys(data) }, "[oidc-start] unexpected json from Better Auth");
  } catch (e) {
    logger.error({ err: e, status: response.status }, "[oidc-start] failed");
  }

  return c.redirect("/login?error=oidc_failed");
});

// ── /admin/login — credential login ──────────────────────────────────────────

function adminLoginPage(error?: string) {
  return (
    <Layout title={t("login.admin.title")}>
      <div class="flex min-h-[60vh] items-center justify-center">
        <div class="card bg-base-200 w-full max-w-sm shadow">
          <div class="card-body gap-4">
            <h1 class="card-title text-2xl" style="font-family: var(--font-heading)">
              {t("login.admin.title")}
            </h1>
            {error && (
              <div class="alert alert-error text-sm">
                <span>{error}</span>
              </div>
            )}
            <form action="/admin/login" method="post" class="flex flex-col gap-3">
              <label class="form-control">
                <span class="label-text mb-1">{t("login.admin.username")}</span>
                <input
                  type="text"
                  name="username"
                  class="input input-bordered"
                  autocomplete="username"
                  autofocus
                  required
                />
              </label>
              <label class="form-control">
                <span class="label-text mb-1">{t("login.admin.password")}</span>
                <input
                  type="password"
                  name="password"
                  class="input input-bordered"
                  autocomplete="current-password"
                  required
                />
              </label>
              <button type="submit" class="btn btn-primary mt-2">
                {t("login.admin.submit")}
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
      adminLoginPage(t("login.admin.error.tooManyAttempts")),
      429
    );
  }

  const body = await c.req.parseBody();
  const username = String(body.username ?? "");
  const password = String(body.password ?? "");

  if (username !== LOCAL_ADMIN_ACCOUNT_ID) {
    recordFailedAttempt(ip);
    return c.html(adminLoginPage(t("login.admin.error.invalidCredentials")), HTTP_STATUS.UNAUTHORIZED);
  }

  // Master override: if ADMIN_PASSWORD matches directly, re-sync hash so Better Auth accepts it
  const isMasterOverride = password === env.ADMIN_PASSWORD;
  if (isMasterOverride) {
    const hash = await hashPassword(env.ADMIN_PASSWORD);
    await db
      .update(accounts)
      .set({ password: hash, updatedAt: new Date() })
      .where(and(eq(accounts.accountId, LOCAL_ADMIN_ACCOUNT_ID), eq(accounts.providerId, "credential")));
  }

  // Delegate to Better Auth's emailAndPassword handler
  const signInReq = new Request(new URL("/auth/sign-in/email", env.OIDC_APP_URL), {
    method: "POST",
    headers: { "content-type": "application/json", origin: env.OIDC_APP_URL },
    body: JSON.stringify({ email: LOCAL_ADMIN_EMAIL, password }),
  });

  const response = await auth.handler(signInReq);

  if (!response.ok) {
    recordFailedAttempt(ip);
    return c.html(adminLoginPage(t("login.admin.error.invalidCredentials")), HTTP_STATUS.UNAUTHORIZED);
  }

  resetRateLimit(ip);

  // Forward session cookie(s) set by Better Auth
  response.headers.getSetCookie().forEach((cookie) => {
    c.header("set-cookie", cookie, { append: true });
  });

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
