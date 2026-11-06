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

export function notFoundPage(c: Context, user?: AuthedUser) {
  return c.html(
    <Layout title={t("error.notFound.title")} user={user}>
      <div class="text-center mt-16">
        <h1 class="text-3xl font-bold">{t("error.notFound.heading")}</h1>
        <p class="mt-4 opacity-70">{t("error.notFound.text")}</p>
        <a href="/" class="btn btn-primary mt-6">{t("error.toHome")}</a>
      </div>
    </Layout>,
    404
  );
}

export function serverErrorPage(c: Context, user: AuthedUser | undefined, requestId: string) {
  return c.html(
    <Layout title={t("error.server.title")} user={user}>
      <div class="text-center mt-16">
        <h1 class="text-3xl font-bold">{t("error.server.heading")}</h1>
        <p class="mt-4 opacity-70">{t("error.server.text")}</p>
        <p class="mt-2 text-sm opacity-60">{t("error.requestId", { id: requestId })}</p>
        <a href="/" class="btn btn-primary mt-6">{t("error.toHome")}</a>
      </div>
    </Layout>,
    500
  );
}
