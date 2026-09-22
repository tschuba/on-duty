import { Hono } from "hono";
import { eq, and, count, asc } from "drizzle-orm";
import { setCookie } from "hono/cookie";
import { db } from "../db/index.js";
import {
  users,
  sessions,
  accounts,
  memberRoles,
  memberRoleAssignments,
  anniversaryYears,
} from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { env } from "../env.js";

export const adminRoutes = new Hono<{ Variables: Variables }>();
const guard = requireAuth("admin");

function setFlash(c: any, msg: string, type: "success" | "error") {
  setCookie(c, "flash", JSON.stringify({ message: msg, type }), {
    path: "/",
    maxAge: 10,
    httpOnly: false,
  });
}

function AdminTabs({ active }: { active: "users" | "roles" | "config" }) {
  return (
    <div role="tablist" class="tabs tabs-lifted mb-6">
      <a href="/admin/users" role="tab" class={`tab${active === "users" ? " tab-active" : ""}`}>
        Benutzer
      </a>
      <a href="/admin/roles" role="tab" class={`tab${active === "roles" ? " tab-active" : ""}`}>
        Funktionen
      </a>
      <a href="/admin/config" role="tab" class={`tab${active === "config" ? " tab-active" : ""}`}>
        Konfiguration
      </a>
    </div>
  );
}

function ModalScaffold() {
  return (
    <dialog id="admin-modal" class="modal">
      <div class="modal-box" id="modal-content" />
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

// ── /admin → /admin/users ─────────────────────────────────────────────────────
adminRoutes.get("/", guard, (c) => c.redirect("/admin/users"));

// ── /admin/users ──────────────────────────────────────────────────────────────
adminRoutes.get("/users", guard, async (c) => {
  const user = c.get("user");
  const allUsers = await db.select().from(users).orderBy(asc(users.name));

  return c.html(
    <Layout title="Benutzer" user={user} activeNav="admin">
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
                <tr key={u.id}>
                  <td class="font-medium">
                    {u.name}
                    {isLocal && (
                      <span class="badge badge-neutral badge-sm ml-2">
                        Lokaler Admin-Account
                      </span>
                    )}
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
                    {!isLocal && (
                      <div class="flex gap-2 justify-end">
                        <button
                          class="btn btn-ghost btn-xs"
                          hx-get={`/admin/users/${u.id}/edit`}
                          hx-target="#modal-content"
                          hx-swap="innerHTML"
                        >
                          Bearbeiten
                        </button>
                        {u.disabled ? (
                          <form method="post" action={`/admin/users/${u.id}/activate`}>
                            <button type="submit" class="btn btn-ghost btn-xs text-success">
                              Aktivieren
                            </button>
                          </form>
                        ) : (
                          <>
                            <button
                              class="btn btn-ghost btn-xs text-error"
                              onclick={`document.getElementById('deactivate-${u.id}').showModal()`}
                            >
                              Deaktivieren
                            </button>
                            <dialog id={`deactivate-${u.id}`} class="modal">
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
        <label class="form-control">
          <span class="label-text mb-1">
            Name <span class="text-error">*</span>
          </span>
          <input type="text" name="name" class="input input-bordered" required />
        </label>
        <label class="form-control">
          <span class="label-text mb-1">
            E-Mail <span class="text-error">*</span>
          </span>
          <input type="email" name="email" class="input input-bordered" required />
        </label>
        <label class="form-control">
          <span class="label-text mb-1">Benutzerrolle</span>
          <select name="appRole" class="select select-bordered">
            <option value="read">Lesend</option>
            <option value="editor">Bearbeiter</option>
            <option value="admin">Admin</option>
          </select>
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

// HTMX fragment: edit user modal
adminRoutes.get("/users/:id/edit", guard, async (c) => {
  const id = c.req.param("id");
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u || u.email === "admin@localhost.invalid") return c.html("", 404);

  return c.html(
    <>
      <h3 class="font-bold text-lg mb-4">Benutzer bearbeiten</h3>
      <form method="post" action={`/admin/users/${id}`} class="flex flex-col gap-3">
        <label class="form-control">
          <span class="label-text mb-1">
            Name <span class="text-error">*</span>
          </span>
          <input type="text" name="name" value={u.name} class="input input-bordered" required />
        </label>
        <div class="form-control">
          <span class="label-text mb-1">
            E-Mail <span class="text-error">*</span>
          </span>
          <input
            type="email"
            name="email"
            value={u.email}
            class="input input-bordered"
            required
          />
          <span class="label-text-alt mt-1 opacity-60">
            Achtung: E-Mail muss mit der OIDC-Adresse übereinstimmen. Bei Änderung wird die
            OIDC-Verknüpfung entfernt.
          </span>
        </div>
        <label class="form-control">
          <span class="label-text mb-1">Benutzerrolle</span>
          <select name="appRole" class="select select-bordered">
            <option value="read" selected={u.appRole === "read"}>
              Lesend
            </option>
            <option value="editor" selected={u.appRole === "editor"}>
              Bearbeiter
            </option>
            <option value="admin" selected={u.appRole === "admin"}>
              Admin
            </option>
          </select>
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

  const rolesWithCount = await db
    .select({
      id: memberRoles.id,
      title: memberRoles.title,
      grantsActiveStatus: memberRoles.grantsActiveStatus,
      isProtected: memberRoles.isProtected,
      assignmentCount: count(memberRoleAssignments.id),
    })
    .from(memberRoles)
    .leftJoin(
      memberRoleAssignments,
      eq(memberRoleAssignments.memberRoleId, memberRoles.id)
    )
    .groupBy(
      memberRoles.id,
      memberRoles.title,
      memberRoles.grantsActiveStatus,
      memberRoles.isProtected
    )
    .orderBy(asc(memberRoles.title));

  const years = await db
    .select()
    .from(anniversaryYears)
    .orderBy(asc(anniversaryYears.year));

  return c.html(
    <Layout title="Funktionen" user={user} activeNav="admin">
      <AdminTabs active="roles" />

      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">
          Funktionen
        </h1>
        <button
          class="btn btn-primary btn-sm"
          hx-get="/admin/roles/new"
          hx-target="#modal-content"
          hx-swap="innerHTML"
        >
          + Neue Funktion
        </button>
      </div>

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
                <tr key={r.id}>
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
                      <span class="badge badge-success badge-sm">Ja</span>
                    ) : (
                      <span class="badge badge-ghost badge-sm">Nein</span>
                    )}
                  </td>
                  <td>
                    <div class="flex gap-2 justify-end">
                      {r.isProtected ? (
                        <button
                          class="btn btn-ghost btn-xs"
                          disabled
                          title="Systemrolle, kann nicht bearbeitet werden"
                        >
                          Bearbeiten
                        </button>
                      ) : (
                        <button
                          class="btn btn-ghost btn-xs"
                          hx-get={`/admin/roles/${r.id}/edit`}
                          hx-target="#modal-content"
                          hx-swap="innerHTML"
                        >
                          Bearbeiten
                        </button>
                      )}
                      {canDelete ? (
                        <>
                          <button
                            class="btn btn-ghost btn-xs text-error"
                            onclick={`document.getElementById('delete-role-${r.id}').showModal()`}
                          >
                            Löschen
                          </button>
                          <dialog id={`delete-role-${r.id}`} class="modal">
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
                          class="btn btn-ghost btn-xs text-error"
                          disabled
                          title={
                            r.isProtected
                              ? "Systemrolle, kann nicht gelöscht werden"
                              : "Hat bestehende Zuweisungen"
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

      <div class="divider" />

      <h2 class="text-xl font-bold mb-4" style="font-family: var(--font-heading)">
        Jubiläumsjahre
      </h2>

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
                <tr key={y.year}>
                  <td class="font-medium">{y.year}</td>
                  <td class="opacity-70">{y.title ?? "–"}</td>
                  <td>
                    <button
                      class="btn btn-ghost btn-xs text-error"
                      onclick={`document.getElementById('delete-year-${y.year}').showModal()`}
                    >
                      Löschen
                    </button>
                    <dialog id={`delete-year-${y.year}`} class="modal">
                      <div class="modal-box">
                        <p>
                          Jubiläumsjahr <strong>{y.year}</strong>
                          {y.title ? ` (${y.title})` : ""} löschen?
                        </p>
                        <div class="modal-action">
                          <form method="dialog">
                            <button class="btn">Abbrechen</button>
                          </form>
                          <form
                            method="post"
                            action={`/admin/roles/anniversary/${y.year}/delete`}
                          >
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

      <form method="post" action="/admin/roles/anniversary" class="flex items-end gap-2 flex-wrap">
        <label class="form-control">
          <span class="label-text mb-1">Jahr</span>
          <input
            type="number"
            name="year"
            min="1"
            max="200"
            class="input input-bordered input-sm w-28"
            required
            placeholder="z.B. 30"
          />
        </label>
        <label class="form-control">
          <span class="label-text mb-1">Titel (optional)</span>
          <input
            type="text"
            name="title"
            class="input input-bordered input-sm w-52"
            placeholder="z.B. 30 Jahre Treue"
          />
        </label>
        <button type="submit" class="btn btn-sm btn-outline mb-px">
          Hinzufügen
        </button>
      </form>

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
        <label class="form-control">
          <span class="label-text mb-1">
            Anzeigename <span class="text-error">*</span>
          </span>
          <input type="text" name="title" class="input input-bordered" required />
        </label>
        <div class="form-control">
          <label class="label cursor-pointer justify-start gap-3">
            <input type="checkbox" name="grantsActiveStatus" value="1" class="checkbox" />
            <span class="label-text">Verleiht aktiven Status</span>
          </label>
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
        <div class="form-control">
          <label class="label">
            <span class="label-text">
              Anzeigename <span class="text-error">*</span>
            </span>
          </label>
          {hasAssignments ? (
            <>
              <input
                type="text"
                value={role.title}
                class="input input-bordered opacity-50"
                disabled
              />
              <span class="label-text-alt mt-1 opacity-60">
                Anzeigename kann nicht mehr geändert werden, da bereits Zuweisungen existieren.
              </span>
              <input type="hidden" name="title" value={role.title} />
            </>
          ) : (
            <input
              type="text"
              name="title"
              value={role.title}
              class="input input-bordered"
              required
            />
          )}
        </div>
        <div class="form-control">
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

// POST /admin/roles/anniversary — create anniversary year (before /:id to avoid shadowing)
adminRoutes.post("/roles/anniversary", guard, async (c) => {
  const body = await c.req.parseBody();
  const year = parseInt(String(body.year ?? ""), 10);
  const title = String(body.title ?? "").trim() || null;

  if (!year || year < 1 || year > 200) {
    setFlash(c, "Ungültiges Jahr (1–200).", "error");
    return c.redirect("/admin/roles");
  }

  await db.insert(anniversaryYears).values({ year, title }).onConflictDoNothing();
  setFlash(c, `Jubiläumsjahr ${year} hinzugefügt.`, "success");
  return c.redirect("/admin/roles");
});

// POST /admin/roles/anniversary/:year/delete
adminRoutes.post("/roles/anniversary/:year/delete", guard, async (c) => {
  const year = parseInt(c.req.param("year"), 10);
  await db.delete(anniversaryYears).where(eq(anniversaryYears.year, year));
  setFlash(c, `Jubiläumsjahr ${year} gelöscht.`, "success");
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

// ── /admin/config ─────────────────────────────────────────────────────────────
adminRoutes.get("/config", guard, (c) => {
  const user = c.get("user");
  return c.html(
    <Layout title="Konfiguration" user={user} activeNav="admin">
      <AdminTabs active="config" />
      <h1 class="text-2xl font-bold mb-6" style="font-family: var(--font-heading)">
        Konfiguration
      </h1>
      <div class="overflow-x-auto">
        <table class="table w-full max-w-xl">
          <thead>
            <tr>
              <th>Variable</th>
              <th>Wert</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="font-mono text-sm">ORG_NAME</td>
              <td>{env.ORG_NAME}</td>
            </tr>
            <tr>
              <td class="font-mono text-sm">YOUTH_AGE_LIMIT</td>
              <td>{env.YOUTH_AGE_LIMIT}</td>
            </tr>
            <tr>
              <td class="font-mono text-sm">ANNIVERSARY_CUTOFF</td>
              <td>{env.ANNIVERSARY_CUTOFF}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Layout>
  );
});
