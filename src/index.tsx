import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { getCookie, deleteCookie } from "hono/cookie";
import { validateEnv, env } from "./env.js";
import { auth } from "./auth.js";
import { loginRoutes } from "./routes/login.js";
import { requireAuth, type Variables } from "./middleware/auth.js";
import { Layout } from "./components/layout.js";

validateEnv();

const app = new Hono<{ Variables: Variables }>();

// Static assets
app.use("/css/*", serveStatic({ root: "./public" }));
app.use("/fonts/*", serveStatic({ root: "./public" }));

// Better Auth handler — intercept callback errors for unknown OIDC users
app.on(["POST", "GET"], "/auth/*", async (c) => {
  const response = await auth.handler(c.req.raw);
  if (c.req.path.startsWith("/auth/callback/") && !response.ok) {
    return c.redirect("/login?error=unknown_user");
  }
  return response;
});

// Auth + password routes
app.route("/", loginRoutes);

// Protected home — handles returnTo redirect after OIDC login
app.get("/", requireAuth(), (c) => {
  const returnTo = getCookie(c, "returnTo");
  if (returnTo && returnTo.startsWith("/") && returnTo !== "/") {
    deleteCookie(c, "returnTo", { path: "/" });
    return c.redirect(returnTo);
  }

  const user = c.get("user");
  return c.html(
    <Layout user={user}>
      <div class="text-center mt-16">
        <h1 class="text-4xl font-bold text-primary" style="font-family: var(--font-heading)">
          {env.ORG_NAME}
        </h1>
        <p class="mt-2 opacity-70">Mitglieder-Datenbank</p>
      </div>
    </Layout>
  );
});

serve({ fetch: app.fetch, port: 3000 }, () =>
  console.log(`${env.ORG_NAME} · http://localhost:3000`)
);
