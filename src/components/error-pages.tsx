import type { Context } from "hono";
import type { AuthedUser } from "../middleware/auth.js";
import { t } from "../i18n/index.js";
import { Layout } from "./layout.js";

// Extracted from index.tsx's onError so it's testable without booting the whole app/server.
export function forbiddenPage(c: Context, user?: AuthedUser) {
  return c.html(
    <Layout title={t("error.forbidden.title")} user={user}>
      <div class="text-center mt-16">
        <h1 class="text-3xl font-bold">{t("error.forbidden.heading")}</h1>
        <p class="mt-4 opacity-70">{t("error.forbidden.text")}</p>
        <a href="/" class="btn btn-primary mt-6">{t("error.toHome")}</a>
      </div>
    </Layout>,
    403
  );
}
