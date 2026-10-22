import { Hono } from "hono";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { PermissionBadges } from "../components/permission-badges.js";
import { Layout } from "../components/layout.js";
import { FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { deleteOwnAccount } from "../lib/account.js";
import { auth } from "../auth.js";
import { env } from "../env.js";
import { db } from "../db/index.js";
import { appRoles, userAppRoles } from "../db/schema/index.js";
import { eq } from "drizzle-orm";

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
  // Active (verified email + a role) → nothing to wait for.
  if (user.permissions.size > 0 && user.emailVerified) return c.redirect("/");
  const unverified = !user.emailVerified;
  return c.html(
    <Layout title={t("pending.title")}>
      <div class="max-w-md mx-auto text-center mt-16">
        <PageHeader title={t(unverified ? "pending.unverified.title" : "pending.title")} />
        <p class="opacity-70 mb-2">{t(unverified ? "pending.unverified.body" : "pending.body")}</p>
        <p class="text-sm opacity-70 mb-6">{t("pending.signedInAs")} <strong>{user.email}</strong></p>
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

accountRoutes.get("/", guard, async (c) => {
  const user = c.get("user");
  const roles = await db
    .select({ name: appRoles.name })
    .from(userAppRoles)
    .innerJoin(appRoles, eq(appRoles.id, userAppRoles.roleId))
    .where(eq(userAppRoles.userId, user.id));
  return c.html(
    <Layout title={t("account.title")} user={user}>
      <div class="max-w-xl mx-auto">
        <PageHeader title={t("account.title")} />
        {/* Name and email come from the OIDC provider and are not editable here. */}
        <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 mb-6">
          <dt class="opacity-60">{t("account.profile.name")}</dt>
          <dd>{user.name}</dd>
          <dt class="opacity-60">{t("account.profile.email")}</dt>
          <dd>{user.email}</dd>
          <dt class="opacity-60">{t("account.profile.roles")}</dt>
          <dd class="flex flex-wrap gap-1">
            {roles.length === 0 ? <span class="opacity-40">—</span> : roles.map((r) => <span class="badge badge-outline badge-sm">{r.name}</span>)}
          </dd>
          <dt class="opacity-60">{t("account.profile.permissions")}</dt>
          <dd>{user.permissions.size === 0 ? <span class="opacity-40">—</span> : <PermissionBadges permissions={[...user.permissions]} />}</dd>
        </dl>
        {env.OIDC_ACCOUNT_URL && (
          <p class="mb-4">
            <a class="link" href={env.OIDC_ACCOUNT_URL} target="_blank" rel="noopener noreferrer">{t("account.manageLogin")}</a>
          </p>
        )}
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
