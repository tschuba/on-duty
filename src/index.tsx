import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { getCookie, deleteCookie } from "hono/cookie";
import { validateEnv } from "./env.js";
import { auth } from "./auth.js";
import { env } from "./env.js";
import { startBackupScheduler } from "./lib/backup.js";
import { accountRoutes, pendingRoutes } from "./routes/account.js";
import { hookRoutes } from "./routes/hooks.js";
import { loginRoutes } from "./routes/login.js";
import { applyRoutes } from "./routes/apply.js";
import { memberRoutes } from "./routes/members.js";
import { applicationRoutes } from "./routes/applications.js";
import { adminRoutes } from "./routes/admin.js";
import { organisationRoutes } from "./routes/organisation.js";
import { anniversaryRoutes } from "./routes/anniversaries.js";
import { donationRoutes } from "./routes/donations.js";
import { donorRoutes } from "./routes/donors.js";
import { inventoryRoutes } from "./routes/inventory.js";
import { lendingRoutes } from "./routes/lending.js";
import { requireAuth, type Variables } from "./middleware/auth.js";
import { Layout } from "./components/layout.js";

validateEnv();

const app = new Hono<{ Variables: Variables }>();

app.get("/health", (c) => c.text("ok"));

// Static assets
app.use("/css/*", serveStatic({ root: "./public" }));
app.use("/fonts/*", serveStatic({ root: "./public" }));
app.use("/js/*", serveStatic({ root: "./public" }));

// Auth + password routes
app.route("/", loginRoutes);

// Public application forms — no auth guard, see backlog "Digitale Anträge"
app.route("/apply", applyRoutes);

// Optional provider webhooks (signature-verified, inactive unless configured)
app.route("/hooks", hookRoutes);

// Better Auth handler
app.on(["POST", "GET"], "/auth/*", async (c) => {
  const response = await auth.handler(c.req.raw);
  if (c.req.path.startsWith("/auth/callback/")) {
    // Hook rejections arrive as a redirect to better-auth's error URL carrying `error=<code>`.
    const code = new URL(response.headers.get("location") ?? "/", env.OIDC_APP_URL).searchParams.get("error");
    if (code === "registration_disabled" || code === "email_unverified") return c.redirect(`/login?error=${code}`);
    if (response.status >= 400 || code) return c.redirect("/login?error=unknown_user");
  }
  return response;
});

// / → /members (handles returnTo cookie from OIDC redirect)
app.get("/", requireAuth(), (c) => {
  const returnTo = getCookie(c, "returnTo");
  if (returnTo && returnTo.startsWith("/") && returnTo !== "/") {
    deleteCookie(c, "returnTo", { path: "/" });
    return c.redirect(returnTo);
  }
  return c.redirect("/members");
});

// Self-registration: waiting screen + account deletion
app.route("/pending", pendingRoutes);
app.route("/account", accountRoutes);

// Member routes
app.route("/members", memberRoutes);

// Application review routes
app.route("/applications", applicationRoutes);

// Anniversary routes
app.route("/anniversaries", anniversaryRoutes);

// Donation routes
app.route("/donations", donationRoutes);
app.route("/donors", donorRoutes);

// Inventory routes — lending mounted first: more specific prefix before /inventory's own :id routes.
app.route("/inventory/lending", lendingRoutes);
app.route("/inventory", inventoryRoutes);

// Admin routes
app.route("/admin", adminRoutes);
app.route("/organisation", organisationRoutes);

// 404
app.notFound((c) => {
  const user = c.get("user");
  return c.html(
    <Layout title="Nicht gefunden" user={user}>
      <div class="text-center mt-16">
        <h1 class="text-3xl font-bold">404 – Seite nicht gefunden</h1>
        <p class="mt-4 opacity-70">Die angeforderte Seite existiert nicht.</p>
        <a href="/" class="btn btn-primary mt-6">Zur Startseite</a>
      </div>
    </Layout>,
    404
  );
});

// 500
app.onError((err, c) => {
  console.error(err);
  const user = c.get("user");
  return c.html(
    <Layout title="Serverfehler" user={user}>
      <div class="text-center mt-16">
        <h1 class="text-3xl font-bold">500 – Serverfehler</h1>
        <p class="mt-4 opacity-70">Ein unerwarteter Fehler ist aufgetreten.</p>
        <a href="/" class="btn btn-primary mt-6">Zur Startseite</a>
      </div>
    </Layout>,
    500
  );
});

serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log(`${env.ORG_NAME} · http://localhost:3000`);
  startBackupScheduler().catch((err) => console.error("[backup] Scheduler-Start fehlgeschlagen:", err));
});
