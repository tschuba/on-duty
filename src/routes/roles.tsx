import { Hono, type Context } from "hono";
import { Field, ViewField, ViewGrid } from "../components/field.js";
import { eq, and, count, countDistinct, asc, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { memberRoles, memberRoleTypes, memberRoleAssignments } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { ClickToEditHint, Layout } from "../components/layout.js";
import { DetailActions, FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { ToggleFilter, pairToggles } from "../components/toggle-filter.js";
import { Icon } from "../components/icon.js";
import { RowAction } from "../components/row-action.js";
import { DeleteDialog } from "../components/delete-dialog.js";
import { ModalScaffold } from "./admin.js";
import { flagAllowed, isPermutation, moveId } from "../lib/role-types.js";
import { setFlash } from "../lib/flash.js";
import { HTTP_STATUS } from "../lib/constants.js";
import { t } from "../i18n/index.js";
import { TitleSwitch } from "../components/title-switch.js";
import { memberViews } from "./members.js";

const ROLES_URL = "/members?view=roles";
export const roleRoutes = new Hono<{ Variables: Variables }>();
const rolesRead = requireAuth("member-roles:read");
const rolesWrite = requireAuth("member-roles:write");
const rolesDelete = requireAuth("member-roles:delete");
const typesRead = requireAuth("member-role-types:read");
const typesWrite = requireAuth("member-role-types:write");
const typesDelete = requireAuth("member-role-types:delete");

// Validation errors re-render the list with an error dialog on top.
function badRequest(c: any, message: string, detail?: string[], title?: string) {
  return rolesPage(c, { message, detail, title });
}

// Writes dense 1..n sort_order for the given ids (in order).
async function writeOrder(table: typeof memberRoles | typeof memberRoleTypes, ids: string[]) {
  await db.transaction(async (tx) => {
    for (const [i, id] of ids.entries()) await tx.update(table).set({ sortOrder: i + 1 }).where(eq(table.id, id));
  });
}

async function nextRoleSortOrder(typeId: string) {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${memberRoles.sortOrder}), 0)` })
    .from(memberRoles)
    .where(eq(memberRoles.typeId, typeId));
  return Number(row?.max ?? 0) + 1;
}

const REORDER_SCRIPT = `
(function () {
  // Remember collapsed sections across reloads (reorder reloads the page).
  var closed = JSON.parse(localStorage.getItem('roleSectionsClosed') || '[]');
  document.querySelectorAll('details[data-section]').forEach(function (d) {
    if (closed.indexOf(d.dataset.section) >= 0) d.open = false;
    d.addEventListener('toggle', function () {
      var c = Array.prototype.filter.call(document.querySelectorAll('details[data-section]'), function (x) { return !x.open; }).map(function (x) { return x.dataset.section; });
      localStorage.setItem('roleSectionsClosed', JSON.stringify(c));
    });
  });
  var drag = null;
  document.addEventListener('dragstart', function (e) {
    var tr = e.target.closest && e.target.closest('tr[data-id]');
    if (tr && tr.draggable) { drag = tr; e.dataTransfer.effectAllowed = 'move'; }
  });
  document.addEventListener('dragover', function (e) {
    var tr = e.target.closest && e.target.closest('tr[data-id]');
    if (!drag || !tr || tr === drag || tr.parentNode !== drag.parentNode) return;
    e.preventDefault();
    var after = e.clientY > tr.getBoundingClientRect().top + tr.offsetHeight / 2;
    tr.parentNode.insertBefore(drag, after ? tr.nextSibling : tr);
  });
  document.addEventListener('dragend', function () {
    if (!drag) return;
    var body = drag.parentNode, url = body.dataset.reorderUrl;
    drag = null;
    var p = new URLSearchParams();
    body.querySelectorAll('tr[data-id]').forEach(function (r) { p.append('id', r.dataset.id); });
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p })
      .then(function () { window.location.reload(); });
  });
})();
`;

function MoveButtons({ action, id, disabled }: { action: string; id: string; disabled?: boolean }) {
  return (
    <form method="post" action={action} class="join" onclick="event.stopPropagation()">
      <input type="hidden" name="id" value={id} />
      <RowAction icon="icon-[tabler--arrow-up]" label={t("admin.roles.moveUp")} class="btn-ghost join-item" iconOnly type="submit" disabled={disabled} attrs={{ name: "dir", value: "up" }} />
      <RowAction icon="icon-[tabler--arrow-down]" label={t("admin.roles.moveDown")} class="btn-ghost join-item" iconOnly type="submit" disabled={disabled} attrs={{ name: "dir", value: "down" }} />
    </form>
  );
}

export const rolesPage = async (c: Context<{ Variables: Variables }>, error?: { message: string; detail?: string[]; title?: string }) => {
  const user = c.get("user");
  const activeFilter = c.req.query("active"); // "1" | "0" | undefined

  const [types, allRoles] = await Promise.all([
    db.select().from(memberRoleTypes).orderBy(asc(memberRoleTypes.sortOrder)),
    db
      .select({
        id: memberRoles.id,
        title: memberRoles.title,
        typeId: memberRoles.typeId,
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
      .groupBy(memberRoles.id, memberRoles.title, memberRoles.typeId, memberRoles.grantsActiveStatus, memberRoles.isProtected, memberRoles.sortOrder)
      .orderBy(asc(memberRoles.sortOrder)),
  ]);
  // Types-only readers see the groups, but no role rows.
  const rolesWithCount = user.permissions.has("member-roles:read") ? allRoles : [];
  const typeCounts = new Map<string, number>();
  const flaggedCounts = new Map<string, number>();
  const allRoleRows = await db.select({ typeId: memberRoles.typeId, grants: memberRoles.grantsActiveStatus }).from(memberRoles);
  for (const r of allRoleRows) {
    typeCounts.set(r.typeId, (typeCounts.get(r.typeId) ?? 0) + 1);
    if (r.grants) flaggedCounts.set(r.typeId, (flaggedCounts.get(r.typeId) ?? 0) + 1);
  }
  const canWrite = user.permissions.has("member-roles:write");
  const canDeletePerm = user.permissions.has("member-roles:delete");
  const canWriteTypes = user.permissions.has("member-role-types:write");
  const canDeleteTypes = user.permissions.has("member-role-types:delete");
  const canReorder = canWrite && !activeFilter;

  return c.html(
    <Layout title={t("admin.roles.title")} user={user}>

      <div class="max-w-4xl mx-auto">
      <PageHeader title={<TitleSwitch items={memberViews(user.permissions as Set<string>, "roles")} />} actions={<>
        {canWriteTypes && <HeaderAction variant="secondary" icon="icon-[tabler--plus]" label={t("admin.roleTypes.new")} class="btn-outline" attrs={{ "hx-get": "/role-types/new", "hx-target": "#modal-content", "hx-swap": "innerHTML" }} />}
        {canWrite && <HeaderAction variant="primary" icon="icon-[tabler--plus]" label={t("admin.roles.newRole")} class="btn-primary" attrs={{ "hx-get": "/roles/new", "hx-target": "#modal-content", "hx-swap": "innerHTML" }} />}
      </>} />
      <div class="filter-bar mb-4 flex flex-wrap items-center gap-x-4">
        <ToggleFilter items={pairToggles(activeFilter === "1" || activeFilter === "0" ? activeFilter : "",
          [{ value: "1", label: t("admin.roles.filterActive") }, { value: "0", label: t("admin.roles.filterPassive") }],
          (v) => (v ? `${ROLES_URL}&active=${v}` : ROLES_URL))} />
      </div>

      {canWrite && <ClickToEditHint />}
      {types.map((ty) => {
        const typeRoles = rolesWithCount.filter((r) => r.typeId === ty.id);
        const locked = ty.allowsActiveStatus ? flaggedCounts.get(ty.id) ?? 0 : 0;
        return (
          <details key={ty.id} data-section={ty.id} open class="group collapse overflow-visible focus-within:z-30 border border-base-300 bg-base-100 mb-3">
            <summary class="collapse-title bg-base-300 pe-4">
              <div class="flex items-center gap-2">
                <div class="flex-1 min-w-0 text-lg font-bold flex items-center gap-2" style="font-family: var(--font-heading)">
                  {ty.isProtected && <span title={t("admin.roles.systemRole")}>🔒</span>}
                  <span class="truncate">{ty.name}</span> <span class="badge badge-ghost badge-sm">{typeRoles.length}</span>
                </div>
                <div class="flex gap-2 items-center relative z-10 ml-auto">
                  {canWriteTypes && !locked ? (
                    <form method="post" action={`/role-types/${ty.id}/allows-active`} class="relative z-10" onclick="event.stopPropagation()">
                      <label class="flex items-center gap-2 text-sm font-normal cursor-pointer" title={t("admin.roleTypes.table.allowsActiveLong")}>
                        <input type="checkbox" name="allowsActiveStatus" value="1" class="toggle toggle-sm border-2 border-base-content/50 text-base-content/60 hover:border-base-content checked:border-success checked:bg-success checked:text-success-content" checked={ty.allowsActiveStatus} onchange="this.form.requestSubmit()" aria-label={t("admin.roleTypes.table.allowsActiveLong")} />
                        <span class="max-md:hidden">{t("admin.roleTypes.table.allowsActive")}</span>
                      </label>
                    </form>
                  ) : ty.allowsActiveStatus && (
                    <>
                      <span class="badge badge-success badge-outline badge-sm max-md:hidden" title={locked ? t("admin.roleTypes.lockedHint", { count: locked }) : t("admin.roleTypes.table.allowsActiveLong")}>{t("admin.roleTypes.table.allowsActive")}</span>
                      <span class="badge badge-success badge-outline badge-sm md:hidden" title={locked ? t("admin.roleTypes.lockedHint", { count: locked }) : t("admin.roleTypes.table.allowsActiveLong")} aria-label={t("admin.roleTypes.table.allowsActiveLong")}><Icon name="icon-[tabler--check]" class="h-3 w-3" /></span>
                    </>
                  )}
                  {canWriteTypes && <MoveButtons action={`/role-types/${ty.id}/move`} id={ty.id} />}
                  {(() => {
                    const delOk = canDeleteTypes && !ty.isProtected && typeRoles.length === 0;
                    const delWhy = ty.isProtected ? t("admin.roleTypes.cannotDelete.protected") : t("admin.roleTypes.cannotDelete.notEmpty", { count: typeCounts.get(ty.id) ?? 0 });
                    const openDel = `event.stopPropagation(); document.getElementById('delete-type-${ty.id}').showModal()`;
                    return (<>
                      <div class="flex gap-2 items-center max-md:hidden">
                        {canWriteTypes && <RowAction icon="icon-[tabler--pencil]" label={t("common.edit")} class="btn-ghost" href={`/role-types/${ty.id}/edit`} />}
                        {delOk ? <RowAction icon="icon-[tabler--trash]" label={t("common.delete")} class="btn-outline btn-error" onclick={openDel} />
                          : canDeleteTypes && <RowAction icon="icon-[tabler--trash]" label={t("common.delete")} class="btn-ghost text-base-content/30" disabled title={delWhy} />}
                      </div>
                      {(canWriteTypes || canDeleteTypes) && (
                        <div class="dropdown dropdown-end md:hidden">
                          <div tabindex={0} role="button" class="btn btn-xs btn-ghost" onclick="event.preventDefault();event.stopPropagation()" aria-label={t("common.actions")}><Icon name="icon-[tabler--dots-vertical]" class="h-4 w-4" /></div>
                          <ul tabindex={0} class="dropdown-content menu bg-base-200 rounded-box z-20 w-48 p-2 shadow text-sm font-normal">
                            {canWriteTypes && <li><a href={`/role-types/${ty.id}/edit`}><Icon name="icon-[tabler--pencil]" class="h-4 w-4" />{t("common.edit")}</a></li>}
                            {canDeleteTypes && (delOk
                              ? <li><button type="button" class="text-error" onclick={openDel}><Icon name="icon-[tabler--trash]" class="h-4 w-4" />{t("common.delete")}</button></li>
                              : <li class="menu-disabled" title={delWhy}><span><Icon name="icon-[tabler--trash]" class="h-4 w-4" />{t("common.delete")}</span></li>)}
                          </ul>
                        </div>
                      )}
                      {delOk && <DeleteDialog triggerless id={`type-${ty.id}`} action={`/role-types/${ty.id}/delete`} title={t("admin.roleTypes.confirmDelete.title")} body={t("admin.roleTypes.confirmDelete.body", { name: ty.name })} />}
                    </>);
                  })()}
                  <Icon name="icon-[tabler--chevron-down]" class={`h-5 w-5 shrink-0 transition-transform group-open:rotate-180${ty.description ? " max-md:hidden" : ""}`} />
                </div>
              </div>
              {ty.description && <div class="flex items-center gap-2 text-sm font-normal opacity-70"><span class="flex-1 min-w-0">{ty.description}</span><Icon name="icon-[tabler--chevron-down]" class="h-5 w-5 shrink-0 transition-transform group-open:rotate-180 md:hidden" /></div>}
            </summary>
            <div class="collapse-content overflow-x-auto pt-4">
              <table class="table table-zebra w-full">
          <thead>
            <tr>
              <th>{t("admin.roles.table.name")}</th>
              {ty.allowsActiveStatus && <th>{t("admin.roles.table.activeStatus")}</th>}
              <th />
            </tr>
          </thead>
            <tbody data-reorder-url="/roles/reorder">
              {rolesWithCount.filter((r) => r.typeId === ty.id).map((r) => {
                const canDelete = canDeletePerm && !r.isProtected && r.assignmentCount === 0;
                return (
                  <tr
                    key={r.id}
                    data-id={r.id}
                    draggable={canReorder}
                    class="cursor-pointer hover"
                    onclick={`location.href='/roles/${r.id}'`}
                  >
                    <td class="font-medium">
                      {r.isProtected && (
                        <span class="mr-1" title={t("admin.roles.systemRole")}>
                          🔒
                        </span>
                      )}
                      {r.title}
                    </td>
                    {ty.allowsActiveStatus && (
                    <td>
                      <form method="post" action={`/roles/${r.id}/active`} onclick="event.stopPropagation()">
                        {activeFilter && <input type="hidden" name="active" value={activeFilter} />}
                        <label class="flex items-center gap-3 cursor-pointer w-fit">
                          <input
                            type="checkbox"
                            name="grantsActiveStatus"
                            value="1"
                            class="toggle border-2 border-base-content/50 text-base-content/60 hover:border-base-content checked:border-success checked:bg-success checked:text-success-content disabled:opacity-40"
                            checked={r.grantsActiveStatus}
                            disabled={r.isProtected || !canWrite}
                            onchange="this.form.requestSubmit()"
                            aria-label={t("admin.roles.table.activeStatus")}
                          />
                        </label>
                      </form>
                    </td>
                    )}
                    <td>
                      <div class="flex gap-2 justify-end items-center">
                        {canWrite && <MoveButtons action={`/roles/${r.id}/move`} id={r.id} />}
                        {canDelete ? (
                          <DeleteDialog
                            id={`role-${r.id}`}
                            action={`/roles/${r.id}/delete`}
                            title={t("admin.roles.confirmDelete.title")}
                            body={t("admin.roles.confirmDelete.body", { title: r.title })}
                          />
                        ) : canDeletePerm && (
                          <RowAction icon="icon-[tabler--trash]" label={t("common.delete")} class="btn-ghost text-base-content/30" disabled title={
                              r.isProtected
                                ? t("admin.roles.cannotDelete.protected")
                                : r.assignmentCount === 1
                                  ? t("admin.roles.cannotDelete.usedBySingle", { count: r.assignmentCount })
                                  : t("admin.roles.cannotDelete.usedByMultiple", { count: r.assignmentCount })
                            } />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
              </table>
            </div>
          </details>
        );
      })}

      </div>

      <ModalScaffold />
      {error && (
        <dialog class="modal modal-open" role="alertdialog">
          <div class="modal-box">
            <h3 class="font-bold text-lg flex items-center gap-2 text-error"><Icon name="icon-[tabler--alert-triangle]" class="h-5 w-5 shrink-0" />{error.title ?? t("common.error")}</h3>
            <p class="py-2">{error.message}</p>
            {error.detail && error.detail.length > 0 && <ul class="list-disc ml-5 max-h-[40dvh] overflow-y-auto text-sm sm:columns-2 gap-x-6">{error.detail.map((d) => <li>{d}</li>)}</ul>}
            <div class="modal-action"><a class="btn" href={ROLES_URL} autofocus>{t("common.close")}</a></div>
          </div>
          <a class="modal-backdrop" href={ROLES_URL} aria-label={t("common.close")} />
        </dialog>
      )}
      <script dangerouslySetInnerHTML={{ __html: REORDER_SCRIPT }} />
    </Layout>,
    error ? HTTP_STATUS.BAD_REQUEST : undefined
  );
};
// Alte Links (/roles?…) bleiben gültig.
roleRoutes.get("/roles", requireAuth(["member-roles:read", "member-role-types:read"]), (c) => {
  const u = new URL(c.req.url);
  u.searchParams.set("view", "roles");
  return c.redirect(`/members${u.search}`);
});
roleRoutes.get("/role-types", typesRead, (c) => c.redirect(ROLES_URL));

// POST /role-types/:id/move — dir=up|down
roleRoutes.post("/role-types/:id/move", typesWrite, async (c) => {
  const dir = (await c.req.parseBody()).dir === "up" ? "up" : "down";
  const current = await db.select().from(memberRoleTypes).orderBy(asc(memberRoleTypes.sortOrder));
  await writeOrder(memberRoleTypes, moveId(current.map((r) => r.id), c.req.param("id"), dir));
  return c.redirect(ROLES_URL);
});

function RoleForm({ types, role, hasAssignments, affected }: {
  types: (typeof memberRoleTypes.$inferSelect)[];
  role?: typeof memberRoles.$inferSelect;
  hasAssignments?: boolean;
  affected?: number;
}) {
  const typeId = role?.typeId ?? types[0]?.id;
  const typesJson = JSON.stringify(Object.fromEntries(types.map((ty) => [ty.id, ty.allowsActiveStatus])));
  return (
    <>
      {hasAssignments && role ? (
        <Field label={t("admin.roles.modal.nameLabel")} hint={t("admin.roles.modal.nameLocked")}>
          <input type="text" value={role.title} placeholder={t("admin.roles.modal.nameLabel")} class="input w-full opacity-50" disabled />
          <input type="hidden" name="title" value={role.title} />
        </Field>
      ) : (
        <Field label={t("admin.roles.modal.nameLabel")} required>
          <input type="text" name="title" value={role?.title ?? ""} placeholder={t("admin.roles.modal.nameLabel")} class="input w-full" required />
        </Field>
      )}
      <Field label={t("admin.roles.type.label")}>
        <select name="typeId" id="role-type-select" class="select w-full" data-allows={typesJson}>
          {types.map((ty) => <option value={ty.id} selected={ty.id === typeId}>{ty.name}</option>)}
        </select>
      </Field>
      <label class="label cursor-pointer justify-start gap-3">
        <input id="role-grants-active" type="checkbox" name="grantsActiveStatus" value="1" class="toggle border-2 border-base-content/50 text-base-content/60 hover:border-base-content checked:border-success checked:bg-success checked:text-success-content disabled:opacity-40" {...(role?.grantsActiveStatus ? { checked: true } : {})} />
        <span class="text-sm">{t("admin.roles.modal.grantsActive")}</span>
      </label>
      <span id="role-grants-hint" class="text-xs text-sm opacity-60 hidden">{t("admin.roles.type.flagNotAllowed")}</span>
      {role && (affected ?? 0) > 0 && (
        <span class="text-xs text-sm opacity-60">{t("admin.roles.modal.affected", { count: affected ?? 0 })}</span>
      )}
      <script dangerouslySetInnerHTML={{ __html: `
        (function () {
          var sel = document.getElementById('role-type-select'), cb = document.getElementById('role-grants-active'), hint = document.getElementById('role-grants-hint');
          var allows = JSON.parse(sel.dataset.allows);
          function sync() {
            var ok = allows[sel.value];
            if (!ok) cb.checked = false;
            cb.disabled = !ok;
            hint.classList.toggle('hidden', !!ok);
          }
          sel.addEventListener('change', sync); sync();
        })();
      ` }} />
    </>
  );
}

function ModalActions({ submit }: { submit: string }) {
  return (
    <div class="modal-action mt-2">
      <button type="button" class="btn btn-ghost" onclick="document.getElementById('admin-modal').close()">
        {t("common.cancel")}
      </button>
      <button type="submit" class="btn btn-primary">{submit}</button>
    </div>
  );
}

const SHOW_MODAL = <script dangerouslySetInnerHTML={{ __html: "document.getElementById('admin-modal').showModal();" }} />;

// HTMX fragment: new role modal
roleRoutes.get("/roles/new", rolesWrite, async (c) => {
  const types = await db.select().from(memberRoleTypes).orderBy(asc(memberRoleTypes.sortOrder));
  const copyFrom = c.req.query("copyFrom");
  let source: typeof memberRoles.$inferSelect | undefined;
  if (copyFrom) {
    [source] = await db.select().from(memberRoles).where(eq(memberRoles.id, copyFrom));
    if (!source) return c.html("", HTTP_STATUS.NOT_FOUND);
  }
  return c.html(
    <>
      <h3 class="font-bold text-lg mb-4">{t("admin.roles.modal.create")}</h3>
      <form method="post" action="/roles" class="flex flex-col gap-3">
        <RoleForm types={types} role={source && { ...source, title: "", isProtected: false }} />
        <ModalActions submit={t("common.create")} />
      </form>
      {SHOW_MODAL}
    </>
  );
});

// GET /roles/:id — read-only
roleRoutes.get("/roles/:id", rolesRead, async (c) => {
  const id = c.req.param("id");
  const [role] = await db.select().from(memberRoles).where(eq(memberRoles.id, id));
  if (!role) return c.notFound();
  const [type] = await db.select().from(memberRoleTypes).where(eq(memberRoleTypes.id, role.typeId));
  const user = c.get("user");
  const canWrite = !role.isProtected && user.permissions.has("member-roles:write");
  const canDeletePerm = user.permissions.has("member-roles:delete");
  const [{ cnt }] = await db.select({ cnt: count() }).from(memberRoleAssignments).where(eq(memberRoleAssignments.memberRoleId, id));
  const remove = canDeletePerm && !role.isProtected && cnt === 0 && (
    <DeleteDialog id={role.id} action={`/roles/${role.id}/delete`} title={t("admin.roles.confirmDelete.title")} body={t("admin.roles.confirmDelete.body", { title: role.title })} />
  );
  return c.html(
    <Layout title={role.title} user={user}>
      <div class="max-w-2xl mx-auto">
      <PageHeader title={<>{role.isProtected && "🔒 "}{role.title}</>} backHref={ROLES_URL} actions={<DetailActions editHref={canWrite ? `/roles/${id}/edit` : undefined} remove={remove} />} />
      <ViewGrid>
        <ViewField label={t("admin.roles.type.label")} value={type?.name} />
        <ViewField label={t("admin.roles.table.activeStatus")} value={role.grantsActiveStatus ? t("common.yes") : t("common.no")} />
      </ViewGrid>
      </div>
    </Layout>
  );
});

// GET/POST /roles/:id/edit — form, requires write permission on an unprotected role
roleRoutes.get("/roles/:id/edit", rolesRead, async (c) => {
  const id = c.req.param("id");
  const [role] = await db.select().from(memberRoles).where(eq(memberRoles.id, id));
  if (!role) return c.notFound();
  if (role.isProtected || !c.get("user").permissions.has("member-roles:write")) return c.redirect(`/roles/${id}`);

  const types = await db.select().from(memberRoleTypes).orderBy(asc(memberRoleTypes.sortOrder));
  const [{ cnt }] = await db
    .select({ cnt: count() })
    .from(memberRoleAssignments)
    .where(eq(memberRoleAssignments.memberRoleId, id));
  // Status is derived from open assignments: those members change status immediately.
  const [{ affected }] = await db
    .select({ affected: countDistinct(memberRoleAssignments.memberId) })
    .from(memberRoleAssignments)
    .where(and(eq(memberRoleAssignments.memberRoleId, id), isNull(memberRoleAssignments.to)));

  return c.html(
    <Layout title={t("admin.roles.modal.edit")} user={c.get("user")}>
      <div class="max-w-2xl mx-auto">
      <PageHeader title={t("admin.roles.modal.edit")} backHref={`/roles/${id}`} actions={<FormActions formId="role-form" cancelHref={`/roles/${id}`} />} />
      <form id="role-form" method="post" action={`/roles/${id}`} class="flex flex-col gap-3">
        <RoleForm types={types} role={role} hasAssignments={cnt > 0} affected={Number(affected)} />
      </form>
      </div>
    </Layout>
  );
});

// POST /roles — create
roleRoutes.post("/roles", rolesWrite, async (c) => {
  const body = await c.req.parseBody();
  const title = String(body.title ?? "").trim();
  const grantsActiveStatus = body.grantsActiveStatus === "1";
  const typeId = String(body.typeId ?? "");

  if (!title) {
    setFlash(c, t("admin.roles.flash.requiredTitle"), "error");
    return c.redirect(ROLES_URL);
  }
  const [type] = await db.select().from(memberRoleTypes).where(eq(memberRoleTypes.id, typeId));
  if (!type) return badRequest(c, t("admin.roles.flash.unknownType"));
  if (!flagAllowed(grantsActiveStatus, type)) return badRequest(c, t("admin.roles.flash.flagNotAllowed", { type: type.name }));

  const id = crypto.randomUUID();
  await db.insert(memberRoles).values({
    id,
    title,
    typeId,
    sortOrder: await nextRoleSortOrder(typeId),
    grantsActiveStatus,
    isProtected: false,
  });

  setFlash(c, t("admin.roles.flash.created", { title }), "success");
  return c.redirect(`/roles/${id}`);
});

// POST /roles/reorder — body: id=…&id=… (all roles of ONE type, in new order)
roleRoutes.post("/roles/reorder", rolesWrite, async (c) => {
  const posted = ((await c.req.parseBody({ all: true })).id ?? []) as string | string[];
  const ids = Array.isArray(posted) ? posted : [posted];
  const [first] = ids.length ? await db.select().from(memberRoles).where(eq(memberRoles.id, ids[0])) : [];
  if (!first) return c.body(null, HTTP_STATUS.BAD_REQUEST);
  const current = await db.select().from(memberRoles).where(eq(memberRoles.typeId, first.typeId)).orderBy(asc(memberRoles.sortOrder));
  if (!isPermutation(ids, current.map((r) => r.id))) return c.body(null, HTTP_STATUS.BAD_REQUEST);
  await writeOrder(memberRoles, ids);
  return c.body(null, 204);
});

// POST /roles/:id/move — dir=up|down within the role's type
roleRoutes.post("/roles/:id/move", rolesWrite, async (c) => {
  const id = c.req.param("id");
  const dir = (await c.req.parseBody()).dir === "up" ? "up" : "down";
  const [role] = await db.select().from(memberRoles).where(eq(memberRoles.id, id));
  if (!role) return c.redirect(ROLES_URL);
  const current = await db.select().from(memberRoles).where(eq(memberRoles.typeId, role.typeId)).orderBy(asc(memberRoles.sortOrder));
  await writeOrder(memberRoles, moveId(current.map((r) => r.id), id, dir));
  return c.redirect(ROLES_URL);
});

// POST /roles/:id/active — toggle the active-status flag from the list
roleRoutes.post("/roles/:id/active", rolesWrite, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.parseBody();
  const back = body.active === "1" || body.active === "0" ? `${ROLES_URL}&active=${body.active}` : ROLES_URL;
  const [role] = await db.select().from(memberRoles).where(eq(memberRoles.id, id));
  if (!role || role.isProtected) return c.html("", HTTP_STATUS.NOT_FOUND);
  const [type] = await db.select().from(memberRoleTypes).where(eq(memberRoleTypes.id, role.typeId));
  const grantsActiveStatus = body.grantsActiveStatus === "1";
  if (!type || !flagAllowed(grantsActiveStatus, type)) {
    return badRequest(c, t("admin.roles.flash.flagNotAllowed", { type: type?.name ?? "" }));
  }
  await db.update(memberRoles).set({ grantsActiveStatus }).where(eq(memberRoles.id, id));
  return c.redirect(back);
});

// POST /roles/:id — update
roleRoutes.post("/roles/:id", rolesWrite, async (c) => {
  const id = c.req.param("id");
  const [role] = await db.select().from(memberRoles).where(eq(memberRoles.id, id));
  if (!role || role.isProtected) return c.html("", HTTP_STATUS.NOT_FOUND);

  const body = await c.req.parseBody();
  const grantsActiveStatus = body.grantsActiveStatus === "1";
  const typeId = String(body.typeId ?? role.typeId);

  const [type] = await db.select().from(memberRoleTypes).where(eq(memberRoleTypes.id, typeId));
  if (!type) return badRequest(c, t("admin.roles.flash.unknownType"));
  // Type and flag are validated together: the final state counts.
  if (!flagAllowed(grantsActiveStatus, type)) return badRequest(c, t("admin.roles.flash.flagNotAllowed", { type: type.name }));

  const [{ cnt }] = await db
    .select({ cnt: count() })
    .from(memberRoleAssignments)
    .where(eq(memberRoleAssignments.memberRoleId, id));

  const changes: Partial<typeof memberRoles.$inferInsert> = { grantsActiveStatus, typeId };
  if (typeId !== role.typeId) changes.sortOrder = await nextRoleSortOrder(typeId);
  if (cnt === 0) {
    const title = String(body.title ?? "").trim();
    if (!title) {
      setFlash(c, t("admin.roles.flash.requiredTitle"), "error");
      return c.redirect(ROLES_URL);
    }
    changes.title = title;
  }
  await db.update(memberRoles).set(changes).where(eq(memberRoles.id, id));

  setFlash(c, t("admin.roles.flash.saved"), "success");
  return c.redirect(`/roles/${id}`);
});

// POST /roles/:id/delete
roleRoutes.post("/roles/:id/delete", rolesDelete, async (c) => {
  const id = c.req.param("id");
  const [role] = await db.select().from(memberRoles).where(eq(memberRoles.id, id));
  if (!role) return c.redirect(ROLES_URL);

  if (role.isProtected) {
    setFlash(c, t("admin.roles.flash.protected"), "error");
    return c.redirect(ROLES_URL);
  }

  const [{ cnt }] = await db
    .select({ cnt: count() })
    .from(memberRoleAssignments)
    .where(eq(memberRoleAssignments.memberRoleId, id));

  if (cnt > 0) {
    setFlash(c, t("admin.roles.flash.hasAssignments"), "error");
    return c.redirect(ROLES_URL);
  }

  await db.delete(memberRoles).where(eq(memberRoles.id, id));
  setFlash(c, t("admin.roles.flash.deleted", { title: role.title }), "success");
  return c.redirect(ROLES_URL);
});

// ── /role-types ─────────────────────────────────────────────────────────
function RoleTypeForm({ type, locked = 0 }: { type?: typeof memberRoleTypes.$inferSelect; locked?: number }) {
  return (
    <>
      <Field label={t("admin.roleTypes.table.name")} required>
        <input type="text" name="name" value={type?.name ?? ""} placeholder={t("admin.roleTypes.table.name")} class="input w-full" required />
      </Field>
      <Field label={t("admin.roleTypes.table.description")}>
        <textarea name="description" rows={2} maxlength={300} placeholder={t("admin.roleTypes.table.description")} class="textarea w-full">{type?.description ?? ""}</textarea>
      </Field>
      <label class={`label justify-start gap-3 ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}>
        {/* Disabled inputs are not submitted; the hidden field keeps the value. */}
        {locked > 0 && <input type="hidden" name="allowsActiveStatus" value="1" />}
        <input type="checkbox" name="allowsActiveStatus" value="1" class="toggle border-2 border-base-content/50 text-base-content/60 hover:border-base-content checked:border-success checked:bg-success checked:text-success-content disabled:opacity-40" disabled={locked > 0} aria-describedby={locked ? "allows-active-hint" : undefined} {...(type?.allowsActiveStatus ? { checked: true } : {})} />
        <span class="text-sm">{t("admin.roleTypes.table.allowsActiveLong")}</span>
      </label>
      {locked > 0 && <p id="allows-active-hint" class="text-xs opacity-70 -mt-2">{t("admin.roleTypes.lockedHint", { count: locked })}</p>}
    </>
  );
}

roleRoutes.get("/role-types/new", typesWrite, (c) =>
  c.html(
    <>
      <h3 class="font-bold text-lg mb-4">{t("admin.roleTypes.new")}</h3>
      <form method="post" action="/role-types" class="flex flex-col gap-3">
        <RoleTypeForm />
        <ModalActions submit={t("common.create")} />
      </form>
      {SHOW_MODAL}
    </>
  ));

roleRoutes.get("/role-types/:id/edit", typesRead, async (c) => {
  const id = c.req.param("id");
  const [type] = await db.select().from(memberRoleTypes).where(eq(memberRoleTypes.id, id));
  if (!type) return c.notFound();
  if (!c.get("user").permissions.has("member-role-types:write")) return c.redirect(ROLES_URL);
  const [{ n: locked }] = await db.select({ n: count() }).from(memberRoles).where(and(eq(memberRoles.typeId, id), eq(memberRoles.grantsActiveStatus, true)));
  return c.html(
    <Layout title={t("admin.roleTypes.edit")} user={c.get("user")}>
      <div class="max-w-2xl mx-auto">
      <PageHeader title={t("admin.roleTypes.edit")} backHref={ROLES_URL} actions={<FormActions formId="role-type-form" cancelHref={ROLES_URL} />} />
      <form id="role-type-form" method="post" action={`/role-types/${id}`} class="flex flex-col gap-3">
        <RoleTypeForm type={type} locked={type.allowsActiveStatus ? locked : 0} />
      </form>
      </div>
    </Layout>
  );
});

roleRoutes.post("/role-types", typesWrite, async (c) => {
  const body = await c.req.parseBody();
  const name = String(body.name ?? "").trim();
  if (!name) {
    setFlash(c, t("admin.roleTypes.flash.requiredName"), "error");
    return c.redirect(ROLES_URL);
  }
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${memberRoleTypes.sortOrder}), 0)` }).from(memberRoleTypes);
  const id = crypto.randomUUID();
  await db.insert(memberRoleTypes).values({
    id,
    name,
    description: String(body.description ?? "").trim().slice(0, 300) || null,
    allowsActiveStatus: body.allowsActiveStatus === "1",
    sortOrder: Number(max) + 1,
    isProtected: false,
  });
  setFlash(c, t("admin.roleTypes.flash.created", { name }), "success");
  return c.redirect(ROLES_URL);
});

// Titles of flagged roles that forbid removing allows_active_status (empty = allowed).
async function flaggedRolesBlocking(type: typeof memberRoleTypes.$inferSelect, next: boolean): Promise<string[]> {
  if (!type.allowsActiveStatus || next) return [];
  const flagged = await db
    .select({ title: memberRoles.title })
    .from(memberRoles)
    .where(and(eq(memberRoles.typeId, type.id), eq(memberRoles.grantsActiveStatus, true)));
  return flagged.map((r) => r.title);
}

roleRoutes.post("/role-types/:id/allows-active", typesWrite, async (c) => {
  const id = c.req.param("id");
  const [type] = await db.select().from(memberRoleTypes).where(eq(memberRoleTypes.id, id));
  if (!type) return c.html("", HTTP_STATUS.NOT_FOUND);
  const allowsActiveStatus = (await c.req.parseBody()).allowsActiveStatus === "1";
  const blocked = await flaggedRolesBlocking(type, allowsActiveStatus);
  if (blocked.length > 0) return badRequest(c, t("admin.roleTypes.flash.flaggedRoles"), blocked, t("admin.roleTypes.flash.flaggedRolesTitle"));
  await db.update(memberRoleTypes).set({ allowsActiveStatus }).where(eq(memberRoleTypes.id, id));
  return c.redirect(ROLES_URL);
});

roleRoutes.post("/role-types/:id", typesWrite, async (c) => {
  const id = c.req.param("id");
  const [type] = await db.select().from(memberRoleTypes).where(eq(memberRoleTypes.id, id));
  if (!type) return c.html("", HTTP_STATUS.NOT_FOUND);
  const body = await c.req.parseBody();
  const name = String(body.name ?? "").trim();
  const allowsActiveStatus = body.allowsActiveStatus === "1";
  if (!name) {
    setFlash(c, t("admin.roleTypes.flash.requiredName"), "error");
    return c.redirect(ROLES_URL);
  }
  const blocked = await flaggedRolesBlocking(type, allowsActiveStatus);
  if (blocked.length > 0) return badRequest(c, t("admin.roleTypes.flash.flaggedRoles"), blocked, t("admin.roleTypes.flash.flaggedRolesTitle"));
  await db.update(memberRoleTypes).set({ name, allowsActiveStatus, description: String(body.description ?? "").trim().slice(0, 300) || null }).where(eq(memberRoleTypes.id, id));
  setFlash(c, t("admin.roles.flash.saved"), "success");
  return c.redirect(ROLES_URL);
});

roleRoutes.post("/role-types/:id/delete", typesDelete, async (c) => {
  const id = c.req.param("id");
  const [type] = await db.select().from(memberRoleTypes).where(eq(memberRoleTypes.id, id));
  if (!type) return c.redirect(ROLES_URL);
  if (type.isProtected) return badRequest(c, t("admin.roleTypes.cannotDelete.protected"));
  const assigned = await db.select({ title: memberRoles.title }).from(memberRoles).where(eq(memberRoles.typeId, id));
  if (assigned.length > 0) return badRequest(c, t("admin.roleTypes.flash.notEmpty"), assigned.map((r) => r.title), t("admin.roleTypes.flash.notEmptyTitle"));
  await db.delete(memberRoleTypes).where(eq(memberRoleTypes.id, id));
  setFlash(c, t("admin.roleTypes.flash.deleted", { name: type.name }), "success");
  return c.redirect(ROLES_URL);
});

