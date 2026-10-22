import { Hono, type Context } from "hono";
import { eq, and, count, asc, desc, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  users,
  sessions,
  accounts,
  anniversaryYears,
  backupHistory,
  appRoles,
  appRolePermissions,
  userAppRoles,
} from "../db/schema/index.js";
import { Icon } from "../components/icon.js";
import { SortIcon } from "./members.js";
import { RolePopover } from "../components/role-popover.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { ClickToEditHint, Layout, MemberTabs } from "../components/layout.js";
import { FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { SubNav } from "../components/sub-nav.js";
import { env, ENV_META } from "../env.js";
import { logger } from "../lib/logger.js";
import { getCronScheduleTimes, getLastBackup, isBackupConfigured, runBackup } from "../lib/backup.js";
import { t } from "../i18n/index.js";
import { PERMISSIONS, groupPermissionsForBadges, type Permission } from "../lib/roles.js";
import { setFlash } from "../lib/flash.js";
import { LOCAL_ADMIN_EMAIL, HTTP_STATUS } from "../lib/constants.js";
import { isPendingUser } from "../lib/registration.js";
import { SETTINGS, checkRole, clearDefaultRoleIfDeleted, getSettings, parseSettingsForm, setSetting } from "../lib/settings.js";

export const adminRoutes = new Hono<{ Variables: Variables }>();
const guard = requireAuth("system:admin");

// Lowercase search haystack: permission keys plus their German resource/permission labels.
export function permissionSearchText(perms: readonly Permission[]): string {
  return perms
    .map((p) => `${p} ${PERMISSION_LABELS[p] ?? ""} ${RESOURCE_LABELS[p.split(":")[0]] ?? ""}`)
    .join(" ")
    .toLowerCase();
}

// system:admin is reserved for the built-in protected `admin` role — never offered
// as a checkbox when composing a custom role in the "Berechtigungen" UI.
const ASSIGNABLE_PERMISSIONS = PERMISSIONS.filter((p) => p !== "system:admin");

const PERMISSION_LABELS: Record<Permission, string> = {
  "members:read": t("admin.permissions.key.membersRead"),
  "members:write": t("admin.permissions.key.membersWrite"),
  "members:delete": t("admin.permissions.key.membersDelete"),
  "members:bank-data:read": t("admin.permissions.key.membersBankDataRead"),
  "members:bank-data:write": t("admin.permissions.key.membersBankDataWrite"),
  "system:admin": t("admin.permissions.key.systemAdmin"),
  "donations:read": t("admin.permissions.key.donationsRead"),
  "donations:record": t("admin.permissions.key.donationsRecord"),
  "donations:delete": t("admin.permissions.key.donationsDelete"),
  "donations:issue-receipts": t("admin.permissions.key.donationsIssueReceipts"),
  "applications:read": t("admin.permissions.key.applicationsRead"),
  "applications:record": t("admin.permissions.key.applicationsRecord"),
  "applications:review": t("admin.permissions.key.applicationsReview"),
  "applications:manage-forms": t("admin.permissions.key.applicationsManageForms"),
  "inventory:read": t("admin.permissions.key.inventoryRead"),
  "inventory:manage": t("admin.permissions.key.inventoryManage"),
  "lending:read": t("admin.permissions.key.lendingRead"),
  "lending:manage": t("admin.permissions.key.lendingManage"),
  "org:read": t("admin.permissions.key.orgRead"),
  "org:write": t("admin.permissions.key.orgWrite"),
  "org:tax-data:read": t("admin.permissions.key.orgTaxDataRead"),
  "org:tax-data:write": t("admin.permissions.key.orgTaxDataWrite"),
  "import:run": t("admin.permissions.key.importRun"),
  "member-roles:read": t("admin.permissions.key.memberRolesRead"),
  "member-roles:write": t("admin.permissions.key.memberRolesWrite"),
  "member-roles:delete": t("admin.permissions.key.memberRolesDelete"),
  "member-role-types:read": t("admin.permissions.key.memberRoleTypesRead"),
  "member-role-types:write": t("admin.permissions.key.memberRoleTypesWrite"),
  "member-role-types:delete": t("admin.permissions.key.memberRoleTypesDelete"),
  "anniversary-years:read": t("admin.permissions.key.anniversaryYearsRead"),
  "anniversary-years:write": t("admin.permissions.key.anniversaryYearsWrite"),
  "anniversary-years:delete": t("admin.permissions.key.anniversaryYearsDelete"),
};

const RESOURCE_LABELS: Record<string, string> = {
  members: t("admin.permissions.resource.members"),
  system: t("admin.permissions.resource.system"),
  donations: t("admin.permissions.resource.donations"),
  applications: t("admin.permissions.resource.applications"),
  inventory: t("admin.permissions.resource.inventory"),
  lending: t("admin.permissions.resource.lending"),
  org: t("admin.permissions.resource.org"),
  "anniversary-years": t("admin.permissions.resource.anniversary-years"),
  "member-roles": t("admin.permissions.resource.member-roles"),
  "member-role-types": t("admin.permissions.resource.member-role-types"),
};

function AdminTabs({ active }: { active: "users" | "permissions" | "config" | "backup" }) {
  return (
    <SubNav items={(["users", "permissions", "config", "backup"] as const).map((k) => ({ href: `/admin/${k}`, active: active === k, label: t(`admin.tabs.${k}`) }))} />
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

function getBackupWarnProps(
  configured: boolean,
  last: Awaited<ReturnType<typeof getLastBackup>> | null,
  schedule: ReturnType<typeof getCronScheduleTimes> | null,
) {
  const lastFailed = schedule?.prev
    ? !(last?.startedAt && last.startedAt >= schedule.prev && last.status === "success")
    : last?.status === "failed";
  return { configured, lastFailed: lastFailed ?? false };
}

export async function backupWarnProps() {
  const configured = isBackupConfigured();
  const last = configured ? await getLastBackup() : null;
  const schedule = configured ? getCronScheduleTimes(env.BACKUP_SCHEDULE) : null;
  return getBackupWarnProps(configured, last, schedule);
}

export function ModalScaffold() {
  return (
    <dialog id="admin-modal" class="modal">
      <div class="modal-box max-w-2xl" id="modal-content" />
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
    <RolePopover roles={roles} label={t("admin.users.roleCount", { count: roles.length })} />
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
  const isPending = (u: typeof allUsers[number]) => isPendingUser(u, rolesByUser.has(u.id));
  const onlyPending = c.req.query("filter") === "pending";
  const pendingCount = allUsers.filter(isPending).length;
  const shownUsers = onlyPending ? allUsers.filter(isPending) : allUsers;

  return c.html(
    <Layout title={t("admin.users.title")} user={user} activeNav="admin">
      <AdminTabs active="users" />
      <BackupWarnBanner {...warn} />
      <PageHeader title={t("admin.users.title")} actions={<HeaderAction variant="primary" icon="plus" label={t("admin.users.newUser")} href="/admin/users/new" class="btn-primary" />} />

      <div class="tabs tabs-boxed mb-2 w-fit">
        <a href="/admin/users" class={`tab${onlyPending ? "" : " tab-active"}`}>{t("admin.users.filter.all")}</a>
        <a href="/admin/users?filter=pending" class={`tab${onlyPending ? " tab-active" : ""}`}>
          {t("admin.users.filter.pending")}
          {pendingCount > 0 && <span class="badge badge-warning badge-sm ml-1">{pendingCount}</span>}
        </a>
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
            {shownUsers.map((u) => {
              const isLocal = u.email === LOCAL_ADMIN_EMAIL;
              return (
                <tr
                  key={u.id}
                  {...(!isLocal && {
                    class: "cursor-pointer hover",
                    onclick: `location.href='/admin/users/${u.id}/edit'`,
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
                    ) : !isLocal && !u.emailVerified ? (
                      <span class="badge badge-warning badge-sm">{t("admin.users.statusEmailUnverified")}</span>
                    ) : isPending(u) ? (
                      <span class="badge badge-warning badge-sm">{t("admin.users.statusPending")}</span>
                    ) : !isLocal && u.lastLoginAt === null ? (
                      <span class="badge badge-warning badge-sm">{t("admin.users.statusUnconfirmed")}</span>
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
                              class="btn btn-outline btn-error btn-xs"
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
                            {isPending(u) && u.id !== user.id && (
                              <>
                                <button
                                  class="btn btn-outline btn-error btn-xs"
                                  onclick={`event.stopPropagation(); document.getElementById('reject-${u.id}').showModal()`}
                                >
                                  {t("admin.users.reject")}
                                </button>
                                <dialog id={`reject-${u.id}`} class="modal" onclick="event.stopPropagation()">
                                  <div class="modal-box">
                                    <h3 class="font-bold text-lg">{t("admin.users.confirmReject.title")}</h3>
                                    <p class="py-2 opacity-70">
                                      {t("admin.users.confirmReject.body", { name: u.name, email: u.email })}
                                    </p>
                                    <div class="modal-action">
                                      <form method="dialog">
                                        <button class="btn">{t("common.cancel")}</button>
                                      </form>
                                      <form method="post" action={`/admin/users/${u.id}/reject`}>
                                        <button type="submit" class="btn btn-error">{t("admin.users.reject")}</button>
                                      </form>
                                    </div>
                                  </div>
                                  <form method="dialog" class="modal-backdrop">
                                    <button>{t("common.close")}</button>
                                  </form>
                                </dialog>
                              </>
                            )}
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
    <div class="role-picker flex flex-col gap-2">
      <label class="input input-bordered input-sm flex items-center gap-2 w-full">
        <Icon name="magnifying-glass" class="w-4 h-4 opacity-60" />
        <input
          type="text"
          autocomplete="off"
          class="grow min-w-0"
          placeholder={t("admin.users.modal.roleSearchPlaceholder")}
          oninput="const q=this.value.toLowerCase();this.closest('.role-picker').querySelectorAll('[data-role-item]').forEach(function(el){el.hidden=!el.dataset.roleItem.includes(q)})"
        />
      </label>
      <div class="flex flex-col gap-1">
        {allRoles.map((r) => (
          <label
            key={r.id}
            data-role-item={`${r.name} ${r.description ?? ""} ${permissionSearchText(permsByRole.get(r.id) ?? [])}`.toLowerCase()}
            class="flex items-start gap-3 border border-base-300 rounded-lg px-3 py-1.5 cursor-pointer has-[:checked]:border-primary"
          >
            <input type="checkbox" name="roles" value={r.id} class="checkbox checkbox-sm mt-1" checked={checkedIds.has(r.id)} />
            <div class="flex flex-col min-w-0">
              <span class="font-medium text-sm">{r.name}</span>
              {r.description && <span class="text-xs opacity-60 truncate">{r.description}</span>}
              <button
                type="button"
                class="btn btn-ghost btn-xs gap-1 self-start -ml-2"
                aria-expanded="false"
                onclick="event.preventDefault();const p=this.nextElementSibling;p.hidden=!p.hidden;this.setAttribute('aria-expanded',String(!p.hidden));this.querySelector('svg').classList.toggle('rotate-180')"
              >
                {t("admin.users.modal.roleDetails")}
                <Icon name="chevron-down" class="h-4 w-4 opacity-60" />
              </button>
              <div hidden class="mt-1"><PermissionBadges permissions={permsByRole.get(r.id) ?? []} /></div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

// Read-only union of the permissions of all checked roles; re-rendered client-side on every checkbox change.
// shortcut: grouping logic is duplicated in the inline script (mirrors groupPermissionsForBadges), keep in sync.
function EffectivePermissions({ permsByRole, checkedIds }: { permsByRole: Map<string, Permission[]>; checkedIds: Set<string> }) {
  const union = [...new Set([...checkedIds].flatMap((id) => permsByRole.get(id) ?? []))];
  const totals: Record<string, number> = {};
  for (const p of PERMISSIONS) totals[p.split(":")[0]] = (totals[p.split(":")[0]] ?? 0) + 1;
  const cfg = {
    byRole: Object.fromEntries(permsByRole),
    all: PERMISSIONS,
    totals,
    labels: PERMISSION_LABELS,
    resources: RESOURCE_LABELS,
    full: t("admin.permissions.badge.full"),
    resourceFull: t("admin.permissions.badge.resourceFull", { resource: "{resource}" }),
  };
  const script = `(function(){var s=document.currentScript,c=JSON.parse(s.previousElementSibling.textContent),box=s.parentElement,f=box.closest('form');
function mk(cls,txt){var e=document.createElement('span');e.className='badge badge-sm whitespace-nowrap '+cls;e.textContent=txt;return e}
function render(){var set={};f.querySelectorAll('input[name=roles]:checked').forEach(function(i){(c.byRole[i.value]||[]).forEach(function(p){set[p]=1})});
var out=box.querySelector('[data-effective]');out.replaceChildren();
if(c.all.every(function(p){return set[p]})){out.append(mk('badge-primary',c.full));return}
var by={};c.all.forEach(function(p){if(set[p]){var r=p.split(':')[0];(by[r]=by[r]||[]).push(p)}});
Object.keys(by).forEach(function(r){if(by[r].length>1&&by[r].length===c.totals[r])out.append(mk('badge-outline badge-primary',c.resourceFull.replace('{resource}',c.resources[r]||r)));else by[r].forEach(function(p){out.append(mk('badge-outline',c.labels[p]))})})}
f.addEventListener('change',function(e){if(e.target.name==='roles')render()});})()`;
  return (
    <div>
      <script type="application/json" dangerouslySetInnerHTML={{ __html: JSON.stringify(cfg).replace(/</g, "\\u003c") }} />
      <script dangerouslySetInnerHTML={{ __html: script }} />
      <div data-effective><PermissionBadges permissions={union} /></div>
    </div>
  );
}

type UserFormState = { id?: string; oidcLinked?: boolean; name: string; email: string; checkedIds: Set<string>; error?: string };

// Vollseite für Anlegen/Bearbeiten; bei Validierungsfehlern mit 422 und den eingegebenen Werten erneut gerendert.
async function renderUserForm(c: Context<{ Variables: Variables }>, f: UserFormState, status: 200 | 422 = 200) {
  const [allRoles, permRows] = await Promise.all([
    db.select({ id: appRoles.id, name: appRoles.name, description: appRoles.description }).from(appRoles).orderBy(asc(appRoles.name)),
    db.select({ roleId: appRolePermissions.roleId, permission: appRolePermissions.permission }).from(appRolePermissions),
  ]);
  const permsByRole = new Map<string, Permission[]>();
  for (const p of permRows) permsByRole.set(p.roleId, [...(permsByRole.get(p.roleId) ?? []), p.permission]);
  if (f.id && f.oidcLinked === undefined) {
    const [link] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.userId, f.id), eq(accounts.providerId, "oidc")));
    f.oidcLinked = !!link;
  }
  const title = t(f.id ? "admin.users.modal.edit" : "admin.users.modal.create");
  return c.html(
    <Layout title={title} user={c.get("user")} activeNav="admin">
      <AdminTabs active="users" />
      <PageHeader title={title} backHref="/admin/users" actions={<FormActions formId="admin-users-form" />} />
      {f.error && <div class="alert alert-error mb-4 max-w-2xl">{f.error}</div>}
      <form id="admin-users-form" method="post" action={f.id ? `/admin/users/${f.id}` : "/admin/users"} class="flex flex-col gap-3 max-w-2xl">
        <div class="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-x-3">
          <span class="label-text text-right">{t("admin.users.modal.nameLabel")} <span class="text-error">*</span></span>
          <input type="text" name="name" value={f.name} class="input input-bordered w-full" required />
        </div>
        <div class="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-x-3">
          <span class="label-text text-right pt-2">{t("admin.users.modal.emailLabel")} <span class="text-error">*</span></span>
          <div class="flex flex-col gap-1">
            {f.oidcLinked ? (
              <>
                <span class="py-2">{f.email}</span>
                <span class="label-text-alt text-sm opacity-60">{t("admin.users.modal.emailOidcLocked")}</span>
              </>
            ) : (
              <input type="email" name="email" value={f.email} class="input input-bordered w-full" required />
            )}
          </div>
        </div>
        <div class="grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-x-3">
          <span class="label-text text-right pt-3">{t("admin.users.modal.roleLabel")}</span>
          <RoleCheckboxes allRoles={allRoles} permsByRole={permsByRole} checkedIds={f.checkedIds} />
        </div>
        <div class="grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-x-3">
          <span class="label-text text-right pt-1">{t("admin.users.modal.effectivePermissions")}</span>
          <EffectivePermissions permsByRole={permsByRole} checkedIds={f.checkedIds} />
        </div>
      </form>
    </Layout>,
    status
  );
}

adminRoutes.get("/users/new", guard, (c) => renderUserForm(c, { name: "", email: "", checkedIds: new Set() }));

adminRoutes.get("/users/:id/edit", guard, async (c) => {
  const id = c.req.param("id");
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u || u.email === LOCAL_ADMIN_EMAIL) return c.html("", HTTP_STATUS.NOT_FOUND);
  const assigned = await db.select({ roleId: userAppRoles.roleId }).from(userAppRoles).where(eq(userAppRoles.userId, id));
  return renderUserForm(c, { id, name: u.name, email: u.email, checkedIds: new Set(assigned.map((a) => a.roleId)) });
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
    return renderUserForm(c, {  name, email, checkedIds: new Set(roleIds), error: t("admin.users.flash.missingFields") }, 422);
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (existing.length > 0) {
    return renderUserForm(c, {  name, email, checkedIds: new Set(roleIds), error: t("admin.users.flash.emailExists") }, 422);
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
  if (!existing || existing.email === LOCAL_ADMIN_EMAIL) return c.html("", HTTP_STATUS.NOT_FOUND);

  const body = await c.req.parseBody({ all: true });
  const name = String(body.name ?? "").trim();
  const [oidcLink] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.userId, id), eq(accounts.providerId, "oidc")));
  // OIDC-linked users: email is owned by the IdP, ignore any submitted value.
  const email = oidcLink ? existing.email : String(body.email ?? "").trim().toLowerCase();
  const roleIds = await validRoleIds(([] as string[]).concat((body.roles as string | string[] | undefined) ?? []));

  if (!name || !email) {
    return renderUserForm(c, { id, oidcLinked: !!oidcLink, name, email, checkedIds: new Set(roleIds), error: t("admin.users.flash.missingFields") }, 422);
  }

  if (email !== existing.email) {
    const dupe = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (dupe.length > 0) {
      return renderUserForm(c, { id, oidcLinked: !!oidcLink, name, email, checkedIds: new Set(roleIds), error: t("admin.users.flash.emailExists") }, 422);
    }
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
  if (!u || u.email === LOCAL_ADMIN_EMAIL) return c.html("", HTTP_STATUS.NOT_FOUND);

  await db.update(users).set({ disabled: true, updatedAt: new Date() }).where(eq(users.id, id));
  await db.delete(sessions).where(eq(sessions.userId, id));

  setFlash(c, t("admin.users.flash.deactivated"), "success");
  return c.redirect("/admin/users");
});

// POST /admin/users/:id/activate
adminRoutes.post("/users/:id/activate", guard, async (c) => {
  const id = c.req.param("id");
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, id));
  if (!u || u.email === LOCAL_ADMIN_EMAIL) return c.html("", HTTP_STATUS.NOT_FOUND);

  await db.update(users).set({ disabled: false, updatedAt: new Date() }).where(eq(users.id, id));

  setFlash(c, t("admin.users.flash.activated"), "success");
  return c.redirect("/admin/users");
});

// POST /admin/users/:id/reject — delete a user still waiting for approval (no app role)
adminRoutes.post("/users/:id/reject", guard, async (c) => {
  const id = c.req.param("id");
  if (c.get("user").id === id) return c.html("", HTTP_STATUS.FORBIDDEN);

  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, id));
  if (!u || u.email === LOCAL_ADMIN_EMAIL) return c.html("", HTTP_STATUS.NOT_FOUND);
  const roles = await db.select({ roleId: userAppRoles.roleId }).from(userAppRoles).where(eq(userAppRoles.userId, id));
  if (roles.length > 0) return c.html("", HTTP_STATUS.BAD_REQUEST);

  await db.delete(users).where(eq(users.id, id));
  setFlash(c, t("admin.users.flash.rejected"), "success");
  return c.redirect("/admin/users");
});

// POST /admin/users/:id/delete
adminRoutes.post("/users/:id/delete", guard, async (c) => {
  const id = c.req.param("id");
  const currentUser = c.get("user");
  if (currentUser.id === id) return c.html("", HTTP_STATUS.FORBIDDEN);

  const [u] = await db.select({ email: users.email, disabled: users.disabled }).from(users).where(eq(users.id, id));
  if (!u || u.email === LOCAL_ADMIN_EMAIL) return c.html("", HTTP_STATUS.NOT_FOUND);
  if (!u.disabled) return c.html("", HTTP_STATUS.BAD_REQUEST);

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
      <AdminTabs active="permissions" />
      <BackupWarnBanner {...warn} />

      <div class="max-w-4xl mx-auto">
      <PageHeader title={t("admin.permissions.title")} actions={<HeaderAction variant="primary" icon="plus" label={t("admin.permissions.newRole")} href="/admin/permissions/new" class="btn-primary" />} />

      <label class="input input-bordered input-sm flex items-center gap-2 mb-3 max-w-xs">
        <Icon name="magnifying-glass" class="w-4 h-4 opacity-60" />
        <input
          type="search"
          class="grow min-w-0"
          placeholder={t("admin.permissions.searchPlaceholder")}
          oninput="const q=this.value.toLowerCase();this.closest('div').querySelectorAll('tbody tr[data-search]').forEach(function(el){el.hidden=!el.dataset.search.includes(q)})"
        />
      </label>
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
                  data-search={`${r.name} ${r.description ?? ""} ${permissionSearchText(permsByRole.get(r.id) ?? [])}`.toLowerCase()}
                  class="cursor-pointer hover"
                  onclick={`location.href='/admin/permissions/${r.id}/edit'`}
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
                    {(permsByRole.get(r.id) ?? []).length === 0 && (
                      <span class="badge badge-warning badge-sm">{t("admin.permissions.noPermissionsWarning")}</span>
                    )}
                    <PermissionBadges permissions={permsByRole.get(r.id) ?? []} />
                  </td>
                  <td>
                    <div class="flex gap-2 justify-end">
                      <a href={`/admin/permissions/new?copyFrom=${r.id}`} class="btn btn-outline btn-primary btn-xs" onclick="event.stopPropagation()">{t("common.copy")}</a>
                      {canDelete ? (
                        <>
                          <button
                            class="btn btn-outline btn-error btn-xs"
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

type PermFormState = { id?: string; readOnly?: boolean; name: string; nameLocked?: boolean; description: string; checked: Set<Permission>; error?: string };

async function renderPermissionForm(c: Context<{ Variables: Variables }>, f: PermFormState, status: 200 | 422 = 200) {
  const title = t(f.id ? "admin.permissions.modal.edit" : "admin.permissions.modal.create");
  return c.html(
    <Layout title={title} user={c.get("user")} activeNav="admin">
      <AdminTabs active="permissions" />
      <PageHeader title={title} backHref="/admin/permissions" actions={f.readOnly ? undefined : <FormActions formId="admin-permissions-form" />} />
      {f.readOnly && <div class="alert alert-info mb-4 max-w-2xl">🔒 {t("admin.roles.systemRole")} – {t("admin.permissions.readOnlyHint")}</div>}
      {f.error && <div class="alert alert-error mb-4 max-w-2xl">{f.error}</div>}
      <form id="admin-permissions-form" method="post" action={f.id ? `/admin/permissions/${f.id}` : "/admin/permissions"} class="flex flex-col gap-3 max-w-2xl">
        <fieldset disabled={f.readOnly} class="contents">
        <div class="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-x-3">
          <span class="label-text text-right pt-2">{t("admin.permissions.modal.nameLabel")} <span class="text-error">*</span></span>
          {f.nameLocked ? (
            <div class="flex flex-col gap-1">
              <input type="text" value={f.name} class="input input-bordered w-full opacity-50" disabled />
              <span class="label-text-alt text-sm opacity-60">{t("admin.permissions.modal.nameLocked")}</span>
              <input type="hidden" name="name" value={f.name} />
            </div>
          ) : (
            <input type="text" name="name" value={f.name} class="input input-bordered w-full" required />
          )}
        </div>
        <div class="grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-x-3">
          <span class="label-text text-right pt-2">{t("admin.permissions.modal.descriptionLabel")}</span>
          <textarea name="description" rows={2} class="textarea textarea-bordered w-full">{f.description}</textarea>
        </div>
        <div class="grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-x-3">
          <span class="label-text text-right pt-1">{t("admin.permissions.modal.permissionsLabel")}</span>
          <PermissionCheckboxes checked={f.checked} />
        </div>
        </fieldset>
      </form>
    </Layout>,
    status
  );
}

adminRoutes.get("/permissions/new", guard, async (c) => {
  const copyFrom = c.req.query("copyFrom");
  if (copyFrom) {
    const [src] = await db.select().from(appRoles).where(eq(appRoles.id, copyFrom));
    if (!src) return c.notFound();
    const perms = await db.select().from(appRolePermissions).where(eq(appRolePermissions.roleId, copyFrom));
    return renderPermissionForm(c, { name: "", description: src.description ?? "", checked: new Set(perms.map((p) => p.permission)) });
  }
  return renderPermissionForm(c, { name: "", description: "", checked: new Set() });
});

adminRoutes.get("/permissions/:id/edit", guard, async (c) => {
  const id = c.req.param("id");
  const [role] = await db.select().from(appRoles).where(eq(appRoles.id, id));
  if (!role) return c.html("", HTTP_STATUS.NOT_FOUND);
  const [{ cnt }] = await db.select({ cnt: count() }).from(userAppRoles).where(eq(userAppRoles.roleId, id));
  const perms = await db.select({ permission: appRolePermissions.permission }).from(appRolePermissions).where(eq(appRolePermissions.roleId, id));
  return renderPermissionForm(c, { id, readOnly: role.isProtected, name: role.name, nameLocked: cnt > 0, description: role.description ?? "", checked: new Set(perms.map((p) => p.permission)) });
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

  const form = { name, description: String(body.description ?? "").trim(), checked: new Set(permissions) };
  if (!name) return renderPermissionForm(c, { ...form, error: t("admin.permissions.flash.requiredName") }, 422);
  if (permissions.length === 0) return renderPermissionForm(c, { ...form, error: t("admin.permissions.flash.requiredPermission") }, 422);

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
  if (!role || role.isProtected) return c.html("", HTTP_STATUS.NOT_FOUND);

  const body = await c.req.parseBody({ all: true });
  const permissions = parsePermissions(body);
  const description = String(body.description ?? "").trim() || null;
  const [{ cnt }] = await db.select({ cnt: count() }).from(userAppRoles).where(eq(userAppRoles.roleId, id));

  const name = cnt === 0 ? String(body.name ?? "").trim() : role.name;
  const form = { id, name, nameLocked: cnt > 0, description: description ?? "", checked: new Set(permissions) };
  if (!name) return renderPermissionForm(c, { ...form, error: t("admin.permissions.flash.requiredName") }, 422);
  if (permissions.length === 0) return renderPermissionForm(c, { ...form, error: t("admin.permissions.flash.requiredPermission") }, 422);
  const updates: { name?: string; description: string | null } = { description };
  if (cnt === 0) updates.name = name;
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

  await clearDefaultRoleIfDeleted(id);
  await db.delete(appRoles).where(eq(appRoles.id, id));
  setFlash(c, t("admin.permissions.flash.deleted", { name: role.name }), "success");
  return c.redirect("/admin/permissions");
});

// ── /admin/config ─────────────────────────────────────────────────────────────
const CONFIG_DESCRIPTIONS: Record<string, string> = {
  ORG_NAME: t("admin.config.desc.ORG_NAME"),
  CHILDREN_AGE_LIMIT: t("admin.config.desc.CHILDREN_AGE_LIMIT"),
  YOUTH_AGE_LIMIT: t("admin.config.desc.YOUTH_AGE_LIMIT"),
  ACTIVE_AGE_LIMIT: t("admin.config.desc.ACTIVE_AGE_LIMIT"),
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
  const [warn, settings, roles] = await Promise.all([
    backupWarnProps(),
    getSettings(),
    db.select({ id: appRoles.id, name: appRoles.name }).from(appRoles).orderBy(asc(appRoles.name)),
  ]);
  const rows = [
    ...ENV_META.map(({ key, value }) => ({ key, writable: false as const, value: value ?? null })),
    ...SETTINGS.map((s) => ({ key: s.key, writable: true as const, type: s.type, value: settings[s.key] })),
  ];
  return c.html(
    <Layout title={t("admin.config.title")} user={user} activeNav="admin">
      <AdminTabs active="config" />
      <BackupWarnBanner {...warn} />
      <div class="max-w-4xl mx-auto">
      <PageHeader title={t("admin.config.title")} actions={<HeaderAction variant="primary" icon="check" label={t("admin.config.save")} form="config-form" class="btn-primary" attrs={{ id: "config-save", disabled: "" }} />} />
      <form method="post" action="/admin/config" id="config-form">
        <div class="flex flex-wrap items-center gap-2 mb-4">
          <label class="input input-bordered input-sm flex items-center gap-2"><Icon name="magnifying-glass" class="w-4 h-4 opacity-60" /><input type="search" id="config-search" class="grow min-w-0" placeholder={t("admin.config.search")} /></label>
          <label class="label cursor-pointer gap-2">
            <input type="checkbox" id="config-filter" class="toggle toggle-sm" />
            <span class="label-text">{t("admin.config.filter.writable")}</span>
          </label>
        </div>
        <div class="overflow-x-auto">
          <table class="table table-zebra w-full">
            <thead>
              <tr>
                <th>{t("admin.config.table.variable")}</th>
                <th>{t("admin.config.table.value")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr data-config-row data-writable={r.writable ? "1" : "0"}>
                  <td>
                    <span class="font-mono text-sm">{r.key}</span>
                    <p class="text-sm text-base-content/50 mt-0.5">
                      {CONFIG_DESCRIPTIONS[r.key] ?? t(`admin.config.desc.${r.key}` as never)}
                    </p>
                  </td>
                  <td class="font-mono text-sm">
                    {!r.writable ? (
                      r.value ?? <span class="opacity-40">—</span>
                    ) : r.type === "boolean" ? (
                      <input type="checkbox" class="toggle" name={r.key} value="1" checked={r.value === "true"} />
                    ) : (
                      <select name={r.key} class="select select-bordered select-sm">
                        <option value="">{t("admin.config.noRole")}</option>
                        {roles.map((role) => (
                          <option value={role.id} selected={role.id === r.value}>{role.name}</option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </form>
      <script
        dangerouslySetInnerHTML={{
          __html: `(() => {
  const form = document.getElementById('config-form');
  const save = document.getElementById('config-save');
  const search = document.getElementById('config-search');
  const filter = document.getElementById('config-filter');
  const snap = () => new URLSearchParams(new FormData(form)).toString();
  const initial = snap();
  const refreshSave = () => { save.disabled = snap() === initial; };
  form.addEventListener('input', refreshSave);
  form.addEventListener('change', refreshSave);
  const apply = () => {
    const q = search.value.trim().toLowerCase();
    document.querySelectorAll('[data-config-row]').forEach((tr) => {
      const hideW = filter.checked && tr.dataset.writable !== '1';
      tr.hidden = hideW || (q && !tr.textContent.toLowerCase().includes(q));
    });
  };
  search.addEventListener('input', apply);
  filter.addEventListener('change', apply);
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
})();`,
        }}
      />
      </div>
    </Layout>
  );
});

// POST /admin/config — save writable settings (env rows are read-only)
adminRoutes.post("/config", guard, async (c) => {
  const body = await c.req.parseBody();
  const result = await parseSettingsForm(body, checkRole);
  if ("error" in result) {
    setFlash(c, t(`admin.config.flash.${result.error}` as never), "error");
    return c.redirect("/admin/config");
  }
  for (const s of SETTINGS) await setSetting(s.key, result.values[s.key]);
  setFlash(c, t("admin.config.flash.saved"), "success");
  return c.redirect("/admin/config");
});

// ── /admin/backup ──────────────────────────────────────────────────────────────
adminRoutes.get("/backup", guard, async (c) => {
  const user = c.get("user");
  const configured = isBackupConfigured();
  const schedule = configured ? getCronScheduleTimes(env.BACKUP_SCHEDULE) : null;
  const entries = await db.select().from(backupHistory).orderBy(desc(backupHistory.startedAt)).limit(50);
  const warn = getBackupWarnProps(configured, entries[0] ?? null, schedule);
  const lastBackupAfterSchedule =
    schedule?.prev && entries[0]?.startedAt && entries[0].startedAt >= schedule.prev
      ? entries[0].status
      : null;

  return c.html(
    <Layout title="Backup" user={user} activeNav="admin">
      <AdminTabs active="backup" />
      <BackupWarnBanner {...warn} />
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
      <PageHeader title={t("admin.backup.title")} actions={<HeaderAction icon="arrow-down-tray" label={t("admin.backup.startNow")} form="backup-form" class="btn-outline" onclick={`return confirm('${t("admin.backup.confirmStart")}')`} />} />
      <form id="backup-form" method="post" action="/admin/backup/run" />

      {entries.length === 0 ? (
        <p class="text-base-content/60">{t("admin.backup.noRuns")}</p>
      ) : (
        <div class="overflow-x-auto">
          <table class="table table-zebra w-full">
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
                      <span class={`badge badge-sm ${e.status === "success" ? "badge-success" : "badge-error"}`}>
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
  runBackup().catch((err) => logger.error({ err }, "[backup] manual run failed"));
  setFlash(c, t("admin.backup.flash.started"), "success");
  return c.redirect("/admin/backup");
});
