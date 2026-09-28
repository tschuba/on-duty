import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  users,
  sessions,
  accounts,
  memberRoles,
  memberRoleAssignments,
  anniversaryYears,
  backupHistory,
} from "../db/schema/index.js";
import { t } from "../i18n/index.js";

process.env.ORG_NAME = "Test Feuerwehr";

// ── DB chain-stub helpers ───────────────────────────────────────────────────
// Same philosophy as members.test.ts: chains just re-return canned fixture
// rows regardless of predicate — filtering is Drizzle's job, not app logic.

function chainOf(rows: unknown) {
  const chain: any = Object.assign(Promise.resolve(rows), {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    groupBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
  });
  return chain;
}

let usersFixture: any[] = [];
let rolesFixture: any[] = [];
let assignmentCountFixture: any[] = [{ cnt: 0 }];
let yearsFixture: any[] = [];
let backupHistoryFixture: any[] = [];

// Per-table one-shot queues: lets a single request that issues two selects
// against the same table (e.g. lookup, then a separate email-dupe check)
// get two different results.
const queues = new Map<any, any[][]>();
function queue(table: any, ...batches: any[][]) {
  queues.set(table, [...batches]);
}
function nextRows(table: any, fallback: any[]) {
  const q = queues.get(table);
  if (q && q.length) return q.shift()!;
  return fallback;
}

const insertCalls: { table: any; values: any }[] = [];
const updateCalls: { table: any; set: any }[] = [];
const deleteCalls: { table: any }[] = [];

const select = vi.fn(() => ({
  from: vi.fn((table: any) => {
    if (table === users) return chainOf(nextRows(users, usersFixture));
    if (table === memberRoles) return chainOf(nextRows(memberRoles, rolesFixture));
    if (table === memberRoleAssignments) return chainOf(nextRows(memberRoleAssignments, assignmentCountFixture));
    if (table === anniversaryYears) return chainOf(nextRows(anniversaryYears, yearsFixture));
    if (table === backupHistory) return chainOf(nextRows(backupHistory, backupHistoryFixture));
    return chainOf([]);
  }),
}));

function makeInsert() {
  return vi.fn((table: any) => ({
    values: vi.fn((vals: any) => {
      insertCalls.push({ table, values: vals });
      const p: any = Promise.resolve(undefined);
      p.onConflictDoNothing = vi.fn(() => Promise.resolve(undefined));
      return p;
    }),
  }));
}

function makeUpdate() {
  return vi.fn((table: any) => ({
    set: vi.fn((vals: any) => {
      updateCalls.push({ table, set: vals });
      return { where: vi.fn(() => Promise.resolve(undefined)) };
    }),
  }));
}

function makeDelete() {
  return vi.fn((table: any) => {
    deleteCalls.push({ table });
    return { where: vi.fn(() => Promise.resolve(undefined)) };
  });
}

const insert = makeInsert();
const update = makeUpdate();
const del = makeDelete();

vi.mock("../db/index.js", () => ({
  db: { select, insert, update, delete: del },
}));

let currentUser: any = { id: "u1", appRole: "admin", disabled: false };

vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => async (c: any, next: any) => {
    c.set("user", currentUser);
    await next();
  },
}));

let backupConfigured = false;
let lastBackupResult: any = null;
let scheduleResult: { prev: Date | null; next: Date | null } = { prev: null, next: null };
const runBackupMock = vi.fn(() => Promise.resolve());

vi.mock("../lib/backup.js", () => ({
  isBackupConfigured: () => backupConfigured,
  getLastBackup: () => Promise.resolve(lastBackupResult),
  getCronScheduleTimes: () => scheduleResult,
  runBackup: () => runBackupMock(),
}));

const { adminRoutes, backupWarnProps } = await import("../routes/admin.js");

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  queues.clear();
  usersFixture = [];
  rolesFixture = [];
  assignmentCountFixture = [{ cnt: 0 }];
  yearsFixture = [];
  backupHistoryFixture = [];
  currentUser = { id: "u1", appRole: "admin", disabled: false };
  backupConfigured = false;
  lastBackupResult = null;
  scheduleResult = { prev: null, next: null };
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const localAdmin = { id: "local", name: "Lokaler Admin", email: "admin@localhost.invalid", appRole: "admin", disabled: false };

function makeUser(overrides: Record<string, unknown> = {}) {
  return { id: "u2", name: "Ben Bauer", email: "ben@example.com", appRole: "editor", disabled: false, ...overrides };
}

function makeRole(overrides: Record<string, unknown> = {}) {
  return { id: "r1", title: "Vorstand", grantsActiveStatus: true, isProtected: false, ...overrides };
}

function makeRoleRow(overrides: Record<string, unknown> = {}) {
  return { ...makeRole(), assignmentCount: 0, ...overrides };
}

function makeYear(overrides: Record<string, unknown> = {}) {
  return { year: 10, title: "Zehnjähriges", ...overrides };
}

function makeBackupEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1",
    startedAt: new Date("2024-01-01T02:00:00Z"),
    status: "success",
    targets: JSON.stringify([{ type: "local", status: "success" }]),
    errorMessage: null,
    ...overrides,
  };
}

function formBody(fields: Record<string, string | string[]>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    for (const val of Array.isArray(v) ? v : [v]) params.append(k, val);
  }
  return params;
}

// ── Pure logic ───────────────────────────────────────────────────────────────

describe("backupWarnProps", () => {
  it("skips backup lookups entirely when not configured", async () => {
    backupConfigured = false;
    expect(await backupWarnProps()).toEqual({ configured: false, lastFailed: false });
  });

  it("is not failed when the last backup succeeded after the last scheduled run", async () => {
    backupConfigured = true;
    scheduleResult = { prev: new Date("2024-01-01T00:00:00Z"), next: new Date("2024-01-08T00:00:00Z") };
    lastBackupResult = { startedAt: new Date("2024-01-01T01:00:00Z"), status: "success" };
    expect(await backupWarnProps()).toEqual({ configured: true, lastFailed: false });
  });

  it("is failed when no backup ran since the last scheduled time", async () => {
    backupConfigured = true;
    scheduleResult = { prev: new Date("2024-01-01T00:00:00Z"), next: new Date("2024-01-08T00:00:00Z") };
    lastBackupResult = null;
    expect((await backupWarnProps()).lastFailed).toBe(true);
  });

  it("is failed when the run since schedule reported failure", async () => {
    backupConfigured = true;
    scheduleResult = { prev: new Date("2024-01-01T00:00:00Z"), next: null };
    lastBackupResult = { startedAt: new Date("2024-01-01T01:00:00Z"), status: "failed" };
    expect((await backupWarnProps()).lastFailed).toBe(true);
  });

  it("falls back to the last run's own status when there is no schedule", async () => {
    backupConfigured = true;
    scheduleResult = { prev: null, next: null };
    lastBackupResult = { startedAt: new Date(), status: "failed" };
    expect((await backupWarnProps()).lastFailed).toBe(true);

    lastBackupResult = { startedAt: new Date(), status: "success" };
    expect((await backupWarnProps()).lastFailed).toBe(false);
  });
});

// ── Routes ───────────────────────────────────────────────────────────────────

describe("GET /", () => {
  it("redirects to the users tab", async () => {
    const res = await adminRoutes.request("/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/users");
  });
});

describe("GET /users", () => {
  it("shows the lock badge and hides row actions for the built-in local admin", async () => {
    usersFixture = [localAdmin];
    const html = await (await adminRoutes.request("/users")).text();
    expect(html).toContain(t("admin.users.localAdminBadge"));
    expect(html).not.toContain(`/admin/users/${localAdmin.id}/edit`);
  });

  it("shows activate and delete for a disabled user", async () => {
    usersFixture = [makeUser({ disabled: true })];
    const html = await (await adminRoutes.request("/users")).text();
    expect(html).toContain(t("admin.users.activate"));
    expect(html).toContain(t("admin.users.confirmDelete.title"));
  });

  it("disables the deactivate button for yourself", async () => {
    usersFixture = [makeUser({ id: "u1" })];
    const html = await (await adminRoutes.request("/users")).text();
    expect(html).toContain(t("admin.users.cannotDeactivateSelf"));
  });

  it("enables the deactivate button for another active user", async () => {
    usersFixture = [makeUser({ id: "u2" })];
    const html = await (await adminRoutes.request("/users")).text();
    expect(html).toContain(t("admin.users.confirmDeactivate.title"));
  });

  it("renders the correct badge per app role", async () => {
    usersFixture = [makeUser({ id: "a", appRole: "admin" }), makeUser({ id: "b", appRole: "editor" }), makeUser({ id: "c", appRole: "read" })];
    const html = await (await adminRoutes.request("/users")).text();
    expect(html).toContain(t("admin.users.role.adminBadge"));
    expect(html).toContain(t("admin.users.role.editor"));
    expect(html).toContain(t("admin.users.role.read"));
  });
});

describe("GET /users/new", () => {
  it("renders the create-user form", async () => {
    const res = await adminRoutes.request("/users/new");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(t("admin.users.modal.create"));
  });
});

describe("GET /users/:id/edit", () => {
  it("404s for an unknown user", async () => {
    usersFixture = [];
    expect((await adminRoutes.request("/users/nope/edit")).status).toBe(404);
  });

  it("404s for the built-in local admin", async () => {
    usersFixture = [localAdmin];
    expect((await adminRoutes.request(`/users/${localAdmin.id}/edit`)).status).toBe(404);
  });

  it("disables downgrading your own role below its current rank", async () => {
    usersFixture = [makeUser({ id: "u1", appRole: "admin" })];
    const html = await (await adminRoutes.request("/users/u1/edit")).text();
    expect(html).toContain(t("admin.users.cannotDowngradeRole"));
  });

  it("allows editing another user's role freely", async () => {
    usersFixture = [makeUser({ id: "u2", appRole: "read" })];
    const html = await (await adminRoutes.request("/users/u2/edit")).text();
    expect(html).not.toContain(t("admin.users.cannotDowngradeRole"));
  });
});

describe("POST /users", () => {
  it("rejects missing required fields", async () => {
    const res = await adminRoutes.request("/users", { method: "POST", body: formBody({ name: "", email: "" }) });
    expect(res.status).toBe(302);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects an invalid role", async () => {
    await adminRoutes.request("/users", { method: "POST", body: formBody({ name: "A", email: "a@b.de", appRole: "root" }) });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a duplicate email", async () => {
    usersFixture = [makeUser({ email: "a@b.de" })];
    await adminRoutes.request("/users", { method: "POST", body: formBody({ name: "A", email: "a@b.de", appRole: "read" }) });
    expect(insert).not.toHaveBeenCalled();
  });

  it("creates the user and redirects", async () => {
    const res = await adminRoutes.request("/users", { method: "POST", body: formBody({ name: "A", email: "a@b.de", appRole: "editor" }) });
    expect(res.status).toBe(302);
    expect(insertCalls.some((c) => c.table === users && c.values.appRole === "editor")).toBe(true);
    expect(res.headers.get("set-cookie")).toMatch(/flash=/);
  });
});

describe("POST /users/:id", () => {
  it("404s for an unknown user", async () => {
    usersFixture = [];
    expect((await adminRoutes.request("/users/nope", { method: "POST", body: formBody({}) })).status).toBe(404);
  });

  it("404s for the built-in local admin", async () => {
    usersFixture = [localAdmin];
    expect((await adminRoutes.request(`/users/${localAdmin.id}`, { method: "POST", body: formBody({}) })).status).toBe(404);
  });

  it("rejects missing required fields", async () => {
    usersFixture = [makeUser()];
    const res = await adminRoutes.request("/users/u2", { method: "POST", body: formBody({ name: "", email: "" }) });
    expect(res.status).toBe(302);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects an invalid role", async () => {
    usersFixture = [makeUser()];
    await adminRoutes.request("/users/u2", { method: "POST", body: formBody({ name: "A", email: "a@b.de", appRole: "root" }) });
    expect(update).not.toHaveBeenCalled();
  });

  it("blocks downgrading your own role", async () => {
    usersFixture = [makeUser({ id: "u1", appRole: "admin", email: "a@b.de" })];
    const res = await adminRoutes.request("/users/u1", { method: "POST", body: formBody({ name: "A", email: "a@b.de", appRole: "read" }) });
    expect(res.status).toBe(302);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a duplicate email on change", async () => {
    queue(users, [makeUser({ email: "old@b.de" })], [makeUser({ id: "other", email: "new@b.de" })]);
    const res = await adminRoutes.request("/users/u2", { method: "POST", body: formBody({ name: "A", email: "new@b.de", appRole: "read" }) });
    expect(res.status).toBe(302);
    expect(deleteCalls.some((c) => c.table === accounts)).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("unlinks the OIDC account and saves when the email changes without conflict", async () => {
    queue(users, [makeUser({ email: "old@b.de" })], []);
    const res = await adminRoutes.request("/users/u2", { method: "POST", body: formBody({ name: "A", email: "new@b.de", appRole: "editor" }) });
    expect(res.status).toBe(302);
    expect(deleteCalls.some((c) => c.table === accounts)).toBe(true);
    expect(updateCalls.some((c) => c.table === users && c.set.email === "new@b.de")).toBe(true);
  });

  it("saves without touching the OIDC link when the email is unchanged", async () => {
    usersFixture = [makeUser({ email: "same@b.de" })];
    const res = await adminRoutes.request("/users/u2", { method: "POST", body: formBody({ name: "A", email: "same@b.de", appRole: "editor" }) });
    expect(res.status).toBe(302);
    expect(deleteCalls.some((c) => c.table === accounts)).toBe(false);
    expect(updateCalls.some((c) => c.table === users)).toBe(true);
  });
});

describe("POST /users/:id/deactivate", () => {
  it("404s for an unknown user", async () => {
    usersFixture = [];
    expect((await adminRoutes.request("/users/nope/deactivate", { method: "POST" })).status).toBe(404);
  });

  it("disables the user and kills their sessions", async () => {
    usersFixture = [makeUser()];
    const res = await adminRoutes.request("/users/u2/deactivate", { method: "POST" });
    expect(res.status).toBe(302);
    expect(updateCalls.some((c) => c.table === users && c.set.disabled === true)).toBe(true);
    expect(deleteCalls.some((c) => c.table === sessions)).toBe(true);
  });
});

describe("POST /users/:id/activate", () => {
  it("404s for an unknown user", async () => {
    usersFixture = [];
    expect((await adminRoutes.request("/users/nope/activate", { method: "POST" })).status).toBe(404);
  });

  it("re-enables the user", async () => {
    usersFixture = [makeUser()];
    const res = await adminRoutes.request("/users/u2/activate", { method: "POST" });
    expect(res.status).toBe(302);
    expect(updateCalls.some((c) => c.table === users && c.set.disabled === false)).toBe(true);
  });
});

describe("POST /users/:id/delete", () => {
  it("forbids deleting yourself", async () => {
    const res = await adminRoutes.request("/users/u1/delete", { method: "POST" });
    expect(res.status).toBe(403);
    expect(del).not.toHaveBeenCalled();
  });

  it("404s for an unknown user", async () => {
    usersFixture = [];
    expect((await adminRoutes.request("/users/nope/delete", { method: "POST" })).status).toBe(404);
  });

  it("refuses to delete a still-active user", async () => {
    usersFixture = [{ email: "a@b.de", disabled: false }];
    const res = await adminRoutes.request("/users/u2/delete", { method: "POST" });
    expect(res.status).toBe(400);
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes a disabled user", async () => {
    usersFixture = [{ email: "a@b.de", disabled: true }];
    const res = await adminRoutes.request("/users/u2/delete", { method: "POST" });
    expect(res.status).toBe(302);
    expect(deleteCalls.some((c) => c.table === users)).toBe(true);
  });
});

describe("GET /roles", () => {
  it("renders the unfiltered, active and passive views", async () => {
    rolesFixture = [makeRoleRow()];
    for (const qs of ["", "?active=1", "?active=0"]) {
      expect((await adminRoutes.request(`/roles${qs}`)).status).toBe(200);
    }
  });

  it("locks deletion for a protected role", async () => {
    rolesFixture = [makeRoleRow({ isProtected: true })];
    const html = await (await adminRoutes.request("/roles")).text();
    expect(html).toContain(t("admin.roles.cannotDelete.protected"));
  });

  it("locks deletion with a singular usage message", async () => {
    rolesFixture = [makeRoleRow({ assignmentCount: 1 })];
    const html = await (await adminRoutes.request("/roles")).text();
    expect(html).toContain(t("admin.roles.cannotDelete.usedBySingle", { count: 1 }));
  });

  it("locks deletion with a plural usage message", async () => {
    rolesFixture = [makeRoleRow({ assignmentCount: 3 })];
    const html = await (await adminRoutes.request("/roles")).text();
    expect(html).toContain(t("admin.roles.cannotDelete.usedByMultiple", { count: 3 }));
  });

  it("allows deletion when unused and unprotected", async () => {
    rolesFixture = [makeRoleRow({ assignmentCount: 0 })];
    const html = await (await adminRoutes.request("/roles")).text();
    expect(html).toContain(t("admin.roles.confirmDelete.title"));
  });
});

describe("GET /roles/new", () => {
  it("renders the create-role form", async () => {
    expect((await adminRoutes.request("/roles/new")).status).toBe(200);
  });
});

describe("GET /roles/:id/edit", () => {
  it("404s for an unknown role", async () => {
    rolesFixture = [];
    expect((await adminRoutes.request("/roles/nope/edit")).status).toBe(404);
  });

  it("404s for a protected role", async () => {
    rolesFixture = [makeRole({ isProtected: true })];
    expect((await adminRoutes.request("/roles/r1/edit")).status).toBe(404);
  });

  it("locks the name field when assignments exist", async () => {
    rolesFixture = [makeRole()];
    assignmentCountFixture = [{ cnt: 2 }];
    const html = await (await adminRoutes.request("/roles/r1/edit")).text();
    expect(html).toContain(t("admin.roles.modal.nameLocked"));
  });

  it("keeps the name field editable with no assignments", async () => {
    rolesFixture = [makeRole({ grantsActiveStatus: false })];
    assignmentCountFixture = [{ cnt: 0 }];
    const html = await (await adminRoutes.request("/roles/r1/edit")).text();
    expect(html).not.toContain(t("admin.roles.modal.nameLocked"));
  });
});

describe("POST /roles", () => {
  it("requires a title", async () => {
    const res = await adminRoutes.request("/roles", { method: "POST", body: formBody({ title: "" }) });
    expect(res.status).toBe(302);
    expect(insert).not.toHaveBeenCalled();
  });

  it("creates the role", async () => {
    const res = await adminRoutes.request("/roles", { method: "POST", body: formBody({ title: "Kassier", grantsActiveStatus: "1" }) });
    expect(res.status).toBe(302);
    expect(insertCalls.some((c) => c.table === memberRoles && c.values.grantsActiveStatus === true)).toBe(true);
  });
});

describe("POST /roles/:id", () => {
  it("404s for an unknown role", async () => {
    rolesFixture = [];
    expect((await adminRoutes.request("/roles/nope", { method: "POST", body: formBody({}) })).status).toBe(404);
  });

  it("404s for a protected role", async () => {
    rolesFixture = [makeRole({ isProtected: true })];
    expect((await adminRoutes.request("/roles/r1", { method: "POST", body: formBody({}) })).status).toBe(404);
  });

  it("requires a title when there are no assignments yet", async () => {
    rolesFixture = [makeRole()];
    assignmentCountFixture = [{ cnt: 0 }];
    const res = await adminRoutes.request("/roles/r1", { method: "POST", body: formBody({ title: "" }) });
    expect(res.status).toBe(302);
    expect(update).not.toHaveBeenCalled();
  });

  it("updates title and status when unused", async () => {
    rolesFixture = [makeRole()];
    assignmentCountFixture = [{ cnt: 0 }];
    const res = await adminRoutes.request("/roles/r1", { method: "POST", body: formBody({ title: "Neu", grantsActiveStatus: "1" }) });
    expect(res.status).toBe(302);
    expect(updateCalls.some((c) => c.table === memberRoles && c.set.title === "Neu")).toBe(true);
  });

  it("only updates the active-status flag when the role is in use", async () => {
    rolesFixture = [makeRole()];
    assignmentCountFixture = [{ cnt: 5 }];
    const res = await adminRoutes.request("/roles/r1", { method: "POST", body: formBody({ grantsActiveStatus: "1" }) });
    expect(res.status).toBe(302);
    expect(updateCalls.some((c) => c.table === memberRoles && !("title" in c.set))).toBe(true);
  });
});

describe("POST /roles/:id/delete", () => {
  it("silently redirects for an unknown role", async () => {
    rolesFixture = [];
    const res = await adminRoutes.request("/roles/nope/delete", { method: "POST" });
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(del).not.toHaveBeenCalled();
  });

  it("refuses to delete a protected role", async () => {
    rolesFixture = [makeRole({ isProtected: true })];
    const res = await adminRoutes.request("/roles/r1/delete", { method: "POST" });
    expect(res.headers.get("set-cookie")).toMatch(/flash=/);
    expect(del).not.toHaveBeenCalled();
  });

  it("refuses to delete a role with assignments", async () => {
    rolesFixture = [makeRole()];
    assignmentCountFixture = [{ cnt: 1 }];
    const res = await adminRoutes.request("/roles/r1/delete", { method: "POST" });
    expect(res.headers.get("set-cookie")).toMatch(/flash=/);
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes an unused role", async () => {
    rolesFixture = [makeRole()];
    assignmentCountFixture = [{ cnt: 0 }];
    const res = await adminRoutes.request("/roles/r1/delete", { method: "POST" });
    expect(res.status).toBe(302);
    expect(deleteCalls.some((c) => c.table === memberRoles)).toBe(true);
  });
});

describe("GET /anniversaries", () => {
  it("shows the empty state", async () => {
    yearsFixture = [];
    const html = await (await adminRoutes.request("/anniversaries")).text();
    expect(html).toContain(t("admin.anniversaries.empty"));
  });

  it("renders a titled year with its delete confirmation", async () => {
    yearsFixture = [makeYear({ year: 25, title: "Silber" })];
    const html = await (await adminRoutes.request("/anniversaries")).text();
    expect(html).toContain("Silber");
    expect(html).toContain(t("admin.anniversaries.confirmDelete.bodyWithTitle", { year: "25", title: "Silber" }));
  });

  it("falls back to an em-dash and untitled delete text when title is null", async () => {
    yearsFixture = [makeYear({ year: 10, title: null })];
    const html = await (await adminRoutes.request("/anniversaries")).text();
    expect(html).toContain(t("admin.anniversaries.confirmDelete.body", { year: "10" }));
  });
});

describe("GET /anniversaries/new", () => {
  it("renders the create form", async () => {
    expect((await adminRoutes.request("/anniversaries/new")).status).toBe(200);
  });
});

describe("GET /anniversaries/:year/edit", () => {
  it("404s for an unknown year", async () => {
    yearsFixture = [];
    expect((await adminRoutes.request("/anniversaries/99/edit")).status).toBe(404);
  });

  it("renders the edit form with existing values", async () => {
    yearsFixture = [makeYear({ year: 25, title: "Silber" })];
    const html = await (await adminRoutes.request("/anniversaries/25/edit")).text();
    expect(html).toContain("Silber");
  });
});

describe("POST /anniversaries", () => {
  it.each([0, -1, 300])("rejects an out-of-range year (%d)", async (year) => {
    const res = await adminRoutes.request("/anniversaries", { method: "POST", body: formBody({ year: String(year) }) });
    expect(res.status).toBe(302);
    expect(insert).not.toHaveBeenCalled();
  });

  it("creates a year with a title", async () => {
    await adminRoutes.request("/anniversaries", { method: "POST", body: formBody({ year: "25", title: "Silber" }) });
    expect(insertCalls.some((c) => c.table === anniversaryYears && c.values.title === "Silber")).toBe(true);
  });

  it("defaults an empty title to null", async () => {
    await adminRoutes.request("/anniversaries", { method: "POST", body: formBody({ year: "25", title: "" }) });
    expect(insertCalls.some((c) => c.table === anniversaryYears && c.values.title === null)).toBe(true);
  });
});

describe("POST /anniversaries/:year", () => {
  it("404s for an unknown year", async () => {
    yearsFixture = [];
    expect((await adminRoutes.request("/anniversaries/10", { method: "POST", body: formBody({ year: "10" }) })).status).toBe(404);
  });

  it("rejects an out-of-range new year", async () => {
    yearsFixture = [makeYear({ year: 10 })];
    const res = await adminRoutes.request("/anniversaries/10", { method: "POST", body: formBody({ year: "0" }) });
    expect(res.status).toBe(302);
    expect(update).not.toHaveBeenCalled();
  });

  it("updates in place when the year is unchanged", async () => {
    yearsFixture = [makeYear({ year: 10 })];
    const res = await adminRoutes.request("/anniversaries/10", { method: "POST", body: formBody({ year: "10", title: "Neu" }) });
    expect(res.status).toBe(302);
    expect(updateCalls.some((c) => c.table === anniversaryYears && c.set.title === "Neu")).toBe(true);
  });

  it("rejects renaming onto an already-used year", async () => {
    queue(anniversaryYears, [makeYear({ year: 10 })], [makeYear({ year: 20 })]);
    const res = await adminRoutes.request("/anniversaries/10", { method: "POST", body: formBody({ year: "20" }) });
    expect(res.status).toBe(302);
    expect(update).not.toHaveBeenCalled();
  });

  it("moves the year when the target is free", async () => {
    queue(anniversaryYears, [makeYear({ year: 10 })], []);
    const res = await adminRoutes.request("/anniversaries/10", { method: "POST", body: formBody({ year: "20" }) });
    expect(res.status).toBe(302);
    expect(updateCalls.some((c) => c.table === anniversaryYears && c.set.year === 20)).toBe(true);
  });
});

describe("POST /anniversaries/:year/delete", () => {
  it("deletes the year and redirects", async () => {
    const res = await adminRoutes.request("/anniversaries/10/delete", { method: "POST" });
    expect(res.status).toBe(302);
    expect(deleteCalls.some((c) => c.table === anniversaryYears)).toBe(true);
  });
});

describe("GET /config", () => {
  it("lists env vars with a fallback for unset values", async () => {
    const html = await (await adminRoutes.request("/config")).text();
    expect(html).toContain("ORG_NAME");
    expect(html).toContain("Test Feuerwehr");
    expect(html).toContain("—");
  });

  it("shows the not-configured backup warning", async () => {
    backupConfigured = false;
    const html = await (await adminRoutes.request("/config")).text();
    expect(html).toContain(t("admin.backup.warnNotConfigured"));
  });

  it("shows no warning when backups are healthy", async () => {
    backupConfigured = true;
    scheduleResult = { prev: new Date("2024-01-01"), next: new Date("2024-01-08") };
    lastBackupResult = { startedAt: new Date("2024-01-01T01:00:00Z"), status: "success" };
    const html = await (await adminRoutes.request("/config")).text();
    expect(html).not.toContain(t("admin.backup.warnLastFailed"));
  });

  it("shows the last-failed backup warning", async () => {
    backupConfigured = true;
    scheduleResult = { prev: new Date("2024-01-01"), next: null };
    lastBackupResult = { startedAt: new Date("2024-01-01T01:00:00Z"), status: "failed" };
    const html = await (await adminRoutes.request("/config")).text();
    expect(html).toContain(t("admin.backup.warnLastFailed"));
  });
});

describe("GET /backup", () => {
  it("shows the empty-history message when not configured and no runs", async () => {
    backupHistoryFixture = [];
    const html = await (await adminRoutes.request("/backup")).text();
    expect(html).toContain(t("admin.backup.noRuns"));
  });

  it("shows a missing-backup state when nothing ran since the last schedule", async () => {
    backupConfigured = true;
    scheduleResult = { prev: new Date("2024-01-01T00:00:00Z"), next: new Date("2024-01-08T00:00:00Z") };
    backupHistoryFixture = [];
    const html = await (await adminRoutes.request("/backup")).text();
    expect(html).toContain(t("admin.backup.backupMissing"));
    expect(html).toContain(t("admin.backup.scheduleNextTime"));
  });

  it("shows a successful backup after the schedule", async () => {
    backupConfigured = true;
    scheduleResult = { prev: new Date("2024-01-01T00:00:00Z"), next: null };
    backupHistoryFixture = [makeBackupEntry({ startedAt: new Date("2024-01-01T01:00:00Z"), status: "success" })];
    const html = await (await adminRoutes.request("/backup")).text();
    expect(html).toContain(t("admin.backup.backupAvailable"));
  });

  it("shows a failed backup after the schedule, including its error", async () => {
    backupConfigured = true;
    scheduleResult = { prev: new Date("2024-01-01T00:00:00Z"), next: null };
    backupHistoryFixture = [makeBackupEntry({ startedAt: new Date("2024-01-01T01:00:00Z"), status: "failed", errorMessage: "boom" })];
    const html = await (await adminRoutes.request("/backup")).text();
    expect(html).toContain(t("admin.backup.backupFailed"));
    expect(html).toContain("boom");
  });

  it("renders local and S3 target badges, and an empty-targets placeholder", async () => {
    backupHistoryFixture = [
      makeBackupEntry({ targets: JSON.stringify([{ type: "local", status: "success" }, { type: "s3", status: "error" }]) }),
      makeBackupEntry({ id: "b2", targets: JSON.stringify([]) }),
    ];
    const html = await (await adminRoutes.request("/backup")).text();
    expect(html).toContain(t("admin.backup.targetLocal"));
    expect(html).toContain("S3");
  });
});

describe("POST /backup/run", () => {
  it("triggers a backup asynchronously and redirects immediately", async () => {
    const res = await adminRoutes.request("/backup/run", { method: "POST" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/backup");
    expect(runBackupMock).toHaveBeenCalled();
  });

  it("logs but does not crash when the background backup rejects", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    runBackupMock.mockReturnValueOnce(Promise.reject(new Error("boom")));
    const res = await adminRoutes.request("/backup/run", { method: "POST" });
    expect(res.status).toBe(302);
    await new Promise((r) => setImmediate(r));
    expect(errSpy).toHaveBeenCalledWith("[backup] manual run failed:", expect.any(Error));
    errSpy.mockRestore();
  });
});
