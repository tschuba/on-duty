import { Hono } from "hono";
import { eq, and, count, asc, desc, inArray } from "drizzle-orm";
import { setCookie } from "hono/cookie";
import { db } from "../db/index.js";
import {
  users,
  sessions,
  accounts,
  memberRoles,
  memberRoleAssignments,
  anniversaryYears,
  backupHistory,
  appRoles,
  appRolePermissions,
  userAppRoles,
  orgConfig,
} from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { ClickToEditHint, Layout } from "../components/layout.js";
import { env, ENV_META } from "../env.js";
import { getCronScheduleTimes, getLastBackup, isBackupConfigured, runBackup } from "../lib/backup.js";
import { t } from "../i18n/index.js";
import { PERMISSIONS, groupPermissionsForBadges, type Permission } from "../lib/roles.js";

export const adminRoutes = new Hono<{ Variables: Variables }>();
const guard = requireAuth("system:admin");

// system:admin is reserved for the built-in protected `admin` role — never offered
// as a checkbox when composing a custom role in the "Berechtigungen" UI.
const ASSIGNABLE_PERMISSIONS = PERMISSIONS.filter((p) => p !== "system:admin");

const PERMISSION_LABELS: Record<Permission, string> = {
  "members:read": t("admin.permissions.key.membersRead"),
  "members:write": t("admin.permissions.key.membersWrite"),
  "system:admin": t("admin.permissions.key.systemAdmin"),
  "donations:record": t("admin.permissions.key.donationsRecord"),
  "donations:issue-receipts": t("admin.permissions.key.donationsIssueReceipts"),
};

const RESOURCE_LABELS: Record<string, string> = {
  members: t("admin.permissions.resource.members"),
  system: t("admin.permissions.resource.system"),
  donations: t("admin.permissions.resource.donations"),
};

function setFlash(c: any, msg: string, type: "success" | "error") {
  setCookie(c, "flash", JSON.stringify({ message: msg, type }), {
    path: "/",
    maxAge: 10,
    httpOnly: false,
  });
}

function AdminTabs({ active }: { active: "users" | "permissions" | "roles" | "anniversaries" | "config" | "org-config" | "backup" }) {
  return (
    <div role="tablist" class="tabs tabs-lifted mb-6">
      <a href="/admin/users" role="tab" class={`tab${active === "users" ? " tab-active" : ""}`}>
        {t("admin.tabs.users")}
      </a>
      <a href="/admin/permissions" role="tab" class={`tab${active === "permissions" ? " tab-active" : ""}`}>
        {t("admin.tabs.permissions")}
      </a>
      <a href="/admin/roles" role="tab" class={`tab${active === "roles" ? " tab-active" : ""}`}>
        {t("admin.tabs.roles")}
      </a>
      <a href="/admin/anniversaries" role="tab" class={`tab${active === "anniversaries" ? " tab-active" : ""}`}>
        {t("admin.tabs.anniversaries")}
      </a>
      <a href="/admin/config" role="tab" class={`tab${active === "config" ? " tab-active" : ""}`}>
        {t("admin.tabs.config")}
      </a>
      <a href="/admin/org-config" role="tab" class={`tab${active === "org-config" ? " tab-active" : ""}`}>
        {t("admin.tabs.orgConfig")}
      </a>
      <a href="/admin/backup" role="tab" class={`tab${active === "backup" ? " tab-active" : ""}`}>
        {t("admin.tabs.backup")}
      </a>
    </div>
  );
}

function BackupWarnBanner({ configured, lastFailed }: { configured: boolean; lastFailed: boolean }) {
  if (configured && !lastFailed) return null;
  if (!configured) {
    return (
      <div class="alert alert-warning mb-4">
        <span>{t("admin.backup.warnNotConfigured")}</span>
      </div>
    );
  }
  return (
    <div class="alert alert-error mb-4">
      <span>
        {t("admin.backup.warnLastFailed")}{" "}
        <a href="/admin/backup" class="link">{t("admin.backup.warnDetails")}</a>
      </span>
    </div>
  );
}

export async function backupWarnProps() {
  const configured = isBackupConfigured();
  const last = configured ? await getLastBackup() : null;
  const schedule = configured ? getCronScheduleTimes(env.BACKUP_SCHEDULE) : null;
  const lastFailed = schedule?.prev
    ? !(last?.startedAt && last.startedAt >= schedule.prev && last.status === "success")
    : last?.status === "failed";
  return { configured, lastFailed: lastFailed ?? false };
}

function ModalScaffold() {
  return (
    <dialog id="admin-modal" class="modal">
      <div class="modal-box max-w-lg" id="modal-content" />
      <form method="dialog" class="modal-backdrop">
        <button>{t("common.close")}</button>
      </form>
    </dialog>
  );
}

function UserRoleBadges({ roles }: { roles: string[] }) {
  if (roles.length === 0) return <span class="text-base-content/40 text-sm">—</span>;
  if (roles.length === 1) {
    return <span class="badge badge-outline badge-sm whitespace-nowrap">{roles[0]}</span>;
  }
  return (
    <div class="dropdown dropdown-end dropdown-hover" onclick="event.stopPropagation()">
      <div tabindex={0} role="button" class="badge badge-neutral badge-sm cursor-pointer whitespace-nowrap">
        {t("admin.users.roleCount", { count: roles.length })}
      </div>
      <div tabindex={0} class="dropdown-content z-10 card card-compact bg-base-100 shadow border border-base-300 p-2 mt-1">
        <div class="flex flex-wrap gap-1 max-w-48">
          {roles.map((r) => <span class="badge badge-outline badge-sm whitespace-nowrap">{r}</span>)}
        </div>
      </div>
    </div>
  );
}

function PermissionBadges({ permissions }: { permissions: Permission[] }) {
  return (
    <div class="flex flex-wrap gap-1">
      {groupPermissionsForBadges(permissions).map((g) => {
        if (g.kind === "full") {
          return (
            <span key="full" class="badge badge-primary badge-sm whitespace-nowrap">
              {t("admin.permissions.badge.full")}
            </span>
          );
        }
        if (g.kind === "resource-full") {
          return (
            <span key={g.resource} class="badge badge-outline badge-primary badge-sm whitespace-nowrap">
              {t("admin.permissions.badge.resourceFull", { resource: RESOURCE_LABELS[g.resource] ?? g.resource })}
            </span>
          );
        }
        return (
          <span key={g.permission} class="badge badge-outline badge-sm whitespace-nowrap">
            {PERMISSION_LABELS[g.permission]}
          </span>
        );
      })}
    </div>
  );
}

// ── /admin → /admin/users ─────────────────────────────────────────────────────
adminRoutes.get("/", guard, (c) => c.redirect("/admin/users"));

// ── /admin/users ──────────────────────────────────────────────────────────────
adminRoutes.get("/users", guard, async (c) => {
  const user = c.get("user");
  const [allUsers, roleAssignments, warn] = await Promise.all([
    db.select().from(users).orderBy(asc(users.name)),
    db
      .select({ userId: userAppRoles.userId, roleName: appRoles.name })
      .from(userAppRoles)
      .innerJoin(appRoles, eq(appRoles.id, userAppRoles.roleId)),
    backupWarnProps(),
  ]);
  const rolesByUser = new Map<string, string[]>();
  for (const r of roleAssignments) {
    rolesByUser.set(r.userId, [...(rolesByUser.get(r.userId) ?? []), r.roleName]);
  }

  return c.html(
    <Layout title={t("admin.users.title")} user={user} activeNav="admin">
      <BackupWarnBanner {...warn} />
      <AdminTabs active="users" />
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">
          {t("admin.users.title")}
        </h1>
        <button
          class="btn btn-primary btn-sm"
          hx-get="/admin/users/new"
          hx-target="#modal-content"
          hx-swap="innerHTML"
        >
          {t("admin.users.newUser")}
        </button>
      </div>

      <ClickToEditHint />
      <div class="overflow-x-auto">
        <table class="table table-zebra w-full">
          <thead>
            <tr>
              <th>{t("admin.users.table.name")}</th>
              <th>{t("admin.users.table.email")}</th>
              <th>{t("admin.users.table.role")}</th>
              <th>{t("admin.users.table.status")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {allUsers.map((u) => {
              const isLocal = u.email === "admin@localhost.invalid";
              return (
                <tr
                  key={u.id}
                  {...(!isLocal && {
                    class: "cursor-pointer hover",
                    "hx-get": `/admin/users/${u.id}/edit`,
                    "hx-target": "#modal-content",
                    "hx-swap": "innerHTML",
                  })}
                >
                  <td class="font-medium">
                    {isLocal && <span class="mr-1">🔒</span>}
                    {u.name}
                  </td>
                  <td class="opacity-70">{isLocal ? "–" : u.email}</td>
                  <td>
                    <UserRoleBadges roles={rolesByUser.get(u.id) ?? []} />
                  </td>
                  <td>
                    {u.disabled ? (
                      <span class="badge badge-error badge-sm">{t("admin.users.statusDisabled")}</span>
                    ) : (
                      <span class="badge badge-success badge-sm">{t("admin.users.statusActive")}</span>
                    )}
                  </td>
                  <td>
                    {isLocal ? (
                      <span class="badge badge-neutral badge-sm">{t("admin.users.localAdminBadge")}</span>
                    ) : (
                      <div class="flex gap-2 justify-end">
                        {u.disabled ? (
                          <>
                            <form method="post" action={`/admin/users/${u.id}/activate`}>
                              <button
                                type="submit"
                                class="btn btn-ghost btn-xs text-success"
                                onclick="event.stopPropagation()"
                              >
                                {t("admin.users.activate")}
                              </button>
                            </form>
                            <button
                              class="btn btn-ghost btn-xs text-error"
                              onclick={`event.stopPropagation(); document.getElementById('delete-${u.id}').showModal()`}
                            >
                              {t("common.delete")}
                            </button>
                            <dialog id={`delete-${u.id}`} class="modal" onclick="event.stopPropagation()">
                              <div class="modal-box">
                                <h3 class="font-bold text-lg">{t("admin.users.confirmDelete.title")}</h3>
                                <p class="py-2 opacity-70">
                                  {t("admin.users.confirmDelete.body", { name: u.name, email: u.email })}
                                </p>
                                <div class="modal-action">
                                  <form method="dialog">
                                    <button class="btn">{t("common.cancel")}</button>
                                  </form>
                                  <form method="post" action={`/admin/users/${u.id}/delete`}>
                                    <button type="submit" class="btn btn-error">
                                      {t("common.delete")}
                                    </button>
                                  </form>
                                </div>
                              </div>
                              <form method="dialog" class="modal-backdrop">
                                <button>{t("common.close")}</button>
                              </form>
                            </dialog>
                          </>
                        ) : (
                          <>
                            <button
                              class={`btn btn-ghost btn-xs ${u.id === user.id ? "text-base-content/30" : "text-error"}`}
                              onclick={u.id === user.id ? "event.stopPropagation()" : `event.stopPropagation(); document.getElementById('deactivate-${u.id}').showModal()`}
                              disabled={u.id === user.id}
                              title={u.id === user.id ? t("admin.users.cannotDeactivateSelf") : undefined}
                            >
                              {t("admin.users.deactivate")}
                            </button>
                            <dialog id={`deactivate-${u.id}`} class="modal" onclick="event.stopPropagation()">
                              <div class="modal-box">
                                <h3 class="font-bold text-lg">{t("admin.users.confirmDeactivate.title")}</h3>
                                <p class="py-2 opacity-70">
                                  <strong>{u.name}</strong> wird deaktiviert. Aktive Sitzungen
                                  werden sofort beendet.
                                </p>
                                <div class="modal-action">
                                  <form method="dialog">
                                    <button class="btn">{t("common.cancel")}</button>
                                  </form>
                                  <form method="post" action={`/admin/users/${u.id}/deactivate`}>
                                    <button type="submit" class="btn btn-error">
                                      {t("admin.users.deactivate")}
                                    </button>
                                  </form>
                                </div>
                              </div>
                              <form method="dialog" class="modal-backdrop">
                                <button>{t("common.close")}</button>
                              </form>
                            </dialog>
                          </>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ModalScaffold />
    </Layout>
  );
});

function RoleCheckboxes({
  allRoles,
  permsByRole,
  checkedIds,
}: {
  allRoles: { id: string; name: string; description: string | null }[];
  permsByRole: Map<string, Permission[]>;
  checkedIds: Set<string>;
}) {
  return (
    <div class="flex flex-col gap-2">
      {allRoles.map((r) => (
        <label key={r.id} class="flex items-start gap-3 border border-base-300 rounded-lg px-3 py-2 cursor-pointer has-[:checked]:border-primary">
          <input type="checkbox" name="roles" value={r.id} class="checkbox checkbox-sm mt-1" checked={checkedIds.has(r.id)} />
          <div class="flex flex-col gap-1">
            <span class="font-medium text-sm">{r.name}</span>
            {r.description && <span class="text-xs opacity-60">{r.description}</span>}
            <PermissionBadges permissions={permsByRole.get(r.id) ?? []} />
          </div>
        </label>
      ))}
    </div>
  );
}

// HTMX fragment: create user modal
adminRoutes.get("/users/new", guard, async (c) => {
  const [allRoles, permRows] = await Promise.all([
    db.select({ id: appRoles.id, name: appRoles.name, description: appRoles.description }).from(appRoles).orderBy(asc(appRoles.name)),
    db.select({ roleId: appRolePermissions.roleId, permission: appRolePermissions.permission }).from(appRolePermissions),
  ]);
  const permsByRole = new Map<string, Permission[]>();
  for (const p of permRows) permsByRole.set(p.roleId, [...(permsByRole.get(p.roleId) ?? []), p.permission]);

  return c.html(
    <>
      <h3 class="font-bold text-lg mb-4">{t("admin.users.modal.create")}</h3>
      <form method="post" action="/admin/users" class="flex flex-col gap-3">
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">{t("admin.users.modal.nameLabel")} <span class="text-error">*</span></span>
          <input type="text" name="name" class="input input-bordered w-full" required />
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">{t("admin.users.modal.emailLabel")} <span class="text-error">*</span></span>
          <input type="email" name="email" class="input input-bordered w-full" required />
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-start gap-x-3">
          <span class="label-text text-right pt-3">{t("admin.users.modal.roleLabel")}</span>
          <RoleCheckboxes allRoles={allRoles} permsByRole={permsByRole} checkedIds={new Set()} />
        </div>
        <div class="modal-action mt-2">
          <button
            type="button"
            class="btn btn-ghost"
            onclick="document.getElementById('admin-modal').close()"
          >
            {t("common.cancel")}
          </button>
          <button type="submit" class="btn btn-primary">
            {t("common.create")}
          </button>
        </div>
      </form>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('admin-modal').showModal();" }} />
    </>
  );
});

// HTMX fragment: edit user modal
adminRoutes.get("/users/:id/edit", guard, async (c) => {
  const id = c.req.param("id");
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u || u.email === "admin@localhost.invalid") return c.html("", 404);

  const [allRoles, permRows, assigned] = await Promise.all([
    db.select({ id: appRoles.id, name: appRoles.name, description: appRoles.description }).from(appRoles).orderBy(asc(appRoles.name)),
    db.select({ roleId: appRolePermissions.roleId, permission: appRolePermissions.permission }).from(appRolePermissions),
    db.select({ roleId: userAppRoles.roleId }).from(userAppRoles).where(eq(userAppRoles.userId, id)),
  ]);
  const permsByRole = new Map<string, Permission[]>();
  for (const p of permRows) permsByRole.set(p.roleId, [...(permsByRole.get(p.roleId) ?? []), p.permission]);
  const checkedIds = new Set(assigned.map((a) => a.roleId));

  return c.html(
    <>
      <h3 class="font-bold text-lg mb-4">{t("admin.users.modal.edit")}</h3>
      <form method="post" action={`/admin/users/${id}`} class="flex flex-col gap-3">
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">{t("admin.users.modal.nameLabel")} <span class="text-error">*</span></span>
          <input type="text" name="name" value={u.name} class="input input-bordered w-full" required />
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-baseline gap-x-3">
          <span class="label-text text-right pt-2">{t("admin.users.modal.emailLabel")} <span class="text-error">*</span></span>
          <div class="flex flex-col gap-1">
            <input type="email" name="email" value={u.email} class="input input-bordered w-full" required />
            <span class="label-text-alt opacity-60">
              {t("admin.users.modal.emailWarning")}
            </span>
          </div>
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-start gap-x-3">
          <span class="label-text text-right pt-3">{t("admin.users.modal.roleLabel")}</span>
          <RoleCheckboxes allRoles={allRoles} permsByRole={permsByRole} checkedIds={checkedIds} />
        </div>
        <div class="modal-action mt-2">
          <button
            type="button"
            class="btn btn-ghost"
            onclick="document.getElementById('admin-modal').close()"
          >
            {t("common.cancel")}
          </button>
          <button type="submit" class="btn btn-primary">
            {t("common.save")}
          </button>
        </div>
      </form>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('admin-modal').showModal();" }} />
    </>
  );
});

async function validRoleIds(requested: string[]): Promise<string[]> {
  if (requested.length === 0) return [];
  const found = await db.select({ id: appRoles.id }).from(appRoles).where(inArray(appRoles.id, requested));
  return found.map((r) => r.id);
}

// POST /admin/users — create
adminRoutes.post("/users", guard, async (c) => {
  const body = await c.req.parseBody({ all: true });
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const roleIds = await validRoleIds(([] as string[]).concat((body.roles as string | string[] | undefined) ?? []));

  if (!name || !email) {
    setFlash(c, t("admin.users.flash.missingFields"), "error");
    return c.redirect("/admin/users");
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (existing.length > 0) {
    setFlash(c, t("admin.users.flash.emailExists"), "error");
    return c.redirect("/admin/users");
  }

  const now = new Date();
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    name,
    email,
    emailVerified: true,
    disabled: false,
    createdAt: now,
    updatedAt: now,
  });
  if (roleIds.length > 0) {
    await db.insert(userAppRoles).values(roleIds.map((roleId) => ({ userId: id, roleId })));
  }

  setFlash(c, t("admin.users.flash.created", { name }), "success");
  return c.redirect("/admin/users");
});

// POST /admin/users/:id — update
adminRoutes.post("/users/:id", guard, async (c) => {
  const id = c.req.param("id");
  const [existing] = await db.select().from(users).where(eq(users.id, id));
  if (!existing || existing.email === "admin@localhost.invalid") return c.html("", 404);

  const body = await c.req.parseBody({ all: true });
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const roleIds = await validRoleIds(([] as string[]).concat((body.roles as string | string[] | undefined) ?? []));

  if (!name || !email) {
    setFlash(c, t("admin.users.flash.missingFields"), "error");
    return c.redirect("/admin/users");
  }

  if (email !== existing.email) {
    const dupe = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (dupe.length > 0) {
      setFlash(c, t("admin.users.flash.emailExists"), "error");
      return c.redirect("/admin/users");
    }
    // Remove OIDC account link so Better Auth re-links on next login
    await db
      .delete(accounts)
      .where(and(eq(accounts.userId, id), eq(accounts.providerId, "oidc")));
  }

  await db
    .update(users)
    .set({ name, email, updatedAt: new Date() })
    .where(eq(users.id, id));

  await db.delete(userAppRoles).where(eq(userAppRoles.userId, id));
  if (roleIds.length > 0) {
    await db.insert(userAppRoles).values(roleIds.map((roleId) => ({ userId: id, roleId })));
  }

  setFlash(c, t("admin.users.flash.saved"), "success");
  return c.redirect("/admin/users");
});

// POST /admin/users/:id/deactivate
adminRoutes.post("/users/:id/deactivate", guard, async (c) => {
  const id = c.req.param("id");
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, id));
  if (!u || u.email === "admin@localhost.invalid") return c.html("", 404);

  await db.update(users).set({ disabled: true, updatedAt: new Date() }).where(eq(users.id, id));
  await db.delete(sessions).where(eq(sessions.userId, id));

  setFlash(c, t("admin.users.flash.deactivated"), "success");
  return c.redirect("/admin/users");
});

// POST /admin/users/:id/activate
adminRoutes.post("/users/:id/activate", guard, async (c) => {
  const id = c.req.param("id");
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, id));
  if (!u || u.email === "admin@localhost.invalid") return c.html("", 404);

  await db.update(users).set({ disabled: false, updatedAt: new Date() }).where(eq(users.id, id));

  setFlash(c, t("admin.users.flash.activated"), "success");
  return c.redirect("/admin/users");
});

// POST /admin/users/:id/delete
adminRoutes.post("/users/:id/delete", guard, async (c) => {
  const id = c.req.param("id");
  const currentUser = c.get("user");
  if (currentUser.id === id) return c.html("", 403);

  const [u] = await db.select({ email: users.email, disabled: users.disabled }).from(users).where(eq(users.id, id));
  if (!u || u.email === "admin@localhost.invalid") return c.html("", 404);
  if (!u.disabled) return c.html("", 400);

  await db.delete(users).where(eq(users.id, id));

  setFlash(c, t("admin.users.flash.deleted"), "success");
  return c.redirect("/admin/users");
});

// ── /admin/permissions ───────────────────────────────────────────────────────
adminRoutes.get("/permissions", guard, async (c) => {
  const user = c.get("user");

  const [roles, permRows, assignmentCounts, warn] = await Promise.all([
    db.select().from(appRoles).orderBy(asc(appRoles.name)),
    db.select({ roleId: appRolePermissions.roleId, permission: appRolePermissions.permission }).from(appRolePermissions),
    db.select({ roleId: userAppRoles.roleId, cnt: count() }).from(userAppRoles).groupBy(userAppRoles.roleId),
    backupWarnProps(),
  ]);

  const permsByRole = new Map<string, Permission[]>();
  for (const p of permRows) permsByRole.set(p.roleId, [...(permsByRole.get(p.roleId) ?? []), p.permission]);
  const countByRole = new Map(assignmentCounts.map((a) => [a.roleId, a.cnt]));

  return c.html(
    <Layout title={t("admin.permissions.title")} user={user} activeNav="admin">
      <BackupWarnBanner {...warn} />
      <AdminTabs active="permissions" />

      <div class="max-w-4xl mx-auto">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">
          {t("admin.permissions.title")}
        </h1>
        <button
          class="btn btn-primary btn-sm"
          hx-get="/admin/permissions/new"
          hx-target="#modal-content"
          hx-swap="innerHTML"
        >
          {t("admin.permissions.newRole")}
        </button>
      </div>

      <ClickToEditHint />
      <div class="overflow-x-auto mb-10">
        <table class="table table-zebra w-full">
          <thead>
            <tr>
              <th>{t("admin.permissions.table.name")}</th>
              <th>{t("admin.permissions.table.permissions")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => {
              const assignmentCount = countByRole.get(r.id) ?? 0;
              const canDelete = !r.isProtected && assignmentCount === 0;
              return (
                <tr
                  key={r.id}
                  {...(!r.isProtected && {
                    class: "cursor-pointer hover",
                    "hx-get": `/admin/permissions/${r.id}/edit`,
                    "hx-target": "#modal-content",
                    "hx-swap": "innerHTML",
                  })}
                >
                  <td class="font-medium">
                    {r.isProtected && (
                      <span class="mr-1" title={t("admin.roles.systemRole")}>
                        🔒
                      </span>
                    )}
                    {r.name}
                  </td>
                  <td>
                    <PermissionBadges permissions={permsByRole.get(r.id) ?? []} />
                  </td>
                  <td>
                    <div class="flex gap-2 justify-end">
                      {canDelete ? (
                        <>
                          <button
                            class="btn btn-ghost btn-xs text-error"
                            onclick={`event.stopPropagation(); document.getElementById('delete-perm-role-${r.id}').showModal()`}
                          >
                            {t("common.delete")}
                          </button>
                          <dialog id={`delete-perm-role-${r.id}`} class="modal" onclick="event.stopPropagation()">
                            <div class="modal-box">
                              <h3 class="font-bold text-lg">{t("admin.permissions.confirmDelete.title")}</h3>
                              <p class="py-2 opacity-70">
                                {t("admin.permissions.confirmDelete.body", { name: r.name })}
                              </p>
                              <div class="modal-action">
                                <form method="dialog">
                                  <button class="btn">{t("common.cancel")}</button>
                                </form>
                                <form method="post" action={`/admin/permissions/${r.id}/delete`}>
                                  <button type="submit" class="btn btn-error">
                                    {t("common.delete")}
                                  </button>
                                </form>
                              </div>
                            </div>
                            <form method="dialog" class="modal-backdrop">
                              <button>{t("common.close")}</button>
                            </form>
                          </dialog>
                        </>
                      ) : (
                        <button
                          class="btn btn-ghost btn-xs text-base-content/30"
                          disabled
                          title={
                            r.isProtected
                              ? t("admin.permissions.cannotDelete.protected")
                              : assignmentCount === 1
                                ? t("admin.permissions.cannotDelete.usedBySingle", { count: assignmentCount })
                                : t("admin.permissions.cannotDelete.usedByMultiple", { count: assignmentCount })
                          }
                        >
                          {t("common.delete")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>

      <ModalScaffold />
    </Layout>
  );
});

function PermissionCheckboxes({ checked }: { checked: Set<Permission> }) {
  const groups = new Map<string, Permission[]>();
  for (const p of ASSIGNABLE_PERMISSIONS) {
    const resource = p.split(":")[0];
    groups.set(resource, [...(groups.get(resource) ?? []), p]);
  }

  return (
    <div class="flex flex-col gap-3">
      {[...groups].map(([resource, perms]) => (
        <div key={resource} class="perm-group">
          <div class="flex items-center justify-between mb-1">
            <span class="label-text font-semibold">{RESOURCE_LABELS[resource] ?? resource}</span>
            {perms.length > 1 && (
              <button
                type="button"
                class="btn btn-outline btn-primary btn-xs"
                onclick="this.closest('.perm-group').querySelectorAll('input[type=checkbox]').forEach(function(cb){cb.checked=true;})"
              >
                {t("admin.permissions.modal.selectAllInGroup")}
              </button>
            )}
          </div>
          <div class="grid grid-cols-1 gap-1">
            {perms.map((p) => (
              <label key={p} class="label cursor-pointer justify-start gap-3">
                <input type="checkbox" name="permissions" value={p} class="checkbox checkbox-sm" checked={checked.has(p)} />
                <span class="label-text">{PERMISSION_LABELS[p]}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// HTMX fragment: new permission-role modal
adminRoutes.get("/permissions/new", guard, (c) => {
  return c.html(
    <>
      <h3 class="font-bold text-lg mb-4">{t("admin.permissions.modal.create")}</h3>
      <form method="post" action="/admin/permissions" class="flex flex-col gap-3">
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">{t("admin.permissions.modal.nameLabel")} <span class="text-error">*</span></span>
          <input type="text" name="name" class="input input-bordered w-full" required />
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-start gap-x-3">
          <span class="label-text text-right pt-2">{t("admin.permissions.modal.descriptionLabel")}</span>
          <textarea name="description" rows={2} class="textarea textarea-bordered w-full" />
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-start gap-x-3">
          <span class="label-text text-right pt-1">{t("admin.permissions.modal.permissionsLabel")}</span>
          <PermissionCheckboxes checked={new Set()} />
        </div>
        <div class="modal-action mt-2">
          <button type="button" class="btn btn-ghost" onclick="document.getElementById('admin-modal').close()">
            {t("common.cancel")}
          </button>
          <button type="submit" class="btn btn-primary">
            {t("common.create")}
          </button>
        </div>
      </form>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('admin-modal').showModal();" }} />
    </>
  );
});

// HTMX fragment: edit permission-role modal
adminRoutes.get("/permissions/:id/edit", guard, async (c) => {
  const id = c.req.param("id");
  const [role] = await db.select().from(appRoles).where(eq(appRoles.id, id));
  if (!role || role.isProtected) return c.html("", 404);

  const [{ cnt }] = await db.select({ cnt: count() }).from(userAppRoles).where(eq(userAppRoles.roleId, id));
  const hasAssignments = cnt > 0;

  const perms = await db.select({ permission: appRolePermissions.permission }).from(appRolePermissions).where(eq(appRolePermissions.roleId, id));
  const checked = new Set(perms.map((p) => p.permission));

  return c.html(
    <>
      <h3 class="font-bold text-lg mb-4">{t("admin.permissions.modal.edit")}</h3>
      <form method="post" action={`/admin/permissions/${id}`} class="flex flex-col gap-3">
        <div class="grid grid-cols-[8rem_1fr] items-baseline gap-x-3">
          <span class="label-text text-right pt-2">{t("admin.permissions.modal.nameLabel")} <span class="text-error">*</span></span>
          {hasAssignments ? (
            <div class="flex flex-col gap-1">
              <input type="text" value={role.name} class="input input-bordered w-full opacity-50" disabled />
              <span class="label-text-alt opacity-60">
                {t("admin.permissions.modal.nameLocked")}
              </span>
              <input type="hidden" name="name" value={role.name} />
            </div>
          ) : (
            <input type="text" name="name" value={role.name} class="input input-bordered w-full" required />
          )}
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-start gap-x-3">
          <span class="label-text text-right pt-2">{t("admin.permissions.modal.descriptionLabel")}</span>
          <textarea name="description" rows={2} class="textarea textarea-bordered w-full">{role.description ?? ""}</textarea>
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-start gap-x-3">
          <span class="label-text text-right pt-1">{t("admin.permissions.modal.permissionsLabel")}</span>
          <PermissionCheckboxes checked={checked} />
        </div>
        <div class="modal-action mt-2">
          <button type="button" class="btn btn-ghost" onclick="document.getElementById('admin-modal').close()">
            {t("common.cancel")}
          </button>
          <button type="submit" class="btn btn-primary">
            {t("common.save")}
          </button>
        </div>
      </form>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('admin-modal').showModal();" }} />
    </>
  );
});

function parsePermissions(body: Record<string, unknown>): Permission[] {
  const raw = ([] as string[]).concat((body.permissions as string | string[] | undefined) ?? []);
  return raw.filter((p): p is Permission => (ASSIGNABLE_PERMISSIONS as readonly string[]).includes(p));
}

// POST /admin/permissions — create
adminRoutes.post("/permissions", guard, async (c) => {
  const body = await c.req.parseBody({ all: true });
  const name = String(body.name ?? "").trim();
  const description = String(body.description ?? "").trim() || null;
  const permissions = parsePermissions(body);

  if (!name) {
    setFlash(c, t("admin.permissions.flash.requiredName"), "error");
    return c.redirect("/admin/permissions");
  }

  const id = crypto.randomUUID();
  await db.insert(appRoles).values({ id, name, description, isProtected: false });
  if (permissions.length > 0) {
    await db.insert(appRolePermissions).values(permissions.map((permission) => ({ roleId: id, permission })));
  }

  setFlash(c, t("admin.permissions.flash.created", { name }), "success");
  return c.redirect("/admin/permissions");
});

// POST /admin/permissions/:id — update
adminRoutes.post("/permissions/:id", guard, async (c) => {
  const id = c.req.param("id");
  const [role] = await db.select().from(appRoles).where(eq(appRoles.id, id));
  if (!role || role.isProtected) return c.html("", 404);

  const body = await c.req.parseBody({ all: true });
  const permissions = parsePermissions(body);
  const description = String(body.description ?? "").trim() || null;

  const [{ cnt }] = await db.select({ cnt: count() }).from(userAppRoles).where(eq(userAppRoles.roleId, id));

  const updates: { name?: string; description: string | null } = { description };
  if (cnt === 0) {
    const name = String(body.name ?? "").trim();
    if (!name) {
      setFlash(c, t("admin.permissions.flash.requiredName"), "error");
      return c.redirect("/admin/permissions");
    }
    updates.name = name;
  }
  await db.update(appRoles).set(updates).where(eq(appRoles.id, id));

  await db.delete(appRolePermissions).where(eq(appRolePermissions.roleId, id));
  if (permissions.length > 0) {
    await db.insert(appRolePermissions).values(permissions.map((permission) => ({ roleId: id, permission })));
  }

  setFlash(c, t("admin.permissions.flash.saved"), "success");
  return c.redirect("/admin/permissions");
});

// POST /admin/permissions/:id/delete
adminRoutes.post("/permissions/:id/delete", guard, async (c) => {
  const id = c.req.param("id");
  const [role] = await db.select().from(appRoles).where(eq(appRoles.id, id));
  if (!role) return c.redirect("/admin/permissions");

  if (role.isProtected) {
    setFlash(c, t("admin.permissions.flash.protected"), "error");
    return c.redirect("/admin/permissions");
  }

  const [{ cnt }] = await db.select({ cnt: count() }).from(userAppRoles).where(eq(userAppRoles.roleId, id));
  if (cnt > 0) {
    setFlash(c, t("admin.permissions.flash.hasAssignments"), "error");
    return c.redirect("/admin/permissions");
  }

  await db.delete(appRoles).where(eq(appRoles.id, id));
  setFlash(c, t("admin.permissions.flash.deleted", { name: role.name }), "success");
  return c.redirect("/admin/permissions");
});

// ── /admin/roles ──────────────────────────────────────────────────────────────
adminRoutes.get("/roles", guard, async (c) => {
  const user = c.get("user");
  const activeFilter = c.req.query("active"); // "1" | "0" | undefined

  const [rolesWithCount, warn] = await Promise.all([
    db
      .select({
        id: memberRoles.id,
        title: memberRoles.title,
        grantsActiveStatus: memberRoles.grantsActiveStatus,
        isProtected: memberRoles.isProtected,
        assignmentCount: count(memberRoleAssignments.id),
      })
      .from(memberRoles)
      .leftJoin(memberRoleAssignments, eq(memberRoleAssignments.memberRoleId, memberRoles.id))
      .where(
        activeFilter === "1" ? eq(memberRoles.grantsActiveStatus, true) :
        activeFilter === "0" ? eq(memberRoles.grantsActiveStatus, false) :
        undefined
      )
      .groupBy(memberRoles.id, memberRoles.title, memberRoles.grantsActiveStatus, memberRoles.isProtected)
      .orderBy(asc(memberRoles.title)),
    backupWarnProps(),
  ]);

  return c.html(
    <Layout title={t("admin.roles.title")} user={user} activeNav="admin">
      <BackupWarnBanner {...warn} />
      <AdminTabs active="roles" />

      <div class="max-w-4xl mx-auto">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-4">
          <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">
            {t("admin.roles.title")}
          </h1>
          <div class="join">
            <a href="/admin/roles" class={`btn btn-sm join-item${!activeFilter ? " btn-primary btn-outline" : " btn-ghost"}`}>{t("admin.roles.filterAll")}</a>
            <a href="/admin/roles?active=1" class={`btn btn-sm join-item${activeFilter === "1" ? " btn-primary btn-outline" : " btn-ghost"}`}>{t("admin.roles.filterActive")}</a>
            <a href="/admin/roles?active=0" class={`btn btn-sm join-item${activeFilter === "0" ? " btn-primary btn-outline" : " btn-ghost"}`}>{t("admin.roles.filterPassive")}</a>
          </div>
        </div>
        <button
          class="btn btn-primary btn-sm"
          hx-get="/admin/roles/new"
          hx-target="#modal-content"
          hx-swap="innerHTML"
        >
          {t("admin.roles.newRole")}
        </button>
      </div>

      <ClickToEditHint />
      <div class="overflow-x-auto mb-10">
        <table class="table table-zebra w-full">
          <thead>
            <tr>
              <th>{t("admin.roles.table.name")}</th>
              <th>{t("admin.roles.table.activeStatus")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rolesWithCount.map((r) => {
              const canDelete = !r.isProtected && r.assignmentCount === 0;
              return (
                <tr
                  key={r.id}
                  {...(!r.isProtected && {
                    class: "cursor-pointer hover",
                    "hx-get": `/admin/roles/${r.id}/edit`,
                    "hx-target": "#modal-content",
                    "hx-swap": "innerHTML",
                  })}
                >
                  <td class="font-medium">
                    {r.isProtected && (
                      <span class="mr-1" title={t("admin.roles.systemRole")}>
                        🔒
                      </span>
                    )}
                    {r.title}
                  </td>
                  <td>
                    {r.grantsActiveStatus ? (
                      <span class="badge badge-success badge-sm">{t("admin.roles.filterActive")}</span>
                    ) : (
                      <span class="badge badge-ghost badge-sm">{t("admin.roles.filterPassive")}</span>
                    )}
                  </td>
                  <td>
                    <div class="flex gap-2 justify-end">
                      {canDelete ? (
                        <>
                          <button
                            class="btn btn-ghost btn-xs text-error"
                            onclick={`event.stopPropagation(); document.getElementById('delete-role-${r.id}').showModal()`}
                          >
                            {t("common.delete")}
                          </button>
                          <dialog id={`delete-role-${r.id}`} class="modal" onclick="event.stopPropagation()">
                            <div class="modal-box">
                              <h3 class="font-bold text-lg">{t("admin.roles.confirmDelete.title")}</h3>
                              <p class="py-2 opacity-70">
                                {t("admin.roles.confirmDelete.body", { title: r.title })}
                              </p>
                              <div class="modal-action">
                                <form method="dialog">
                                  <button class="btn">{t("common.cancel")}</button>
                                </form>
                                <form method="post" action={`/admin/roles/${r.id}/delete`}>
                                  <button type="submit" class="btn btn-error">
                                    {t("common.delete")}
                                  </button>
                                </form>
                              </div>
                            </div>
                            <form method="dialog" class="modal-backdrop">
                              <button>{t("common.close")}</button>
                            </form>
                          </dialog>
                        </>
                      ) : (
                        <button
                          class="btn btn-ghost btn-xs text-base-content/30"
                          disabled
                          title={
                            r.isProtected
                              ? t("admin.roles.cannotDelete.protected")
                              : r.assignmentCount === 1
                                ? t("admin.roles.cannotDelete.usedBySingle", { count: r.assignmentCount })
                                : t("admin.roles.cannotDelete.usedByMultiple", { count: r.assignmentCount })
                          }
                        >
                          {t("common.delete")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>

      <ModalScaffold />
    </Layout>
  );
});

// HTMX fragment: new role modal
adminRoutes.get("/roles/new", guard, (c) => {
  return c.html(
    <>
      <h3 class="font-bold text-lg mb-4">{t("admin.roles.modal.create")}</h3>
      <form method="post" action="/admin/roles" class="flex flex-col gap-3">
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">{t("admin.roles.modal.nameLabel")} <span class="text-error">*</span></span>
          <input type="text" name="title" class="input input-bordered w-full" required />
        </div>
        <label class="label cursor-pointer justify-start gap-3">
          <input type="checkbox" name="grantsActiveStatus" value="1" class="checkbox" />
          <span class="label-text">{t("admin.roles.modal.grantsActive")}</span>
        </label>
        <div class="modal-action mt-2">
          <button
            type="button"
            class="btn btn-ghost"
            onclick="document.getElementById('admin-modal').close()"
          >
            {t("common.cancel")}
          </button>
          <button type="submit" class="btn btn-primary">
            {t("common.create")}
          </button>
        </div>
      </form>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('admin-modal').showModal();" }} />
    </>
  );
});

// HTMX fragment: edit role modal
adminRoutes.get("/roles/:id/edit", guard, async (c) => {
  const id = c.req.param("id");
  const [role] = await db.select().from(memberRoles).where(eq(memberRoles.id, id));
  if (!role || role.isProtected) return c.html("", 404);

  const [{ cnt }] = await db
    .select({ cnt: count() })
    .from(memberRoleAssignments)
    .where(eq(memberRoleAssignments.memberRoleId, id));

  const hasAssignments = cnt > 0;

  return c.html(
    <>
      <h3 class="font-bold text-lg mb-4">{t("admin.roles.modal.edit")}</h3>
      <form method="post" action={`/admin/roles/${id}`} class="flex flex-col gap-3">
        <div class="grid grid-cols-[8rem_1fr] items-baseline gap-x-3">
          <span class="label-text text-right pt-2">{t("admin.roles.modal.nameLabel")} <span class="text-error">*</span></span>
          {hasAssignments ? (
            <div class="flex flex-col gap-1">
              <input type="text" value={role.title} class="input input-bordered w-full opacity-50" disabled />
              <span class="label-text-alt opacity-60">
                {t("admin.roles.modal.nameLocked")}
              </span>
              <input type="hidden" name="title" value={role.title} />
            </div>
          ) : (
            <input type="text" name="title" value={role.title} class="input input-bordered w-full" required />
          )}
        </div>
        <label class="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            name="grantsActiveStatus"
            value="1"
            class="checkbox"
            {...(role.grantsActiveStatus ? { checked: true } : {})}
          />
          <span class="label-text">{t("admin.roles.modal.grantsActive")}</span>
        </label>
        <div class="modal-action mt-2">
          <button
            type="button"
            class="btn btn-ghost"
            onclick="document.getElementById('admin-modal').close()"
          >
            {t("common.cancel")}
          </button>
          <button type="submit" class="btn btn-primary">
            {t("common.save")}
          </button>
        </div>
      </form>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('admin-modal').showModal();" }} />
    </>
  );
});

// POST /admin/roles — create
adminRoutes.post("/roles", guard, async (c) => {
  const body = await c.req.parseBody();
  const title = String(body.title ?? "").trim();
  const grantsActiveStatus = body.grantsActiveStatus === "1";

  if (!title) {
    setFlash(c, t("admin.roles.flash.requiredTitle"), "error");
    return c.redirect("/admin/roles");
  }

  await db.insert(memberRoles).values({
    id: crypto.randomUUID(),
    title,
    grantsActiveStatus,
    isProtected: false,
  });

  setFlash(c, t("admin.roles.flash.created", { title }), "success");
  return c.redirect("/admin/roles");
});

// POST /admin/roles/:id — update
adminRoutes.post("/roles/:id", guard, async (c) => {
  const id = c.req.param("id");
  const [role] = await db.select().from(memberRoles).where(eq(memberRoles.id, id));
  if (!role || role.isProtected) return c.html("", 404);

  const body = await c.req.parseBody();
  const grantsActiveStatus = body.grantsActiveStatus === "1";

  const [{ cnt }] = await db
    .select({ cnt: count() })
    .from(memberRoleAssignments)
    .where(eq(memberRoleAssignments.memberRoleId, id));

  if (cnt === 0) {
    const title = String(body.title ?? "").trim();
    if (!title) {
      setFlash(c, t("admin.roles.flash.requiredTitle"), "error");
      return c.redirect("/admin/roles");
    }
    await db.update(memberRoles).set({ title, grantsActiveStatus }).where(eq(memberRoles.id, id));
  } else {
    await db.update(memberRoles).set({ grantsActiveStatus }).where(eq(memberRoles.id, id));
  }

  setFlash(c, t("admin.roles.flash.saved"), "success");
  return c.redirect("/admin/roles");
});

// POST /admin/roles/:id/delete
adminRoutes.post("/roles/:id/delete", guard, async (c) => {
  const id = c.req.param("id");
  const [role] = await db.select().from(memberRoles).where(eq(memberRoles.id, id));
  if (!role) return c.redirect("/admin/roles");

  if (role.isProtected) {
    setFlash(c, t("admin.roles.flash.protected"), "error");
    return c.redirect("/admin/roles");
  }

  const [{ cnt }] = await db
    .select({ cnt: count() })
    .from(memberRoleAssignments)
    .where(eq(memberRoleAssignments.memberRoleId, id));

  if (cnt > 0) {
    setFlash(c, t("admin.roles.flash.hasAssignments"), "error");
    return c.redirect("/admin/roles");
  }

  await db.delete(memberRoles).where(eq(memberRoles.id, id));
  setFlash(c, t("admin.roles.flash.deleted", { title: role.title }), "success");
  return c.redirect("/admin/roles");
});

// ── /admin/anniversaries ──────────────────────────────────────────────────────
adminRoutes.get("/anniversaries", guard, async (c) => {
  const user = c.get("user");
  const [years, warn] = await Promise.all([
    db.select().from(anniversaryYears).orderBy(asc(anniversaryYears.year)),
    backupWarnProps(),
  ]);

  return c.html(
    <Layout title={t("admin.anniversaries.title")} user={user} activeNav="admin">
      <BackupWarnBanner {...warn} />
      <AdminTabs active="anniversaries" />
      <div class="max-w-4xl mx-auto">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">
          {t("admin.anniversaries.title")}
        </h1>
        <button
          class="btn btn-primary btn-sm"
          hx-get="/admin/anniversaries/new"
          hx-target="#modal-content"
          hx-swap="innerHTML"
        >
          {t("admin.anniversaries.newYear")}
        </button>
      </div>

      <ClickToEditHint />
      <div class="overflow-x-auto mb-6">
        <table class="table table-zebra w-full max-w-md">
          <thead>
            <tr>
              <th>{t("admin.anniversaries.table.years")}</th>
              <th>{t("admin.anniversaries.table.title")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {years.length === 0 ? (
              <tr>
                <td colspan={3} class="text-center opacity-50 py-4">
                  {t("admin.anniversaries.empty")}
                </td>
              </tr>
            ) : (
              years.map((y) => (
                <tr
                  key={y.year}
                  class="cursor-pointer hover"
                  hx-get={`/admin/anniversaries/${y.year}/edit`}
                  hx-target="#modal-content"
                  hx-swap="innerHTML"
                >
                  <td class="font-medium">{y.year}</td>
                  <td class="opacity-70">{y.title ?? "–"}</td>
                  <td>
                    <div class="flex gap-2 justify-end">
                      <button
                        class="btn btn-ghost btn-xs text-error"
                        onclick={`event.stopPropagation(); document.getElementById('delete-year-${y.year}').showModal()`}
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                    <dialog id={`delete-year-${y.year}`} class="modal" onclick="event.stopPropagation()">
                      <div class="modal-box">
                        <p>
                          {y.title
                            ? t("admin.anniversaries.confirmDelete.bodyWithTitle", { year: String(y.year), title: y.title })
                            : t("admin.anniversaries.confirmDelete.body", { year: String(y.year) })}
                        </p>
                        <div class="modal-action">
                          <form method="dialog">
                            <button class="btn">{t("common.cancel")}</button>
                          </form>
                          <form method="post" action={`/admin/anniversaries/${y.year}/delete`}>
                            <button type="submit" class="btn btn-error">
                              {t("common.delete")}
                            </button>
                          </form>
                        </div>
                      </div>
                      <form method="dialog" class="modal-backdrop">
                        <button>{t("common.close")}</button>
                      </form>
                    </dialog>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </div>

      <ModalScaffold />
    </Layout>
  );
});

// HTMX fragment: new anniversary year modal
adminRoutes.get("/anniversaries/new", guard, (c) => {
  return c.html(
    <>
      <h3 class="font-bold text-lg mb-4">{t("admin.anniversaries.modal.create")}</h3>
      <form method="post" action="/admin/anniversaries" class="flex flex-col gap-3">
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">{t("admin.anniversaries.modal.yearLabel")} <span class="text-error">*</span></span>
          <input type="number" name="year" min="1" max="200" class="input input-bordered w-full" required placeholder={t("admin.anniversaries.modal.yearPlaceholder")} />
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">{t("admin.anniversaries.modal.titleLabel")}</span>
          <input type="text" name="title" class="input input-bordered w-full" placeholder={t("admin.anniversaries.modal.titlePlaceholder")} />
        </div>
        <div class="modal-action mt-2">
          <button
            type="button"
            class="btn btn-ghost"
            onclick="document.getElementById('admin-modal').close()"
          >
            {t("common.cancel")}
          </button>
          <button type="submit" class="btn btn-primary">
            {t("common.add")}
          </button>
        </div>
      </form>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('admin-modal').showModal();" }} />
    </>
  );
});

// HTMX fragment: edit anniversary year modal
adminRoutes.get("/anniversaries/:year/edit", guard, async (c) => {
  const year = parseInt(c.req.param("year"), 10);
  const [y] = await db.select().from(anniversaryYears).where(eq(anniversaryYears.year, year));
  if (!y) return c.html("", 404);

  return c.html(
    <>
      <h3 class="font-bold text-lg mb-4">{t("admin.anniversaries.modal.edit")}</h3>
      <form method="post" action={`/admin/anniversaries/${year}`} class="flex flex-col gap-3">
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">{t("admin.anniversaries.modal.yearLabel")} <span class="text-error">*</span></span>
          <input type="number" name="year" value={y.year} min="1" max="200" class="input input-bordered w-full" required />
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">{t("admin.anniversaries.modal.titleLabel")}</span>
          <input type="text" name="title" value={y.title ?? ""} class="input input-bordered w-full" placeholder={t("admin.anniversaries.modal.titlePlaceholder")} />
        </div>
        <div class="modal-action mt-2">
          <button
            type="button"
            class="btn btn-ghost"
            onclick="document.getElementById('admin-modal').close()"
          >
            {t("common.cancel")}
          </button>
          <button type="submit" class="btn btn-primary">
            {t("common.save")}
          </button>
        </div>
      </form>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('admin-modal').showModal();" }} />
    </>
  );
});

// POST /admin/anniversaries — create
adminRoutes.post("/anniversaries", guard, async (c) => {
  const body = await c.req.parseBody();
  const year = parseInt(String(body.year ?? ""), 10);
  const title = String(body.title ?? "").trim() || null;

  if (!year || year < 1 || year > 200) {
    setFlash(c, t("admin.anniversaries.flash.invalidYear"), "error");
    return c.redirect("/admin/anniversaries");
  }

  await db.insert(anniversaryYears).values({ year, title }).onConflictDoNothing();
  setFlash(c, t("admin.anniversaries.flash.added", { year }), "success");
  return c.redirect("/admin/anniversaries");
});

// POST /admin/anniversaries/:year — update
adminRoutes.post("/anniversaries/:year", guard, async (c) => {
  const oldYear = parseInt(c.req.param("year"), 10);
  const [existing] = await db.select().from(anniversaryYears).where(eq(anniversaryYears.year, oldYear));
  if (!existing) return c.html("", 404);

  const body = await c.req.parseBody();
  const newYear = parseInt(String(body.year ?? ""), 10);
  const title = String(body.title ?? "").trim() || null;

  if (!newYear || newYear < 1 || newYear > 200) {
    setFlash(c, t("admin.anniversaries.flash.invalidYear"), "error");
    return c.redirect("/admin/anniversaries");
  }

  if (newYear !== oldYear) {
    const [conflict] = await db
      .select({ year: anniversaryYears.year })
      .from(anniversaryYears)
      .where(eq(anniversaryYears.year, newYear));
    if (conflict) {
      setFlash(c, t("admin.anniversaries.flash.yearExists", { year: newYear }), "error");
      return c.redirect("/admin/anniversaries");
    }
  }

  await db
    .update(anniversaryYears)
    .set({ year: newYear, title })
    .where(eq(anniversaryYears.year, oldYear));
  setFlash(c, t("admin.anniversaries.flash.saved"), "success");
  return c.redirect("/admin/anniversaries");
});

// POST /admin/anniversaries/:year/delete
adminRoutes.post("/anniversaries/:year/delete", guard, async (c) => {
  const year = parseInt(c.req.param("year"), 10);
  await db.delete(anniversaryYears).where(eq(anniversaryYears.year, year));
  setFlash(c, t("admin.anniversaries.flash.deleted", { year }), "success");
  return c.redirect("/admin/anniversaries");
});

// ── /admin/config ─────────────────────────────────────────────────────────────
const CONFIG_DESCRIPTIONS: Record<string, string> = {
  ORG_NAME: t("admin.config.desc.ORG_NAME"),
  CHILDREN_AGE_LIMIT: t("admin.config.desc.CHILDREN_AGE_LIMIT"),
  YOUTH_AGE_LIMIT: t("admin.config.desc.YOUTH_AGE_LIMIT"),
  ANNIVERSARY_CUTOFF: t("admin.config.desc.ANNIVERSARY_CUTOFF"),
  SESSION_LIFETIME: t("admin.config.desc.SESSION_LIFETIME"),
  ADMIN_PASSWORD_MIN_LENGTH: t("admin.config.desc.ADMIN_PASSWORD_MIN_LENGTH"),
  BACKUP_SCHEDULE: t("admin.config.desc.BACKUP_SCHEDULE"),
  BACKUP_RETENTION_COUNT: t("admin.config.desc.BACKUP_RETENTION_COUNT"),
  BACKUP_LOCAL_PATH: t("admin.config.desc.BACKUP_LOCAL_PATH"),
  S3_ENDPOINT: t("admin.config.desc.S3_ENDPOINT"),
  S3_BUCKET: t("admin.config.desc.S3_BUCKET"),
};

adminRoutes.get("/config", guard, async (c) => {
  const user = c.get("user");
  const warn = await backupWarnProps();
  return c.html(
    <Layout title={t("admin.config.title")} user={user} activeNav="admin">
      <BackupWarnBanner {...warn} />
      <AdminTabs active="config" />
      <div class="max-w-4xl mx-auto">
      <h1 class="text-2xl font-bold mb-6" style="font-family: var(--font-heading)">
        {t("admin.config.title")}
      </h1>
      <div class="overflow-x-auto">
        <table class="table w-full max-w-2xl">
          <thead>
            <tr>
              <th>{t("admin.config.table.variable")}</th>
              <th>{t("admin.config.table.value")}</th>
            </tr>
          </thead>
          <tbody>
            {ENV_META.map(({ key, value }) => (
              <tr>
                <td>
                  <span class="font-mono text-sm">{key}</span>
                  <p class="text-sm text-base-content/50 mt-0.5">{CONFIG_DESCRIPTIONS[key]}</p>
                </td>
                <td class="font-mono text-sm">{value ?? <span class="opacity-40">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </Layout>
  );
});

// ── /admin/org-config ────────────────────────────────────────────────────────
const ORG_CONFIG_FIELDS = [
  { key: "orgName", type: "text", section: "address" },
  { key: "orgStreet", type: "text", section: "address" },
  { key: "orgHouseNumber", type: "text", section: "address" },
  { key: "orgZip", type: "text", section: "address" },
  { key: "orgCity", type: "text", section: "address" },
  { key: "taxExemptionDate", type: "date", section: "tax" },
  { key: "taxExemptionNumber", type: "text", section: "tax" },
  { key: "taxOffice", type: "text", section: "tax" },
  { key: "taxAssessmentPeriodFrom", type: "number", section: "tax" },
  { key: "taxAssessmentPeriodTo", type: "number", section: "tax" },
  { key: "charitablePurpose", type: "text", section: "tax" },
  { key: "iban", type: "text", section: "bank" },
  { key: "bic", type: "text", section: "bank" },
] as const;

const ORG_CONFIG_SECTIONS = [
  { id: "address", title: t("admin.orgConfig.section.address") },
  { id: "tax", title: t("admin.orgConfig.section.tax") },
  { id: "bank", title: t("admin.orgConfig.section.bank") },
] as const;

const ORG_CONFIG_FIELD_LABELS: Record<string, string> = {
  orgName: t("admin.orgConfig.field.orgName"),
  orgStreet: t("admin.orgConfig.field.orgStreet"),
  orgHouseNumber: t("admin.orgConfig.field.orgHouseNumber"),
  orgZip: t("admin.orgConfig.field.orgZip"),
  orgCity: t("admin.orgConfig.field.orgCity"),
  taxExemptionDate: t("admin.orgConfig.field.taxExemptionDate"),
  taxExemptionNumber: t("admin.orgConfig.field.taxExemptionNumber"),
  taxOffice: t("admin.orgConfig.field.taxOffice"),
  taxAssessmentPeriodFrom: t("admin.orgConfig.field.taxAssessmentPeriodFrom"),
  taxAssessmentPeriodTo: t("admin.orgConfig.field.taxAssessmentPeriodTo"),
  charitablePurpose: t("admin.orgConfig.field.charitablePurpose"),
  iban: t("admin.orgConfig.field.iban"),
  bic: t("admin.orgConfig.field.bic"),
};

// iban/bic are normalized (no spaces, uppercase) so consuming features don't
// each have to re-clean what an admin typed as "DE12 3456 ...".
function normalizeOrgConfigValue(key: string, value: string): string {
  if (key === "iban" || key === "bic") return value.replace(/\s+/g, "").toUpperCase();
  return value;
}

adminRoutes.get("/org-config", guard, async (c) => {
  const user = c.get("user");
  const warn = await backupWarnProps();
  const rows = await db.select().from(orgConfig);
  const values = new Map(rows.map((r) => [r.key, r.value]));

  function field(key: (typeof ORG_CONFIG_FIELDS)[number]["key"], type: string) {
    return (
      <div class="form-control">
        <label class="label">
          <span class="label-text">{ORG_CONFIG_FIELD_LABELS[key]}</span>
        </label>
        <input type={type} name={key} class="input input-bordered w-full" value={values.get(key) ?? ""} />
      </div>
    );
  }

  return c.html(
    <Layout title={t("admin.orgConfig.title")} user={user} activeNav="admin">
      <BackupWarnBanner {...warn} />
      <AdminTabs active="org-config" />
      <div class="max-w-4xl mx-auto">
        <div class="flex items-center justify-between mb-6">
          <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">
            {t("admin.orgConfig.title")}
          </h1>
          <button type="submit" form="org-config-form" class="btn btn-primary btn-sm">
            {t("common.save")}
          </button>
        </div>
        <form id="org-config-form" method="post" action="/admin/org-config" class="flex flex-col gap-6">
          <div class="card bg-base-200 shadow">
            <div class="card-body gap-4">
              <h2 class="card-title">{ORG_CONFIG_SECTIONS[0].title}</h2>
              {field("orgName", "text")}
              <div class="grid grid-cols-1 sm:grid-cols-[3fr_1fr] gap-4">
                {field("orgStreet", "text")}
                {field("orgHouseNumber", "text")}
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-[1fr_3fr] gap-4">
                {field("orgZip", "text")}
                {field("orgCity", "text")}
              </div>
            </div>
          </div>
          <div class="card bg-base-200 shadow">
            <div class="card-body gap-4">
              <h2 class="card-title">{ORG_CONFIG_SECTIONS[1].title}</h2>
              <div class="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-4">
                {field("taxExemptionDate", "date")}
                {field("taxExemptionNumber", "text")}
              </div>
              {field("taxOffice", "text")}
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {field("taxAssessmentPeriodFrom", "number")}
                {field("taxAssessmentPeriodTo", "number")}
              </div>
              {field("charitablePurpose", "text")}
            </div>
          </div>
          <div class="card bg-base-200 shadow">
            <div class="card-body gap-4">
              <h2 class="card-title">{ORG_CONFIG_SECTIONS[2].title}</h2>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {field("iban", "text")}
                {field("bic", "text")}
              </div>
            </div>
          </div>
        </form>
      </div>
    </Layout>
  );
});

adminRoutes.post("/org-config", guard, async (c) => {
  const body = await c.req.parseBody();

  const periodFrom = String(body.taxAssessmentPeriodFrom ?? "").trim();
  const periodTo = String(body.taxAssessmentPeriodTo ?? "").trim();
  if (periodFrom && periodTo && Number(periodTo) < Number(periodFrom)) {
    setFlash(c, t("admin.orgConfig.flash.invalidPeriod"), "error");
    return c.redirect("/admin/org-config");
  }

  for (const field of ORG_CONFIG_FIELDS) {
    const value = normalizeOrgConfigValue(field.key, String(body[field.key] ?? "").trim());
    if (value) {
      await db
        .insert(orgConfig)
        .values({ key: field.key, value })
        .onConflictDoUpdate({ target: orgConfig.key, set: { value } });
    } else {
      await db.delete(orgConfig).where(eq(orgConfig.key, field.key));
    }
  }
  setFlash(c, t("admin.orgConfig.flash.saved"), "success");
  return c.redirect("/admin/org-config");
});

// ── /admin/backup ──────────────────────────────────────────────────────────────
adminRoutes.get("/backup", guard, async (c) => {
  const user = c.get("user");
  const [entries, warn] = await Promise.all([
    db.select().from(backupHistory).orderBy(desc(backupHistory.startedAt)).limit(50),
    backupWarnProps(),
  ]);

  const schedule = isBackupConfigured() ? getCronScheduleTimes(env.BACKUP_SCHEDULE) : null;
  const lastBackupAfterSchedule =
    schedule?.prev && entries[0]?.startedAt && entries[0].startedAt >= schedule.prev
      ? entries[0].status
      : null;

  return c.html(
    <Layout title="Backup" user={user} activeNav="admin">
      <BackupWarnBanner {...warn} />
      <AdminTabs active="backup" />
      {schedule && (
        <div class="grid grid-cols-2 gap-4 text-sm mb-6">
          <div class={`p-4 rounded-box border ${lastBackupAfterSchedule === "success" ? "bg-success/10 border-success/30" : "bg-error/10 border-error/30"}`}>
            <div class="text-base-content/50 mb-1">{t("admin.backup.scheduleLastTime")}</div>
            {schedule.prev ? (
              <>
                <div class="font-mono font-medium">{schedule.prev.toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                {lastBackupAfterSchedule === "success" ? (
                  <div class="mt-1 text-success">{t("admin.backup.backupAvailable")}</div>
                ) : lastBackupAfterSchedule === "failed" ? (
                  <div class="mt-1 text-error">{t("admin.backup.backupFailed")}</div>
                ) : (
                  <div class="mt-1 text-error">{t("admin.backup.backupMissing")}</div>
                )}
              </>
            ) : (
              <div class="text-base-content/40">—</div>
            )}
          </div>
          <div class="p-4 rounded-box border bg-base-200 border-base-300">
            <div class="text-base-content/50 mb-1">{t("admin.backup.scheduleNextTime")}</div>
            {schedule.next ? (
              <div class="font-mono font-medium">{schedule.next.toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
            ) : (
              <div class="text-base-content/40">—</div>
            )}
          </div>
        </div>
      )}
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">
          {t("admin.backup.title")}
        </h1>
        <form method="post" action="/admin/backup/run">
          <button
            type="submit"
            class="btn btn-outline btn-sm"
            onclick={`return confirm('${t("admin.backup.confirmStart")}')`}
          >
            {t("admin.backup.startNow")}
          </button>
        </form>
      </div>

      {entries.length === 0 ? (
        <p class="text-base-content/60">{t("admin.backup.noRuns")}</p>
      ) : (
        <div class="overflow-x-auto">
          <table class="table w-full">
            <thead>
              <tr>
                <th>{t("admin.backup.table.timestamp")}</th>
                <th>{t("admin.backup.table.targets")}</th>
                <th>{t("admin.backup.table.status")}</th>
                <th>{t("admin.backup.table.error")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const targets: { type: string; status: string; error?: string }[] = JSON.parse(e.targets);
                return (
                  <tr>
                    <td class="font-mono text-sm whitespace-nowrap">
                      {e.startedAt.toLocaleString("de-DE")}
                    </td>
                    <td>
                      <div class="flex gap-1 flex-wrap">
                        {targets.map((tgt) => (
                          <span
                            class={`badge badge-sm ${tgt.status === "success" ? "badge-success" : "badge-error"}`}
                          >
                            {tgt.type === "local" ? t("admin.backup.targetLocal") : "S3"}
                          </span>
                        ))}
                        {targets.length === 0 && <span class="text-base-content/40 text-sm">—</span>}
                      </div>
                    </td>
                    <td>
                      <span class={`badge ${e.status === "success" ? "badge-success" : "badge-error"}`}>
                        {e.status === "success" ? t("admin.backup.statusSuccess") : t("admin.backup.statusFailed")}
                      </span>
                    </td>
                    <td class="text-sm text-error max-w-xs truncate">{e.errorMessage ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
});

adminRoutes.post("/backup/run", guard, async (c) => {
  runBackup().catch((err) => console.error("[backup] manual run failed:", err));
  setFlash(c, t("admin.backup.flash.started"), "success");
  return c.redirect("/admin/backup");
});
