import { Hono } from "hono";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { PermissionBadges } from "../components/permission-badges.js";
import { Layout } from "../components/layout.js";
import { HeaderAction, PageHeader } from "../components/page-header.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { deleteOwnAccount, normalizeName, resolveAccountUrl } from "../lib/account.js";
import { auth } from "../auth.js";
import { env } from "../env.js";
import { db } from "../db/index.js";
import { appRoles, persons, userAppRoles, users } from "../db/schema/index.js";
import { isOptedOut, setEventMailsEnabled } from "../lib/event-mail.js";
import { eq } from "drizzle-orm";
import { HTTP_STATUS, LOCAL_ADMIN_ACCOUNT_ID } from "../lib/constants.js";

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
              class="input w-full"
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

const NAME_SWAP = { "hx-target": "#account-name", "hx-swap": "outerHTML" };

// Header actions follow the name row's mode; edit/cancel responses re-send them out-of-band.
function NameActions({ editing = false, oob = false }: { editing?: boolean; oob?: boolean }) {
  return (
    <div id="account-actions" class="contents" hx-swap-oob={oob ? "true" : undefined}>
      {editing ? (<>
        <HeaderAction icon="x-mark" label={t("common.cancel")} class="btn-outline" attrs={{ "hx-get": "/account/name", ...NAME_SWAP }} />
        <HeaderAction variant="primary" icon="check" label={t("common.save")} form="account-name-form" class="btn-primary" />
      </>) : (
        <HeaderAction variant="primary" icon="pencil" label={t("common.edit")} class="btn-primary" attrs={{ "hx-get": "/account/name/edit", ...NAME_SWAP }} />
      )}
    </div>
  );
}

// The <dd> is swapped as a whole (the <dl> is a dt/dd grid); the local admin's name stays plain text.
function NameRow({ name, editing = false, error = false, readOnly = false, oob = false }: { name: string; editing?: boolean; error?: boolean; readOnly?: boolean; oob?: boolean }) {
  if (readOnly) return <dd>{name}</dd>;
  return (<>
    {editing ? (
      <dd id="account-name" hx-target="this" hx-swap="outerHTML">
        <form id="account-name-form" hx-post="/account/name" class="flex flex-wrap items-center gap-2">
          <input name="name" value={name} required maxlength={100} class={`input input-sm ${error ? "input-error" : ""}`} aria-label={t("account.profile.name")} />
          {error && <p class="text-error text-sm w-full">{t("account.name.error")}</p>}
        </form>
      </dd>
    ) : (
      <dd id="account-name">{name}</dd>
    )}
    {oob && <NameActions editing={editing} oob />}
  </>);
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
  const [person] = await db.select({ id: persons.id }).from(persons).where(eq(persons.userId, user.id));
  const eventMails = person ? !(await isOptedOut(person.id)) : null;
  const accountUrl = resolveAccountUrl(env.OIDC_ACCOUNT_URL, env.OIDC_PROVIDER);
  return c.html(
    <Layout title={t("account.title")} user={user}>
      <div class="max-w-xl mx-auto">
        <PageHeader title={t("account.title")} actions={!isLocalAdmin && <NameActions />} />
        {/* Email comes from the OIDC provider and is not editable here. */}
        <h2 class="text-lg font-semibold mb-2">{t("account.profile.heading")}</h2>
        <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 mb-6">
          <dt class="opacity-60">{t("account.profile.name")}</dt>
          <NameRow name={user.name} readOnly={isLocalAdmin} />
          <dt class="opacity-60">{t("account.profile.email")}</dt>
          <dd>{user.email}</dd>
          <dt class="opacity-60">{t("account.profile.roles")}</dt>
          <dd class="flex flex-wrap gap-1">
            {roles.length === 0 ? <span class="opacity-40">—</span> : roles.map((r) => <span class="badge badge-outline badge-sm">{r.name}</span>)}
          </dd>
          <dt class="opacity-60">{t("account.profile.permissions")}</dt>
          <dd>{user.permissions.size === 0 ? <span class="opacity-40">—</span> : <PermissionBadges permissions={[...user.permissions]} />}</dd>
        </dl>
        <script dangerouslySetInnerHTML={{ __html: `document.body.addEventListener('htmx:beforeSwap', function (e) {
          if (e.detail.xhr.status === 422 && e.detail.requestConfig.elt.id === 'account-name-form') { e.detail.shouldSwap = true; e.detail.isError = false; }
        });` }} />
        {eventMails !== null && (
          <form method="post" action="/account/mail-prefs" class="mb-6">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="events" class="checkbox" checked={eventMails} onchange="this.form.submit()" />
              <span>{t("mail.prefs.events")}</span>
            </label>
          </form>
        )}
        {accountUrl && !isLocalAdmin && (
          <section class="mb-6">
            <h2 class="text-lg font-semibold mb-1">{t("account.login.heading")}</h2>
            <p class="opacity-70 mb-3">{t("account.login.body")}</p>
            <a class="btn btn-outline" href={accountUrl} target="_blank" rel="noopener noreferrer">
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

accountRoutes.post("/mail-prefs", guard, async (c) => {
  const [person] = await db.select({ id: persons.id }).from(persons).where(eq(persons.userId, c.get("user").id));
  if (person) await setEventMailsEnabled(person.id, (await c.req.parseBody()).events === "on", "account");
  return c.redirect("/account");
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

accountRoutes.get("/name", guard, (c) => c.html(<NameRow name={c.get("user").name} oob />));
accountRoutes.get("/name/edit", guard, (c) => c.html(<NameRow name={c.get("user").name} editing oob />));

accountRoutes.post("/name", guard, async (c) => {
  const user = c.get("user");
  if (user.id === LOCAL_ADMIN_ACCOUNT_ID) return c.text("", HTTP_STATUS.FORBIDDEN);
  const raw = String((await c.req.parseBody()).name ?? "");
  const name = normalizeName(raw);
  if (!name) return c.html(<NameRow name={raw} editing error oob />, HTTP_STATUS.UNPROCESSABLE_ENTITY);
  await db.update(users).set({ name, updatedAt: new Date() }).where(eq(users.id, user.id));
  setFlash(c, t("account.name.saved"), "success");
  c.header("HX-Redirect", "/account");
  return c.body(null);
});
