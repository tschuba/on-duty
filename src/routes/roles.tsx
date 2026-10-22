import { Hono, type Context } from "hono";
import { eq, and, count, countDistinct, asc, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { memberRoles, memberRoleTypes, memberRoleAssignments } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { ClickToEditHint, Layout, MemberTabs } from "../components/layout.js";
import { FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { ModalScaffold } from "./admin.js";
import { flagAllowed, isPermutation, moveId } from "../lib/role-types.js";
import { setFlash } from "../lib/flash.js";
import { HTTP_STATUS } from "../lib/constants.js";
import { t } from "../i18n/index.js";

export const roleRoutes = new Hono<{ Variables: Variables }>();
const rolesRead = requireAuth("member-roles:read");
const rolesWrite = requireAuth("member-roles:write");
const rolesDelete = requireAuth("member-roles:delete");
const typesRead = requireAuth("member-role-types:read");
const typesWrite = requireAuth("member-role-types:write");
const typesDelete = requireAuth("member-role-types:delete");

function badRequest(c: any, message: string, detail?: string[]) {
  return c.html(
    <Layout title={t("admin.roles.title")} user={c.get("user")} activeNav="members">
      <div class="alert alert-error max-w-2xl mx-auto mb-4" role="alert">
        <div>
          <p>{message}</p>
          {detail && detail.length > 0 && <ul class="list-disc ml-5">{detail.map((d) => <li>{d}</li>)}</ul>}
        </div>
      </div>
      <div class="max-w-2xl mx-auto"><a class="btn" href="/roles">{t("common.close")}</a></div>
    </Layout>,
    HTTP_STATUS.BAD_REQUEST,
  );
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
      <button name="dir" value="up" class="btn btn-ghost btn-xs join-item" disabled={disabled} aria-label={t("admin.roles.moveUp")} title={t("admin.roles.moveUp")}>↑</button>
      <button name="dir" value="down" class="btn btn-ghost btn-xs join-item" disabled={disabled} aria-label={t("admin.roles.moveDown")} title={t("admin.roles.moveDown")}>↓</button>
    </form>
  );
}

function DeleteDialog({ id, action, title, body }: { id: string; action: string; title: string; body: string }) {
  return (
    <>
      <button
        class="btn btn-outline btn-error btn-xs"
        onclick={`event.stopPropagation(); document.getElementById('delete-${id}').showModal()`}
      >
        {t("common.delete")}
      </button>
      <dialog id={`delete-${id}`} class="modal">
        <div class="modal-box">
          <h3 class="font-bold text-lg">{title}</h3>
          <p class="py-2 opacity-70">{body}</p>
          <div class="modal-action">
            <form method="dialog">
              <button class="btn">{t("common.cancel")}</button>
            </form>
            <form method="post" action={action}>
              <button type="submit" class="btn btn-error">{t("common.delete")}</button>
            </form>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>{t("common.close")}</button>
        </form>
      </dialog>
    </>
  );
}

const rolesPage = (tab: "roles" | "types") => async (c: Context<{ Variables: Variables }>) => {
  const user = c.get("user");
  const activeFilter = c.req.query("active"); // "1" | "0" | undefined

  const [types, rolesWithCount] = await Promise.all([
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
  const typeCounts = new Map<string, number>();
  const allRoleRows = await db.select({ typeId: memberRoles.typeId }).from(memberRoles);
  for (const r of allRoleRows) typeCounts.set(r.typeId, (typeCounts.get(r.typeId) ?? 0) + 1);
  const canWrite = user.permissions.has("member-roles:write");
  const canDeletePerm = user.permissions.has("member-roles:delete");
  const canWriteTypes = user.permissions.has("member-role-types:write");
  const canDeleteTypes = user.permissions.has("member-role-types:delete");
  const canReorder = canWrite && !activeFilter;

  return c.html(
    <Layout title={t("admin.roles.title")} user={user} activeNav="members">
      <MemberTabs active={tab === "types" ? "roleTypes" : "roles"} user={user} />

      <div class="max-w-4xl mx-auto">
      {tab === "roles" && (<>
      <PageHeader title={t("admin.roles.title")} actions={canWrite && <HeaderAction variant="primary" icon="plus" label={t("admin.roles.newRole")} class="btn-primary" attrs={{ "hx-get": "/roles/new", "hx-target": "#modal-content", "hx-swap": "innerHTML" }} />} />
      <div class="filter-bar mb-4"><div class="join">
            <a href="/roles" class={`btn join-item${!activeFilter ? " btn-primary btn-outline" : " btn-ghost"}`}>{t("admin.roles.filterAll")}</a>
            <a href="/roles?active=1" class={`btn join-item${activeFilter === "1" ? " btn-primary btn-outline" : " btn-ghost"}`}>{t("admin.roles.filterActive")}</a>
            <a href="/roles?active=0" class={`btn join-item${activeFilter === "0" ? " btn-primary btn-outline" : " btn-ghost"}`}>{t("admin.roles.filterPassive")}</a>
          </div></div>

      {canWrite && <ClickToEditHint />}
      {types.map((ty) => {
        const typeRoles = rolesWithCount.filter((r) => r.typeId === ty.id);
        return (
          <details key={ty.id} data-section={ty.id} open class="collapse collapse-arrow border border-base-300 bg-base-100 mb-3">
            <summary class="collapse-title bg-base-300">
              <div class="text-lg font-bold flex items-center gap-2" style="font-family: var(--font-heading)">
                {ty.name} <span class="badge badge-ghost badge-sm">{typeRoles.length}</span>
              </div>
              {ty.description && <div class="text-sm font-normal opacity-70">{ty.description}</div>}
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
                    {...((canWrite || r.isProtected) && {
                      class: "cursor-pointer hover",
                      "hx-get": `/roles/${r.id}/edit`,
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
                            onchange="this.form.submit()"
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
          </details>
        );
      })}

      </>)}

      {tab === "types" && (<>
      <PageHeader title={t("admin.roleTypes.title")} actions={canWriteTypes && <HeaderAction variant="primary" icon="plus" label={t("admin.roleTypes.new")} class="btn-primary" attrs={{ "hx-get": "/role-types/new", "hx-target": "#modal-content", "hx-swap": "innerHTML" }} />} />
      <div class="overflow-x-auto mb-10">
        <table class="table table-zebra w-full">
          <thead>
            <tr>
              <th>{t("admin.roleTypes.table.name")}</th>
              <th>{t("admin.roleTypes.table.allowsActive")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {types.map((ty) => {
              const n = typeCounts.get(ty.id) ?? 0;
              return (
                <tr
                  key={ty.id}
                  data-id={ty.id}
                  {...(canWriteTypes && {
                    class: "cursor-pointer hover",
                    "hx-get": `/role-types/${ty.id}/edit`,
                    "hx-target": "#modal-content",
                    "hx-swap": "innerHTML",
                  })}
                >
                  <td class="font-medium">{ty.isProtected && <span class="mr-1" title={t("admin.roles.systemRole")}>🔒</span>}{ty.name}</td>
                  <td>
                    <form method="post" action={`/role-types/${ty.id}/allows-active`} onclick="event.stopPropagation()">
                      <label class="flex items-center gap-3 cursor-pointer w-fit">
                        <input type="checkbox" name="allowsActiveStatus" value="1" class="toggle border-2 border-base-content/50 text-base-content/60 hover:border-base-content checked:border-success checked:bg-success checked:text-success-content disabled:opacity-40" checked={ty.allowsActiveStatus} disabled={!canWriteTypes} onchange="this.form.submit()" aria-label={t("admin.roleTypes.table.allowsActive")} />
                      </label>
                    </form>
                  </td>
                  <td>
                    <div class="flex gap-2 justify-end items-center">
                      {canDeleteTypes && !ty.isProtected && n === 0 ? (
                        <DeleteDialog
                          id={`type-${ty.id}`}
                          action={`/role-types/${ty.id}/delete`}
                          title={t("admin.roleTypes.confirmDelete.title")}
                          body={t("admin.roleTypes.confirmDelete.body", { name: ty.name })}
                        />
                      ) : canDeleteTypes && (
                        <button
                          class="btn btn-ghost btn-xs text-base-content/30"
                          disabled
                          title={ty.isProtected ? t("admin.roleTypes.cannotDelete.protected") : t("admin.roleTypes.cannotDelete.notEmpty", { count: n })}
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
      </>)}
      </div>

      <ModalScaffold />
      <script dangerouslySetInnerHTML={{ __html: REORDER_SCRIPT }} />
    </Layout>
  );
};
roleRoutes.get("/roles", rolesRead, rolesPage("roles"));
roleRoutes.get("/role-types", typesRead, rolesPage("types"));

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
      <div class="grid grid-cols-[8rem_1fr] items-baseline gap-x-3">
        <span class="label-text text-right pt-2">{t("admin.roles.modal.nameLabel")} <span class="text-error">*</span></span>
        {hasAssignments && role ? (
          <div class="flex flex-col gap-1">
            <input type="text" value={role.title} class="input input-bordered w-full opacity-50" disabled />
            <span class="label-text-alt text-sm opacity-60">{t("admin.roles.modal.nameLocked")}</span>
            <input type="hidden" name="title" value={role.title} />
          </div>
        ) : (
          <input type="text" name="title" value={role?.title ?? ""} class="input input-bordered w-full" required />
        )}
      </div>
      <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
        <span class="label-text text-right">{t("admin.roles.type.label")}</span>
        <select name="typeId" id="role-type-select" class="select select-bordered w-full" data-allows={typesJson}>
          {types.map((ty) => <option value={ty.id} selected={ty.id === typeId}>{ty.name}</option>)}
        </select>
      </div>
      <label class="label cursor-pointer justify-start gap-3">
        <input id="role-grants-active" type="checkbox" name="grantsActiveStatus" value="1" class="toggle border-2 border-base-content/50 text-base-content/60 hover:border-base-content checked:border-success checked:bg-success checked:text-success-content disabled:opacity-40" {...(role?.grantsActiveStatus ? { checked: true } : {})} />
        <span class="label-text">{t("admin.roles.modal.grantsActive")}</span>
      </label>
      <span id="role-grants-hint" class="label-text-alt text-sm opacity-60 hidden">{t("admin.roles.type.flagNotAllowed")}</span>
      {role && (affected ?? 0) > 0 && (
        <span class="label-text-alt text-sm opacity-60">{t("admin.roles.modal.affected", { count: affected ?? 0 })}</span>
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

// HTMX fragment: edit role modal
// Read access shows the form; it is editable only with write permission on an unprotected role.
roleRoutes.get("/roles/:id/edit", rolesRead, async (c) => {
  const id = c.req.param("id");
  const [role] = await db.select().from(memberRoles).where(eq(memberRoles.id, id));
  if (!role) return c.html("", HTTP_STATUS.NOT_FOUND);
  const readOnly = role.isProtected || !c.get("user").permissions.has("member-roles:write");

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
    <>
      <h3 class="font-bold text-lg mb-4">{t("admin.roles.modal.edit")}</h3>
      {role.isProtected && <div class="alert alert-info mb-3">🔒 {t("admin.roles.systemRole")} – {t("admin.permissions.readOnlyHint")}</div>}
      <form method="post" action={`/roles/${id}`} class="flex flex-col gap-3">
        <fieldset disabled={readOnly} class="contents">
          <RoleForm types={types} role={role} hasAssignments={cnt > 0} affected={Number(affected)} />
        </fieldset>
        {readOnly ? (
          <div class="modal-action mt-2">
            <button type="button" class="btn" onclick="document.getElementById('admin-modal').close()">{t("common.close")}</button>
          </div>
        ) : (
          <ModalActions submit={t("common.save")} />
        )}
      </form>
      {SHOW_MODAL}
    </>
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
    return c.redirect("/roles");
  }
  const [type] = await db.select().from(memberRoleTypes).where(eq(memberRoleTypes.id, typeId));
  if (!type) return badRequest(c, t("admin.roles.flash.unknownType"));
  if (!flagAllowed(grantsActiveStatus, type)) return badRequest(c, t("admin.roles.flash.flagNotAllowed", { type: type.name }));

  await db.insert(memberRoles).values({
    id: crypto.randomUUID(),
    title,
    typeId,
    sortOrder: await nextRoleSortOrder(typeId),
    grantsActiveStatus,
    isProtected: false,
  });

  setFlash(c, t("admin.roles.flash.created", { title }), "success");
  return c.redirect("/roles");
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
  if (!role) return c.redirect("/roles");
  const current = await db.select().from(memberRoles).where(eq(memberRoles.typeId, role.typeId)).orderBy(asc(memberRoles.sortOrder));
  await writeOrder(memberRoles, moveId(current.map((r) => r.id), id, dir));
  return c.redirect("/roles");
});

// POST /roles/:id/active — toggle the active-status flag from the list
roleRoutes.post("/roles/:id/active", rolesWrite, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.parseBody();
  const back = body.active === "1" || body.active === "0" ? `/roles?active=${body.active}` : "/roles";
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
      return c.redirect("/roles");
    }
    changes.title = title;
  }
  await db.update(memberRoles).set(changes).where(eq(memberRoles.id, id));

  setFlash(c, t("admin.roles.flash.saved"), "success");
  return c.redirect("/roles");
});

// POST /roles/:id/delete
roleRoutes.post("/roles/:id/delete", rolesDelete, async (c) => {
  const id = c.req.param("id");
  const [role] = await db.select().from(memberRoles).where(eq(memberRoles.id, id));
  if (!role) return c.redirect("/roles");

  if (role.isProtected) {
    setFlash(c, t("admin.roles.flash.protected"), "error");
    return c.redirect("/roles");
  }

  const [{ cnt }] = await db
    .select({ cnt: count() })
    .from(memberRoleAssignments)
    .where(eq(memberRoleAssignments.memberRoleId, id));

  if (cnt > 0) {
    setFlash(c, t("admin.roles.flash.hasAssignments"), "error");
    return c.redirect("/roles");
  }

  await db.delete(memberRoles).where(eq(memberRoles.id, id));
  setFlash(c, t("admin.roles.flash.deleted", { title: role.title }), "success");
  return c.redirect("/roles");
});

// ── /role-types ─────────────────────────────────────────────────────────
function RoleTypeForm({ type }: { type?: typeof memberRoleTypes.$inferSelect }) {
  return (
    <>
      <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
        <span class="label-text text-right">{t("admin.roleTypes.table.name")} <span class="text-error">*</span></span>
        <input type="text" name="name" value={type?.name ?? ""} class="input input-bordered w-full" required />
      </div>
      <div class="grid grid-cols-[8rem_1fr] items-start gap-x-3">
        <span class="label-text text-right pt-2">{t("admin.roleTypes.table.description")}</span>
        <textarea name="description" rows={2} maxlength={300} class="textarea textarea-bordered w-full">{type?.description ?? ""}</textarea>
      </div>
      <label class="label cursor-pointer justify-start gap-3">
        <input type="checkbox" name="allowsActiveStatus" value="1" class="toggle border-2 border-base-content/50 text-base-content/60 hover:border-base-content checked:border-success checked:bg-success checked:text-success-content disabled:opacity-40" {...(type?.allowsActiveStatus ? { checked: true } : {})} />
        <span class="label-text">{t("admin.roleTypes.table.allowsActive")}</span>
      </label>
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

roleRoutes.get("/role-types/:id/edit", typesWrite, async (c) => {
  const id = c.req.param("id");
  const [type] = await db.select().from(memberRoleTypes).where(eq(memberRoleTypes.id, id));
  if (!type) return c.html("", HTTP_STATUS.NOT_FOUND);
  return c.html(
    <>
      <h3 class="font-bold text-lg mb-4">{t("admin.roleTypes.edit")}</h3>
      <form method="post" action={`/role-types/${id}`} class="flex flex-col gap-3">
        <RoleTypeForm type={type} />
        <ModalActions submit={t("common.save")} />
      </form>
      {SHOW_MODAL}
    </>
  );
});

roleRoutes.post("/role-types", typesWrite, async (c) => {
  const body = await c.req.parseBody();
  const name = String(body.name ?? "").trim();
  if (!name) {
    setFlash(c, t("admin.roleTypes.flash.requiredName"), "error");
    return c.redirect("/role-types");
  }
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${memberRoleTypes.sortOrder}), 0)` }).from(memberRoleTypes);
  await db.insert(memberRoleTypes).values({
    id: crypto.randomUUID(),
    name,
    description: String(body.description ?? "").trim().slice(0, 300) || null,
    allowsActiveStatus: body.allowsActiveStatus === "1",
    sortOrder: Number(max) + 1,
    isProtected: false,
  });
  setFlash(c, t("admin.roleTypes.flash.created", { name }), "success");
  return c.redirect("/role-types");
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
  if (blocked.length > 0) return badRequest(c, t("admin.roleTypes.flash.flaggedRoles"), blocked);
  await db.update(memberRoleTypes).set({ allowsActiveStatus }).where(eq(memberRoleTypes.id, id));
  return c.redirect("/role-types");
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
    return c.redirect("/role-types");
  }
  const blocked = await flaggedRolesBlocking(type, allowsActiveStatus);
  if (blocked.length > 0) return badRequest(c, t("admin.roleTypes.flash.flaggedRoles"), blocked);
  await db.update(memberRoleTypes).set({ name, allowsActiveStatus, description: String(body.description ?? "").trim().slice(0, 300) || null }).where(eq(memberRoleTypes.id, id));
  setFlash(c, t("admin.roles.flash.saved"), "success");
  return c.redirect("/role-types");
});

roleRoutes.post("/role-types/:id/delete", typesDelete, async (c) => {
  const id = c.req.param("id");
  const [type] = await db.select().from(memberRoleTypes).where(eq(memberRoleTypes.id, id));
  if (!type) return c.redirect("/role-types");
  if (type.isProtected) return badRequest(c, t("admin.roleTypes.cannotDelete.protected"));
  const assigned = await db.select({ title: memberRoles.title }).from(memberRoles).where(eq(memberRoles.typeId, id));
  if (assigned.length > 0) return badRequest(c, t("admin.roleTypes.flash.notEmpty"), assigned.map((r) => r.title));
  await db.delete(memberRoleTypes).where(eq(memberRoleTypes.id, id));
  setFlash(c, t("admin.roleTypes.flash.deleted", { name: type.name }), "success");
  return c.redirect("/role-types");
});

