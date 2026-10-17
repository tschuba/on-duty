import { Hono } from "hono";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { deleteOwnAccount } from "../lib/account.js";
import { auth } from "../auth.js";

export const accountRoutes = new Hono<{ Variables: Variables }>();

const guard = requireAuth(undefined, { allowPending: true });

function DeleteAccount() {
  return (
    <>
      <button class="btn btn-outline btn-error" onclick="document.getElementById('delete-account').showModal()">
        {t("account.delete.heading")}
      </button>
      <dialog id="delete-account" class="modal">
        <div class="modal-box">
          <h3 class="font-bold text-lg">{t("account.delete.confirmTitle")}</h3>
          <p class="py-2 opacity-70">{t("account.delete.confirmBody")}</p>
          <div class="modal-action">
            <form method="dialog">
              <button class="btn">{t("common.cancel")}</button>
            </form>
            <form method="post" action="/account/delete">
              <button type="submit" class="btn btn-error">{t("account.delete.heading")}</button>
            </form>
          </div>
        </div>
      </dialog>
    </>
  );
}

// Users without a role see this instead of the app. Rendered without nav (no `user` passed): they have no permissions.
export const pendingRoutes = new Hono<{ Variables: Variables }>();
pendingRoutes.get("/", guard, (c) => {
  const user = c.get("user");
  // Already approved → nothing to wait for.
  if (user.permissions.size > 0) return c.redirect("/");
  return c.html(
    <Layout title={t("pending.title")}>
      <div class="max-w-md mx-auto text-center mt-16">
        <h1 class="text-2xl font-bold mb-4" style="font-family: var(--font-heading)">{t("pending.title")}</h1>
        <p class="opacity-70 mb-6">{t("pending.body")}</p>
        <div class="flex gap-2 justify-center">
          <form method="post" action="/logout">
            <button type="submit" class="btn">{t("pending.logout")}</button>
          </form>
          <DeleteAccount />
        </div>
        <p class="text-sm opacity-50 mt-4">{t("account.delete.body")}</p>
      </div>
    </Layout>,
  );
});

accountRoutes.get("/", guard, (c) => {
  const user = c.get("user");
  return c.html(
    <Layout title={t("account.title")} user={user}>
      <div class="max-w-xl mx-auto">
        <h1 class="text-2xl font-bold mb-4" style="font-family: var(--font-heading)">{t("account.title")}</h1>
        <p class="opacity-70 mb-4">{t("account.delete.body")}</p>
        <DeleteAccount />
      </div>
    </Layout>,
  );
});

accountRoutes.post("/delete", guard, async (c) => {
  const user = c.get("user");
  const block = await deleteOwnAccount(user.id, user.permissions.has("system:admin"));
  if (block) {
    setFlash(c, t(block === "localAdmin" ? "account.delete.errorLocalAdmin" : "account.delete.errorLastAdmin"), "error");
    return c.redirect("/account");
  }
  await auth.api.signOut({ headers: c.req.raw.headers }).catch(() => undefined);
  return c.redirect("/login");
});
