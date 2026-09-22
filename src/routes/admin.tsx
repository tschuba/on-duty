import { Hono } from "hono";
import { eq, and, count, asc, desc } from "drizzle-orm";
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
} from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { env, ENV_META } from "../env.js";
import { getCronScheduleTimes, getLastBackup, isBackupConfigured, runBackup } from "../lib/backup.js";

export const adminRoutes = new Hono<{ Variables: Variables }>();
const guard = requireAuth("admin");

function setFlash(c: any, msg: string, type: "success" | "error") {
  setCookie(c, "flash", JSON.stringify({ message: msg, type }), {
    path: "/",
    maxAge: 10,
    httpOnly: false,
  });
}

function AdminTabs({ active }: { active: "users" | "roles" | "anniversaries" | "config" | "backup" }) {
  return (
    <div role="tablist" class="tabs tabs-lifted mb-6">
      <a href="/admin/users" role="tab" class={`tab${active === "users" ? " tab-active" : ""}`}>
        Benutzer
      </a>
      <a href="/admin/roles" role="tab" class={`tab${active === "roles" ? " tab-active" : ""}`}>
        Funktionen
      </a>
      <a href="/admin/anniversaries" role="tab" class={`tab${active === "anniversaries" ? " tab-active" : ""}`}>
        Jubiläen
      </a>
      <a href="/admin/config" role="tab" class={`tab${active === "config" ? " tab-active" : ""}`}>
        Konfiguration
      </a>
      <a href="/admin/backup" role="tab" class={`tab${active === "backup" ? " tab-active" : ""}`}>
        Backup
      </a>
    </div>
  );
}

function BackupWarnBanner({ configured, lastFailed }: { configured: boolean; lastFailed: boolean }) {
  if (configured && !lastFailed) return null;
  if (!configured) {
    return (
      <div class="alert alert-warning mb-4">
        <span>Kein Backup konfiguriert. Lege ein Backup-Ziel fest (Env-Vars <code>BACKUP_LOCAL_PATH</code> oder <code>S3_*</code>).</span>
      </div>
    );
  }
  return (
    <div class="alert alert-error mb-4">
      <span>
        Letztes Backup fehlgeschlagen.{" "}
        <a href="/admin/backup" class="link">Details ansehen →</a>
      </span>
    </div>
  );
}

async function backupWarnProps() {
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
        <button>Schließen</button>
      </form>
    </dialog>
  );
}

function RoleBadge({ role }: { role: string }) {
  const cls =
    role === "admin" ? "badge-error" : role === "editor" ? "badge-warning" : "badge-ghost";
  const label =
    role === "admin" ? "Admin" : role === "editor" ? "Bearbeiter" : "Lesend";
  return <span class={`badge badge-sm ${cls}`}>{label}</span>;
}

function ClickToEditHint() {
  return <p class="text-sm opacity-50 mb-2">Zeile anklicken zum Bearbeiten</p>;
}

// ── /admin → /admin/users ─────────────────────────────────────────────────────
adminRoutes.get("/", guard, (c) => c.redirect("/admin/users"));

// ── /admin/users ──────────────────────────────────────────────────────────────
adminRoutes.get("/users", guard, async (c) => {
  const user = c.get("user");
  const [allUsers, warn] = await Promise.all([
    db.select().from(users).orderBy(asc(users.name)),
    backupWarnProps(),
  ]);

  return c.html(
    <Layout title="Benutzer" user={user} activeNav="admin">
      <BackupWarnBanner {...warn} />
      <AdminTabs active="users" />
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">
          Benutzer
        </h1>
        <button
          class="btn btn-primary btn-sm"
          hx-get="/admin/users/new"
          hx-target="#modal-content"
          hx-swap="innerHTML"
        >
          + Neuer Benutzer
        </button>
      </div>

      <ClickToEditHint />
      <div class="overflow-x-auto">
        <table class="table table-zebra w-full">
          <thead>
            <tr>
              <th>Name</th>
              <th>E-Mail</th>
              <th>Benutzerrolle</th>
              <th>Status</th>
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
                    <RoleBadge role={u.appRole} />
                  </td>
                  <td>
                    {u.disabled ? (
                      <span class="badge badge-error badge-sm">Deaktiviert</span>
                    ) : (
                      <span class="badge badge-success badge-sm">Aktiv</span>
                    )}
                  </td>
                  <td>
                    {isLocal ? (
                      <span class="badge badge-neutral badge-sm">Lokaler Admin-Account</span>
                    ) : (
                      <div class="flex gap-2 justify-end">
                        {u.disabled ? (
                          <form method="post" action={`/admin/users/${u.id}/activate`}>
                            <button
                              type="submit"
                              class="btn btn-ghost btn-xs text-success"
                              onclick="event.stopPropagation()"
                            >
                              Aktivieren
                            </button>
                          </form>
                        ) : (
                          <>
                            <button
                              class="btn btn-ghost btn-xs text-error"
                              onclick={`event.stopPropagation(); document.getElementById('deactivate-${u.id}').showModal()`}
                            >
                              Deaktivieren
                            </button>
                            <dialog id={`deactivate-${u.id}`} class="modal" onclick="event.stopPropagation()">
                              <div class="modal-box">
                                <h3 class="font-bold text-lg">Benutzer deaktivieren?</h3>
                                <p class="py-2 opacity-70">
                                  <strong>{u.name}</strong> wird deaktiviert. Aktive Sitzungen
                                  werden sofort beendet.
                                </p>
                                <div class="modal-action">
                                  <form method="dialog">
                                    <button class="btn">Abbrechen</button>
                                  </form>
                                  <form method="post" action={`/admin/users/${u.id}/deactivate`}>
                                    <button type="submit" class="btn btn-error">
                                      Deaktivieren
                                    </button>
                                  </form>
                                </div>
                              </div>
                              <form method="dialog" class="modal-backdrop">
                                <button>Schließen</button>
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

// HTMX fragment: create user modal
adminRoutes.get("/users/new", guard, (c) => {
  return c.html(
    <>
      <h3 class="font-bold text-lg mb-4">Neuer Benutzer</h3>
      <form method="post" action="/admin/users" class="flex flex-col gap-3">
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">Name <span class="text-error">*</span></span>
          <input type="text" name="name" class="input input-bordered w-full" required />
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">E-Mail <span class="text-error">*</span></span>
          <input type="email" name="email" class="input input-bordered w-full" required />
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-start gap-x-3">
          <span class="label-text text-right pt-3">Benutzerrolle</span>
          <div class="flex flex-col gap-2">
            {([
              { value: "read", label: "Lesend", desc: "Kann Mitglieder und Jubiläen einsehen" },
              { value: "editor", label: "Bearbeiter", desc: "Kann Mitglieder anlegen, bearbeiten und exportieren" },
              { value: "admin", label: "Administrator", desc: "Vollzugriff inkl. Benutzerverwaltung und Systemkonfiguration" },
            ] as { value: string; label: string; desc: string }[]).map(({ value, label, desc }) => (
              <label key={value} class="flex items-center gap-3 border border-base-300 rounded-lg px-3 py-2 cursor-pointer has-[:checked]:border-primary">
                <input type="radio" name="appRole" value={value} class="radio radio-sm" checked={value === "read"} />
                <div>
                  <div class="font-medium text-sm">{label}</div>
                  <div class="text-xs opacity-60">{desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
        <div class="modal-action mt-2">
          <button
            type="button"
            class="btn btn-ghost"
            onclick="document.getElementById('admin-modal').close()"
          >
            Abbrechen
          </button>
          <button type="submit" class="btn btn-primary">
            Anlegen
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

  return c.html(
    <>
      <h3 class="font-bold text-lg mb-4">Benutzer bearbeiten</h3>
      <form method="post" action={`/admin/users/${id}`} class="flex flex-col gap-3">
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">Name <span class="text-error">*</span></span>
          <input type="text" name="name" value={u.name} class="input input-bordered w-full" required />
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-baseline gap-x-3">
          <span class="label-text text-right pt-2">E-Mail <span class="text-error">*</span></span>
          <div class="flex flex-col gap-1">
            <input type="email" name="email" value={u.email} class="input input-bordered w-full" required />
            <span class="label-text-alt opacity-60">
              Achtung: E-Mail muss mit der OIDC-Adresse übereinstimmen. Bei Änderung wird die
              OIDC-Verknüpfung entfernt.
            </span>
          </div>
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-start gap-x-3">
          <span class="label-text text-right pt-3">Benutzerrolle</span>
          <div class="flex flex-col gap-2">
            {([
              { value: "read", label: "Lesend", desc: "Kann Mitglieder und Jubiläen einsehen" },
              { value: "editor", label: "Bearbeiter", desc: "Kann Mitglieder anlegen, bearbeiten und exportieren" },
              { value: "admin", label: "Administrator", desc: "Vollzugriff inkl. Benutzerverwaltung und Systemkonfiguration" },
            ] as { value: string; label: string; desc: string }[]).map(({ value, label, desc }) => (
              <label key={value} class="flex items-center gap-3 border border-base-300 rounded-lg px-3 py-2 cursor-pointer has-[:checked]:border-primary">
                <input type="radio" name="appRole" value={value} class="radio radio-sm" checked={u.appRole === value} />
                <div>
                  <div class="font-medium text-sm">{label}</div>
                  <div class="text-xs opacity-60">{desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
        <div class="modal-action mt-2">
          <button
            type="button"
            class="btn btn-ghost"
            onclick="document.getElementById('admin-modal').close()"
          >
            Abbrechen
          </button>
          <button type="submit" class="btn btn-primary">
            Speichern
          </button>
        </div>
      </form>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('admin-modal').showModal();" }} />
    </>
  );
});

// POST /admin/users — create
adminRoutes.post("/users", guard, async (c) => {
  const body = await c.req.parseBody();
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const appRole = String(body.appRole ?? "read");

  if (!name || !email) {
    setFlash(c, "Name und E-Mail sind Pflichtfelder.", "error");
    return c.redirect("/admin/users");
  }
  if (!["read", "editor", "admin"].includes(appRole)) {
    setFlash(c, "Ungültige Benutzerrolle.", "error");
    return c.redirect("/admin/users");
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (existing.length > 0) {
    setFlash(c, "Ein Benutzer mit dieser E-Mail-Adresse existiert bereits.", "error");
    return c.redirect("/admin/users");
  }

  const now = new Date();
  await db.insert(users).values({
    id: crypto.randomUUID(),
    name,
    email,
    emailVerified: false,
    appRole,
    disabled: false,
    createdAt: now,
    updatedAt: now,
  });

  setFlash(c, `Benutzer „${name}" angelegt.`, "success");
  return c.redirect("/admin/users");
});

// POST /admin/users/:id — update
adminRoutes.post("/users/:id", guard, async (c) => {
  const id = c.req.param("id");
  const [existing] = await db.select().from(users).where(eq(users.id, id));
  if (!existing || existing.email === "admin@localhost.invalid") return c.html("", 404);

  const body = await c.req.parseBody();
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const appRole = String(body.appRole ?? "read");

  if (!name || !email) {
    setFlash(c, "Name und E-Mail sind Pflichtfelder.", "error");
    return c.redirect("/admin/users");
  }
  if (!["read", "editor", "admin"].includes(appRole)) {
    setFlash(c, "Ungültige Benutzerrolle.", "error");
    return c.redirect("/admin/users");
  }

  if (email !== existing.email) {
    const dupe = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (dupe.length > 0) {
      setFlash(c, "Ein Benutzer mit dieser E-Mail-Adresse existiert bereits.", "error");
      return c.redirect("/admin/users");
    }
    // Remove OIDC account link so Better Auth re-links on next login
    await db
      .delete(accounts)
      .where(and(eq(accounts.userId, id), eq(accounts.providerId, "oidc")));
  }

  await db
    .update(users)
    .set({ name, email, appRole, updatedAt: new Date() })
    .where(eq(users.id, id));

  setFlash(c, "Benutzer gespeichert.", "success");
  return c.redirect("/admin/users");
});

// POST /admin/users/:id/deactivate
adminRoutes.post("/users/:id/deactivate", guard, async (c) => {
  const id = c.req.param("id");
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, id));
  if (!u || u.email === "admin@localhost.invalid") return c.html("", 404);

  await db.update(users).set({ disabled: true, updatedAt: new Date() }).where(eq(users.id, id));
  await db.delete(sessions).where(eq(sessions.userId, id));

  setFlash(c, "Benutzer deaktiviert.", "success");
  return c.redirect("/admin/users");
});

// POST /admin/users/:id/activate
adminRoutes.post("/users/:id/activate", guard, async (c) => {
  const id = c.req.param("id");
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, id));
  if (!u || u.email === "admin@localhost.invalid") return c.html("", 404);

  await db.update(users).set({ disabled: false, updatedAt: new Date() }).where(eq(users.id, id));

  setFlash(c, "Benutzer aktiviert.", "success");
  return c.redirect("/admin/users");
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
    <Layout title="Funktionen" user={user} activeNav="admin">
      <BackupWarnBanner {...warn} />
      <AdminTabs active="roles" />

      <div class="max-w-4xl mx-auto">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-4">
          <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">
            Funktionen
          </h1>
          <div class="flex gap-1">
            <a href="/admin/roles" class={`btn btn-sm${!activeFilter ? " btn-primary" : " btn-ghost"}`}>Alle</a>
            <a href="/admin/roles?active=1" class={`btn btn-sm${activeFilter === "1" ? " btn-primary" : " btn-ghost"}`}>Aktiv</a>
            <a href="/admin/roles?active=0" class={`btn btn-sm${activeFilter === "0" ? " btn-primary" : " btn-ghost"}`}>Passiv</a>
          </div>
        </div>
        <button
          class="btn btn-primary btn-sm"
          hx-get="/admin/roles/new"
          hx-target="#modal-content"
          hx-swap="innerHTML"
        >
          + Neue Funktion
        </button>
      </div>

      <ClickToEditHint />
      <div class="overflow-x-auto mb-10">
        <table class="table table-zebra w-full">
          <thead>
            <tr>
              <th>Anzeigename</th>
              <th>Aktiv-Status</th>
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
                      <span class="mr-1" title="Systemrolle">
                        🔒
                      </span>
                    )}
                    {r.title}
                  </td>
                  <td>
                    {r.grantsActiveStatus ? (
                      <span class="badge badge-success badge-sm">Aktiv</span>
                    ) : (
                      <span class="badge badge-ghost badge-sm">Passiv</span>
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
                            Löschen
                          </button>
                          <dialog id={`delete-role-${r.id}`} class="modal" onclick="event.stopPropagation()">
                            <div class="modal-box">
                              <h3 class="font-bold text-lg">Funktion löschen?</h3>
                              <p class="py-2 opacity-70">
                                <strong>{r.title}</strong> wird dauerhaft gelöscht.
                              </p>
                              <div class="modal-action">
                                <form method="dialog">
                                  <button class="btn">Abbrechen</button>
                                </form>
                                <form method="post" action={`/admin/roles/${r.id}/delete`}>
                                  <button type="submit" class="btn btn-error">
                                    Löschen
                                  </button>
                                </form>
                              </div>
                            </div>
                            <form method="dialog" class="modal-backdrop">
                              <button>Schließen</button>
                            </form>
                          </dialog>
                        </>
                      ) : (
                        <button
                          class="btn btn-ghost btn-xs text-base-content/30"
                          disabled
                          title={
                            r.isProtected
                              ? "Systemrolle, kann nicht gelöscht werden"
                              : `Wird von ${r.assignmentCount} Mitglied${r.assignmentCount === 1 ? "" : "ern"} verwendet`
                          }
                        >
                          Löschen
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
      <h3 class="font-bold text-lg mb-4">Neue Funktion</h3>
      <form method="post" action="/admin/roles" class="flex flex-col gap-3">
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">Anzeigename <span class="text-error">*</span></span>
          <input type="text" name="title" class="input input-bordered w-full" required />
        </div>
        <label class="label cursor-pointer justify-start gap-3">
          <input type="checkbox" name="grantsActiveStatus" value="1" class="checkbox" />
          <span class="label-text">Verleiht aktiven Status</span>
        </label>
        <div class="modal-action mt-2">
          <button
            type="button"
            class="btn btn-ghost"
            onclick="document.getElementById('admin-modal').close()"
          >
            Abbrechen
          </button>
          <button type="submit" class="btn btn-primary">
            Anlegen
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
      <h3 class="font-bold text-lg mb-4">Funktion bearbeiten</h3>
      <form method="post" action={`/admin/roles/${id}`} class="flex flex-col gap-3">
        <div class="grid grid-cols-[8rem_1fr] items-baseline gap-x-3">
          <span class="label-text text-right pt-2">Anzeigename <span class="text-error">*</span></span>
          {hasAssignments ? (
            <div class="flex flex-col gap-1">
              <input type="text" value={role.title} class="input input-bordered w-full opacity-50" disabled />
              <span class="label-text-alt opacity-60">
                Anzeigename kann nicht mehr geändert werden, da bereits Zuweisungen existieren.
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
          <span class="label-text">Verleiht aktiven Status</span>
        </label>
        <div class="modal-action mt-2">
          <button
            type="button"
            class="btn btn-ghost"
            onclick="document.getElementById('admin-modal').close()"
          >
            Abbrechen
          </button>
          <button type="submit" class="btn btn-primary">
            Speichern
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
    setFlash(c, "Anzeigename ist Pflichtfeld.", "error");
    return c.redirect("/admin/roles");
  }

  await db.insert(memberRoles).values({
    id: crypto.randomUUID(),
    title,
    grantsActiveStatus,
    isProtected: false,
  });

  setFlash(c, `Funktion „${title}" angelegt.`, "success");
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
      setFlash(c, "Anzeigename ist Pflichtfeld.", "error");
      return c.redirect("/admin/roles");
    }
    await db.update(memberRoles).set({ title, grantsActiveStatus }).where(eq(memberRoles.id, id));
  } else {
    await db.update(memberRoles).set({ grantsActiveStatus }).where(eq(memberRoles.id, id));
  }

  setFlash(c, "Funktion gespeichert.", "success");
  return c.redirect("/admin/roles");
});

// POST /admin/roles/:id/delete
adminRoutes.post("/roles/:id/delete", guard, async (c) => {
  const id = c.req.param("id");
  const [role] = await db.select().from(memberRoles).where(eq(memberRoles.id, id));
  if (!role) return c.redirect("/admin/roles");

  if (role.isProtected) {
    setFlash(c, "Systemrollen können nicht gelöscht werden.", "error");
    return c.redirect("/admin/roles");
  }

  const [{ cnt }] = await db
    .select({ cnt: count() })
    .from(memberRoleAssignments)
    .where(eq(memberRoleAssignments.memberRoleId, id));

  if (cnt > 0) {
    setFlash(c, "Funktion hat bestehende Zuweisungen und kann nicht gelöscht werden.", "error");
    return c.redirect("/admin/roles");
  }

  await db.delete(memberRoles).where(eq(memberRoles.id, id));
  setFlash(c, `Funktion „${role.title}" gelöscht.`, "success");
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
    <Layout title="Jubiläen" user={user} activeNav="admin">
      <BackupWarnBanner {...warn} />
      <AdminTabs active="anniversaries" />
      <div class="max-w-4xl mx-auto">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">
          Jubiläen
        </h1>
        <button
          class="btn btn-primary btn-sm"
          hx-get="/admin/anniversaries/new"
          hx-target="#modal-content"
          hx-swap="innerHTML"
        >
          + Neues Jubiläumsjahr
        </button>
      </div>

      <ClickToEditHint />
      <div class="overflow-x-auto mb-6">
        <table class="table table-zebra w-full max-w-md">
          <thead>
            <tr>
              <th>Jahre</th>
              <th>Titel</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {years.length === 0 ? (
              <tr>
                <td colspan={3} class="text-center opacity-50 py-4">
                  Keine Jubiläumsjahre konfiguriert.
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
                        Löschen
                      </button>
                    </div>
                    <dialog id={`delete-year-${y.year}`} class="modal" onclick="event.stopPropagation()">
                      <div class="modal-box">
                        <p>
                          Jubiläumsjahr <strong>{y.year}</strong>
                          {y.title ? ` (${y.title})` : ""} löschen?
                        </p>
                        <div class="modal-action">
                          <form method="dialog">
                            <button class="btn">Abbrechen</button>
                          </form>
                          <form method="post" action={`/admin/anniversaries/${y.year}/delete`}>
                            <button type="submit" class="btn btn-error">
                              Löschen
                            </button>
                          </form>
                        </div>
                      </div>
                      <form method="dialog" class="modal-backdrop">
                        <button>Schließen</button>
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
      <h3 class="font-bold text-lg mb-4">Jubiläumsjahr hinzufügen</h3>
      <form method="post" action="/admin/anniversaries" class="flex flex-col gap-3">
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">Jahr <span class="text-error">*</span></span>
          <input type="number" name="year" min="1" max="200" class="input input-bordered w-full" required placeholder="z.B. 30" />
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">Titel (optional)</span>
          <input type="text" name="title" class="input input-bordered w-full" placeholder="z.B. 30 Jahre Treue" />
        </div>
        <div class="modal-action mt-2">
          <button
            type="button"
            class="btn btn-ghost"
            onclick="document.getElementById('admin-modal').close()"
          >
            Abbrechen
          </button>
          <button type="submit" class="btn btn-primary">
            Hinzufügen
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
      <h3 class="font-bold text-lg mb-4">Jubiläumsjahr bearbeiten</h3>
      <form method="post" action={`/admin/anniversaries/${year}`} class="flex flex-col gap-3">
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">Jahr <span class="text-error">*</span></span>
          <input type="number" name="year" value={y.year} min="1" max="200" class="input input-bordered w-full" required />
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">Titel (optional)</span>
          <input type="text" name="title" value={y.title ?? ""} class="input input-bordered w-full" placeholder="z.B. 30 Jahre Treue" />
        </div>
        <div class="modal-action mt-2">
          <button
            type="button"
            class="btn btn-ghost"
            onclick="document.getElementById('admin-modal').close()"
          >
            Abbrechen
          </button>
          <button type="submit" class="btn btn-primary">
            Speichern
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
    setFlash(c, "Ungültiges Jahr (1–200).", "error");
    return c.redirect("/admin/anniversaries");
  }

  await db.insert(anniversaryYears).values({ year, title }).onConflictDoNothing();
  setFlash(c, `Jubiläumsjahr ${year} hinzugefügt.`, "success");
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
    setFlash(c, "Ungültiges Jahr (1–200).", "error");
    return c.redirect("/admin/anniversaries");
  }

  if (newYear !== oldYear) {
    const [conflict] = await db
      .select({ year: anniversaryYears.year })
      .from(anniversaryYears)
      .where(eq(anniversaryYears.year, newYear));
    if (conflict) {
      setFlash(c, `Jubiläumsjahr ${newYear} existiert bereits.`, "error");
      return c.redirect("/admin/anniversaries");
    }
  }

  await db
    .update(anniversaryYears)
    .set({ year: newYear, title })
    .where(eq(anniversaryYears.year, oldYear));
  setFlash(c, "Jubiläumsjahr gespeichert.", "success");
  return c.redirect("/admin/anniversaries");
});

// POST /admin/anniversaries/:year/delete
adminRoutes.post("/anniversaries/:year/delete", guard, async (c) => {
  const year = parseInt(c.req.param("year"), 10);
  await db.delete(anniversaryYears).where(eq(anniversaryYears.year, year));
  setFlash(c, `Jubiläumsjahr ${year} gelöscht.`, "success");
  return c.redirect("/admin/anniversaries");
});

// ── /admin/config ─────────────────────────────────────────────────────────────
const CONFIG_DESCRIPTIONS: Record<string, string> = {
  ORG_NAME: "Name der Organisation, wird in der App angezeigt.",
  CHILDREN_AGE_LIMIT: "Altersgrenze in Jahren für die Kinderfeuerwehr-Zuordnung (muss < YOUTH_AGE_LIMIT).",
  YOUTH_AGE_LIMIT: "Altersgrenze in Jahren für die Jugend-Zuordnung.",
  ANNIVERSARY_CUTOFF: "Stichtag (MM-TT) für die Jubiläumsberechnung.",
  SESSION_LIFETIME: "Gültigkeitsdauer einer Anmeldung (z.B. 7d, 24h).",
  ADMIN_PASSWORD_MIN_LENGTH: "Mindestlänge für Admin-Passwörter.",
  BACKUP_SCHEDULE: "Cron-Ausdruck für automatische Backups.",
  BACKUP_RETENTION_COUNT: "Maximale Anzahl aufbewahrter Backup-Dateien pro Ziel.",
  BACKUP_LOCAL_PATH: "Lokales Verzeichnis für Backup-Dateien (leer = deaktiviert).",
  S3_ENDPOINT: "S3-kompatibler Endpunkt (leer = deaktiviert).",
  S3_BUCKET: "S3-Bucket-Name.",
};

adminRoutes.get("/config", guard, async (c) => {
  const user = c.get("user");
  const warn = await backupWarnProps();
  return c.html(
    <Layout title="Konfiguration" user={user} activeNav="admin">
      <BackupWarnBanner {...warn} />
      <AdminTabs active="config" />
      <div class="max-w-4xl mx-auto">
      <h1 class="text-2xl font-bold mb-6" style="font-family: var(--font-heading)">
        Konfiguration
      </h1>
      <div class="overflow-x-auto">
        <table class="table w-full max-w-2xl">
          <thead>
            <tr>
              <th>Variable</th>
              <th>Wert</th>
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
            <div class="text-base-content/50 mb-1">Letzter geplanter Zeitpunkt</div>
            {schedule.prev ? (
              <>
                <div class="font-mono font-medium">{schedule.prev.toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                {lastBackupAfterSchedule === "success" ? (
                  <div class="mt-1 text-success">✓ Backup vorhanden</div>
                ) : lastBackupAfterSchedule === "failed" ? (
                  <div class="mt-1 text-error">✗ Backup fehlgeschlagen</div>
                ) : (
                  <div class="mt-1 text-error">✗ Kein Backup gefunden</div>
                )}
              </>
            ) : (
              <div class="text-base-content/40">—</div>
            )}
          </div>
          <div class="p-4 rounded-box border bg-base-200 border-base-300">
            <div class="text-base-content/50 mb-1">Nächster geplanter Zeitpunkt</div>
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
          Backup-History
        </h1>
        <form method="post" action="/admin/backup/run">
          <button
            type="submit"
            class="btn btn-outline btn-sm"
            onclick="return confirm('Backup jetzt starten?')"
          >
            Backup jetzt starten
          </button>
        </form>
      </div>

      {entries.length === 0 ? (
        <p class="text-base-content/60">Noch keine Backup-Läufe aufgezeichnet.</p>
      ) : (
        <div class="overflow-x-auto">
          <table class="table w-full">
            <thead>
              <tr>
                <th>Zeitstempel</th>
                <th>Ziele</th>
                <th>Status</th>
                <th>Fehlermeldung</th>
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
                        {targets.map((t) => (
                          <span
                            class={`badge badge-sm ${t.status === "success" ? "badge-success" : "badge-error"}`}
                          >
                            {t.type === "local" ? "Lokal" : "S3"}
                          </span>
                        ))}
                        {targets.length === 0 && <span class="text-base-content/40 text-sm">—</span>}
                      </div>
                    </td>
                    <td>
                      <span class={`badge ${e.status === "success" ? "badge-success" : "badge-error"}`}>
                        {e.status === "success" ? "Erfolg" : "Fehlgeschlagen"}
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
  setFlash(c, "Backup gestartet.", "success");
  return c.redirect("/admin/backup");
});
