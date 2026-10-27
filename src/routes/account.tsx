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
import { LOCAL_ADMIN_ACCOUNT_ID } from "../lib/constants.js";

export const accountRoutes = new Hono<{ Variables: Variables }>();

const guard = requireAuth(undefined, { allowPending: true });

function DeleteAccount({ email, back }: { email: string; back: "/account" | "/pending" }) {
  return (
    <>
      <button class="btn btn-outline btn-error" onclick="document.getElementById('delete-account').showModal()">
        {t("account.delete.heading")}
      </button>
      <dialog id="delete-account" class="modal">
        <div class="modal-box">
          <h3 class="font-bold text-lg">{t("account.delete.confirmTitle")}</h3>
          <p class="py-2 opacity-70">{t("account.delete.confirmBody")}</p>
          <form method="post" action="/account/delete" id="delete-account-form">
            <input type="hidden" name="back" value={back} />
            <label class="label" for="delete-account-email">{t("account.delete.emailLabel")}</label>
            <input
              id="delete-account-email"
              name="email"
              type="text"
              class="input input-bordered w-full"
              placeholder={email}
              autocomplete="off"
              oninput={`document.getElementById('delete-account-submit').disabled = this.value.trim().toLowerCase() !== ${JSON.stringify(email.toLowerCase()).replace(/</g, "\\u003c")}`}
            />
          </form>
          <div class="modal-action">
            <form method="dialog">
              <button class="btn">{t("common.cancel")}</button>
            </form>
            <button id="delete-account-submit" type="submit" form="delete-account-form" class="btn btn-error" disabled>{t("account.delete.heading")}</button>
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
          <DeleteAccount email={user.email} back="/pending" />
        </div>
        <p class="text-sm opacity-50 mt-4">{t("account.danger.body")}</p>
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
  const isLocalAdmin = user.id === LOCAL_ADMIN_ACCOUNT_ID;
  return c.html(
    <Layout title={t("account.title")} user={user}>
      <div class="max-w-xl mx-auto">
        <PageHeader title={t("account.title")} />
        {/* Name and email come from the OIDC provider and are not editable here. */}
        <h2 class="text-lg font-semibold mb-2">{t("account.profile.heading")}</h2>
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
        {env.OIDC_ACCOUNT_URL && !isLocalAdmin && (
          <section class="mb-6">
            <h2 class="text-lg font-semibold mb-1">{t("account.login.heading")}</h2>
            <p class="opacity-70 mb-3">{t("account.login.body")}</p>
            <a class="btn btn-outline" href={env.OIDC_ACCOUNT_URL} target="_blank" rel="noopener noreferrer">
              {t("account.manageLogin")} <span aria-hidden="true">↗</span>
            </a>
          </section>
        )}
        {!isLocalAdmin && (
          <section class="border border-error rounded-box p-4">
            <h2 class="text-lg font-semibold text-error mb-1">{t("account.danger.heading")}</h2>
            <p class="opacity-70 mb-3">{t("account.danger.body")}</p>
            <DeleteAccount email={user.email} back="/account" />
          </section>
        )}
      </div>
    </Layout>,
  );
});

accountRoutes.post("/delete", guard, async (c) => {
  const user = c.get("user");
  const form = await c.req.parseBody();
  const back = form.back === "/pending" ? "/pending" : "/account";
  if (String(form.email ?? "").trim().toLowerCase() !== user.email.toLowerCase()) {
    setFlash(c, t("account.delete.errorEmail"), "error");
    return c.redirect(back);
  }
  const block = await deleteOwnAccount(user.id, user.permissions.has("system:admin"));
  if (block) {
    setFlash(c, t(block === "localAdmin" ? "account.delete.errorLocalAdmin" : "account.delete.errorLastAdmin"), "error");
    return c.redirect(back);
  }
  await auth.api.signOut({ headers: c.req.raw.headers }).catch(() => undefined);
  return c.redirect("/login");
});
