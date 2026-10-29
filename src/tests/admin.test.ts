import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  users,
  sessions,
  accounts,
  memberRoles,
  memberRoleTypes,
  memberRoleAssignments,
  anniversaryYears,
  appRoles,
  appRolePermissions,
  userAppRoles,
  orgConfig,
} from "../db/schema/index.js";
import { t } from "../i18n/index.js";
import { formBody } from "./test-utils.js";

process.env.ORG_NAME = "Test Feuerwehr";

// ── DB chain-stub helpers ───────────────────────────────────────────────────
// Same philosophy as members.test.ts: chains just re-return canned fixture
// rows regardless of predicate — filtering is Drizzle's job, not app logic.
// appRoles/appRolePermissions/userAppRoles are each queried with more than one
// row shape depending on the route (e.g. userAppRoles as a join for the users
// list vs. a plain {cnt} count for role deletion) — same overloaded-fixture
// pattern already used for memberRoles/memberRoleAssignments below: each test
// sets the shared fixture var to whatever shape its route expects.

function chainOf(rows: unknown) {
  const chain: any = Object.assign(Promise.resolve(rows), {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    groupBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
  });
  return chain;
}

let usersFixture: any[] = [];
let rolesFixture: any[] = [];
let typesFixture: any[] = [makeType()];
let assignmentCountFixture: any[] = [{ cnt: 0 }];
let yearsFixture: any[] = [];
let appRolesFixture: any[] = [];
let appRolePermissionsFixture: any[] = [];
let userAppRolesFixture: any[] = [];
let orgConfigFixture: any[] = [];

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
    if (table === memberRoleTypes) return chainOf(nextRows(memberRoleTypes, typesFixture));
    if (table === memberRoleAssignments) return chainOf(nextRows(memberRoleAssignments, assignmentCountFixture));
    if (table === anniversaryYears) return chainOf(nextRows(anniversaryYears, yearsFixture));
    if (table === appRoles) return chainOf(nextRows(appRoles, appRolesFixture));
    if (table === appRolePermissions) return chainOf(nextRows(appRolePermissions, appRolePermissionsFixture));
    if (table === userAppRoles) return chainOf(nextRows(userAppRoles, userAppRolesFixture));
    if (table === orgConfig) return chainOf(nextRows(orgConfig, orgConfigFixture));
    if (table === accounts) return chainOf(nextRows(accounts, []));
    return chainOf([]);
  }),
}));

function makeInsert() {
  return vi.fn((table: any) => ({
    values: vi.fn((vals: any) => {
      insertCalls.push({ table, values: vals });
      const p: any = Promise.resolve(undefined);
      p.onConflictDoNothing = vi.fn(() => Promise.resolve(undefined));
      p.onConflictDoUpdate = vi.fn(() => Promise.resolve(undefined));
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

let currentUser: any = { id: "u1", disabled: false, permissions: new Set(["system:admin", "member-roles:read", "member-roles:write", "member-roles:delete", "member-role-types:read", "member-role-types:write", "member-role-types:delete", "anniversary-years:read", "anniversary-years:write", "anniversary-years:delete"]) };

vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => async (c: any, next: any) => {
    c.set("user", currentUser);
    await next();
  },
}));

let backupStatus: any = { state: "unconfigured", timestamp: null, lastSuccess: null };

// Layout badge count is a separate DB query; keep it out of the per-route select-call assertions.
vi.mock("../lib/registration.js", async (orig) => ({ ...(await orig<typeof import("../lib/registration.js")>()), countPendingUsers: async () => 0 }));

vi.mock("../lib/backup.js", () => ({ getBackupStatus: () => Promise.resolve(backupStatus) }));

const { adminRoutes, backupWarnProps } = await import("../routes/admin.js");

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  queues.clear();
  usersFixture = [];
  rolesFixture = [];
  typesFixture = [makeType()];
  assignmentCountFixture = [{ cnt: 0 }];
  yearsFixture = [];
  appRolesFixture = [];
  appRolePermissionsFixture = [];
  userAppRolesFixture = [];
  orgConfigFixture = [];
  currentUser = { id: "u1", disabled: false, permissions: new Set(["system:admin", "member-roles:read", "member-roles:write", "member-roles:delete", "member-role-types:read", "member-role-types:write", "member-role-types:delete", "anniversary-years:read", "anniversary-years:write", "anniversary-years:delete"]) };
  backupStatus = { state: "unconfigured", timestamp: null, lastSuccess: null };
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const localAdmin = { id: "local", name: "Lokaler Admin", email: "admin@localhost.invalid", disabled: false };

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "u2",
    name: "Ben Bauer",
    email: "ben@example.com",
    disabled: false,
    emailVerified: true,
    lastLoginAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeType(overrides: Record<string, unknown> = {}) {
  return { id: "t1", name: "Dienstgrad", allowsActiveStatus: true, sortOrder: 1, isProtected: false, ...overrides };
}

function makeRole(overrides: Record<string, unknown> = {}) {
  return { id: "r1", title: "Vorstand", typeId: "t1", sortOrder: 1, grantsActiveStatus: true, isProtected: false, ...overrides };
}

function makeRoleRow(overrides: Record<string, unknown> = {}) {
  return { ...makeRole(), assignmentCount: 0, ...overrides };
}

function makeAppRole(overrides: Record<string, unknown> = {}) {
  return { id: "ar1", name: "editor", isProtected: false, ...overrides };
}

function makeYear(overrides: Record<string, unknown> = {}) {
  return { kind: "service", year: 10, title: "Zehnjähriges", ...overrides };
}

describe("backupWarnProps", () => {
  it("returns the current backup status", async () => {
    expect(await backupWarnProps()).toEqual({ status: backupStatus });
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

  it("row click leads to the read-only detail page, not directly to edit", async () => {
    usersFixture = [makeUser({ id: "a" })];
    const html = await (await adminRoutes.request("/users")).text();
    expect(html).toContain("/admin/users/a&#39;");
    expect(html).not.toContain("/admin/users/a/edit&#39;");
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

  it("renders a single badge for a user with one role", async () => {
    usersFixture = [makeUser({ id: "a" })];
    userAppRolesFixture = [{ userId: "a", roleName: "editor" }];
    const html = await (await adminRoutes.request("/users")).text();
    expect(html).toContain("editor");
  });

  it("renders a role-count badge for a user with multiple roles", async () => {
    usersFixture = [makeUser({ id: "a" })];
    userAppRolesFixture = [
      { userId: "a", roleName: "editor" },
      { userId: "a", roleName: "Vorstand" },
    ];
    const html = await (await adminRoutes.request("/users")).text();
    expect(html).toContain(t("admin.users.roleCount", { count: 2 }));
  });

  it("renders an em-dash for a user with no roles", async () => {
    usersFixture = [makeUser({ id: "a" })];
    userAppRolesFixture = [];
    const html = await (await adminRoutes.request("/users")).text();
    expect(html).toContain("—");
  });

  it("shows 'pending' for a logged-in user without any role", async () => {
    usersFixture = [makeUser({ lastLoginAt: new Date() })];
    userAppRolesFixture = [];
    const html = await (await adminRoutes.request("/users")).text();
    expect(html).toContain(t("admin.users.statusPending"));
  });

  it("shows 'email unverified' for a user created before verification", async () => {
    usersFixture = [makeUser({ emailVerified: false, lastLoginAt: null })];
    const html = await (await adminRoutes.request("/users")).text();
    expect(html).toContain(t("admin.users.statusEmailUnverified"));
  });

  it("shows 'unconfirmed' for a user who has never logged in", async () => {
    usersFixture = [makeUser({ lastLoginAt: null })];
    const html = await (await adminRoutes.request("/users")).text();
    expect(html).toContain(t("admin.users.statusUnconfirmed"));
  });

  it("prioritizes 'disabled' over 'unconfirmed' when both apply", async () => {
    usersFixture = [makeUser({ disabled: true, lastLoginAt: null })];
    const html = await (await adminRoutes.request("/users")).text();
    expect(html).toContain(t("admin.users.statusDisabled"));
    expect(html).not.toContain(t("admin.users.statusUnconfirmed"));
  });

  it("never shows 'unconfirmed' for the local admin, even without a login timestamp", async () => {
    usersFixture = [{ ...localAdmin, lastLoginAt: null }];
    const html = await (await adminRoutes.request("/users")).text();
    expect(html).toContain(t("admin.users.statusActive"));
    expect(html).not.toContain(t("admin.users.statusUnconfirmed"));
  });
});

describe("GET /users/new", () => {
  it("renders the create-user form", async () => {
    const res = await adminRoutes.request("/users/new");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(t("admin.users.modal.create"));
  });

  it("pre-checks no role by default", async () => {
    appRolesFixture = [makeAppRole({ id: "ar-read", name: "read" }), makeAppRole({ id: "ar-editor", name: "editor" })];
    const html = await (await adminRoutes.request("/users/new")).text();
    expect(html).not.toMatch(/value="ar-read"[^>]*checked/);
    expect(html).not.toMatch(/value="ar-editor"[^>]*checked/);
  });
});

describe("role picker", () => {
  it("renders search field, per-role filter text and collapsed details", async () => {
    appRolesFixture = [makeAppRole({ id: "ar1", name: "Editor", description: "Darf Daten ändern" })];
    appRolePermissionsFixture = [{ roleId: "ar1", permission: "members:read" }];
    const html = await (await adminRoutes.request("/users/new")).text();
    expect(html).toContain(t("admin.users.modal.roleSearchPlaceholder"));
    expect(html).toMatch(/data-role-item="editor darf daten ändern members:read /);
    expect(html).toContain(t("admin.users.modal.effectivePermissions"));
    expect(html).toContain(t("admin.users.modal.roleDetails"));
    expect(html).toMatch(/aria-expanded="false"/);
    expect(html).not.toContain("overflow-y-auto");
  });
});

describe("GET /users/:id", () => {
  it("404s for an unknown user", async () => {
    usersFixture = [];
    expect((await adminRoutes.request("/users/nope")).status).toBe(404);
  });

  it("404s for the built-in local admin", async () => {
    usersFixture = [localAdmin];
    expect((await adminRoutes.request(`/users/${localAdmin.id}`)).status).toBe(404);
  });

  it("shows the edit link and the assigned roles", async () => {
    usersFixture = [makeUser({ id: "u2" })];
    userAppRolesFixture = [{ id: "ar1", name: "editor" }];
    const html = await (await adminRoutes.request("/users/u2")).text();
    expect(html).toContain("/admin/users/u2/edit");
    expect(html).toContain("editor");
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

  it("pre-checks the user's currently assigned roles", async () => {
    usersFixture = [makeUser({ id: "u2" })];
    appRolesFixture = [makeAppRole({ id: "ar1", name: "editor" }), makeAppRole({ id: "ar2", name: "read" })];
    userAppRolesFixture = [{ roleId: "ar1" }];
    const html = await (await adminRoutes.request("/users/u2/edit")).text();
    expect(html).toMatch(/value="ar1"[^>]*checked/);
  });

  it("renders the email as plain text for OIDC-linked users", async () => {
    usersFixture = [makeUser({ id: "u2", email: "oidc@b.de" })];
    queue(accounts, [{ id: "a1" }]);
    const html = await (await adminRoutes.request("/users/u2/edit")).text();
    expect(html).toContain("oidc@b.de");
    expect(html).not.toContain('name="email"');
  });

  it("keeps the email input for users without an OIDC link", async () => {
    usersFixture = [makeUser({ id: "u2", email: "local@b.de" })];
    const html = await (await adminRoutes.request("/users/u2/edit")).text();
    expect(html).toContain('name="email"');
  });
});

describe("POST /users", () => {
  it("rejects missing required fields", async () => {
    const res = await adminRoutes.request("/users", { method: "POST", body: formBody({ name: "", email: "" }) });
    expect(res.status).toBe(422);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a duplicate email", async () => {
    usersFixture = [makeUser({ email: "a@b.de" })];
    await adminRoutes.request("/users", { method: "POST", body: formBody({ name: "A", email: "a@b.de" }) });
    expect(insert).not.toHaveBeenCalled();
  });

  it("creates the user and assigns the checked roles", async () => {
    appRolesFixture = [makeAppRole({ id: "ar1", name: "editor" })];
    const res = await adminRoutes.request("/users", { method: "POST", body: formBody({ name: "A", email: "a@b.de", roles: ["ar1"] }) });
    expect(res.status).toBe(302);
    expect(insertCalls.some((c) => c.table === users && c.values.name === "A")).toBe(true);
    expect(insertCalls.some((c) => c.table === userAppRoles && c.values.some((v: any) => v.roleId === "ar1"))).toBe(true);
    expect(res.headers.get("set-cookie")).toMatch(/flash=/);
  });

  it("creates the user with no roles when none are checked", async () => {
    appRolesFixture = [];
    const res = await adminRoutes.request("/users", { method: "POST", body: formBody({ name: "A", email: "a@b.de" }) });
    expect(res.status).toBe(302);
    expect(insertCalls.some((c) => c.table === users)).toBe(true);
    expect(insertCalls.some((c) => c.table === userAppRoles)).toBe(false);
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
    expect(res.status).toBe(422);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a duplicate email on change", async () => {
    queue(users, [makeUser({ email: "old@b.de" })], [makeUser({ id: "other", email: "new@b.de" })]);
    const res = await adminRoutes.request("/users/u2", { method: "POST", body: formBody({ name: "A", email: "new@b.de" }) });
    expect(res.status).toBe(422);
    expect(deleteCalls.some((c) => c.table === accounts)).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("changes the email of a non-OIDC user", async () => {
    queue(users, [makeUser({ email: "old@b.de" })], []);
    const res = await adminRoutes.request("/users/u2", { method: "POST", body: formBody({ name: "A", email: "new@b.de" }) });
    expect(res.status).toBe(302);
    expect(updateCalls.some((c) => c.table === users && c.set.email === "new@b.de")).toBe(true);
  });

  it("ignores a submitted email for OIDC-linked users and keeps the account link", async () => {
    usersFixture = [makeUser({ email: "old@b.de" })];
    queue(accounts, [{ id: "a1" }]);
    const res = await adminRoutes.request("/users/u2", { method: "POST", body: formBody({ name: "A", email: "new@b.de" }) });
    expect(res.status).toBe(302);
    expect(deleteCalls.some((c) => c.table === accounts)).toBe(false);
    expect(updateCalls.some((c) => c.table === users && c.set.email === "old@b.de")).toBe(true);
  });

  it("saves without touching the OIDC link when the email is unchanged", async () => {
    usersFixture = [makeUser({ email: "same@b.de" })];
    const res = await adminRoutes.request("/users/u2", { method: "POST", body: formBody({ name: "A", email: "same@b.de" }) });
    expect(res.status).toBe(302);
    expect(deleteCalls.some((c) => c.table === accounts)).toBe(false);
    expect(updateCalls.some((c) => c.table === users)).toBe(true);
  });

  it("replaces the user's role assignments", async () => {
    usersFixture = [makeUser({ email: "same@b.de" })];
    appRolesFixture = [makeAppRole({ id: "ar1", name: "editor" })];
    const res = await adminRoutes.request("/users/u2", { method: "POST", body: formBody({ name: "A", email: "same@b.de", roles: ["ar1"] }) });
    expect(res.status).toBe(302);
    expect(deleteCalls.some((c) => c.table === userAppRoles)).toBe(true);
    expect(insertCalls.some((c) => c.table === userAppRoles && c.values.some((v: any) => v.roleId === "ar1"))).toBe(true);
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

describe("GET /permissions", () => {
  it("row click leads to the read-only detail page, not directly to edit", async () => {
    appRolesFixture = [makeAppRole()];
    const html = await (await adminRoutes.request("/permissions")).text();
    expect(html).toContain("/admin/permissions/ar1&#39;");
    expect(html).not.toContain("/admin/permissions/ar1/edit&#39;");
  });

  it("locks deletion for a protected role", async () => {
    appRolesFixture = [makeAppRole({ isProtected: true })];
    userAppRolesFixture = [];
    const html = await (await adminRoutes.request("/permissions")).text();
    expect(html).toContain(t("admin.permissions.cannotDelete.protected"));
  });

  it("locks deletion with a singular usage message", async () => {
    appRolesFixture = [makeAppRole()];
    userAppRolesFixture = [{ roleId: "ar1", cnt: 1 }];
    const html = await (await adminRoutes.request("/permissions")).text();
    expect(html).toContain(t("admin.permissions.cannotDelete.usedBySingle", { count: 1 }));
  });

  it("allows deletion when unused and unprotected", async () => {
    appRolesFixture = [makeAppRole()];
    userAppRolesFixture = [];
    const html = await (await adminRoutes.request("/permissions")).text();
    expect(html).toContain(t("admin.permissions.confirmDelete.title"));
  });

  it("renders permission badges for a role", async () => {
    appRolesFixture = [makeAppRole()];
    appRolePermissionsFixture = [{ roleId: "ar1", permission: "members:read" }];
    userAppRolesFixture = [];
    const html = await (await adminRoutes.request("/permissions")).text();
    expect(html).toContain(t("admin.permissions.key.membersRead"));
  });
});

describe("GET /permissions/new", () => {
  it("renders the create-role form without a system:admin checkbox", async () => {
    const html = await (await adminRoutes.request("/permissions/new")).text();
    expect(html).toContain(t("admin.permissions.modal.create"));
    expect(html).not.toContain(t("admin.permissions.key.systemAdmin"));
  });
});

describe("GET /permissions/:id", () => {
  it("404s for an unknown role", async () => {
    appRolesFixture = [];
    expect((await adminRoutes.request("/permissions/nope")).status).toBe(404);
  });

  it("shows the edit link and the permissions", async () => {
    appRolesFixture = [makeAppRole()];
    appRolePermissionsFixture = [{ roleId: "ar1", permission: "members:read" }];
    userAppRolesFixture = [{ cnt: 0 }];
    const html = await (await adminRoutes.request("/permissions/ar1")).text();
    expect(html).toContain("/admin/permissions/ar1/edit");
  });

  it("hides the edit link and offers no delete for a protected role", async () => {
    appRolesFixture = [makeAppRole({ isProtected: true })];
    userAppRolesFixture = [{ cnt: 0 }];
    const html = await (await adminRoutes.request("/permissions/ar1")).text();
    expect(html).not.toContain("/admin/permissions/ar1/edit");
    expect(html).not.toContain("/admin/permissions/ar1/delete");
  });
});

describe("GET /permissions/:id/edit", () => {
  it("404s for an unknown role", async () => {
    appRolesFixture = [];
    expect((await adminRoutes.request("/permissions/nope/edit")).status).toBe(404);
  });

  it("redirects a protected role to its read-only page", async () => {
    appRolesFixture = [makeAppRole({ isProtected: true })];
    userAppRolesFixture = [{ cnt: 0 }];
    const res = await adminRoutes.request("/permissions/ar1/edit");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/permissions/ar1");
    const html = await (await adminRoutes.request("/permissions/ar1")).text();
    expect(html).toContain(t("admin.permissions.readOnlyHint"));
    expect(html).not.toContain("/permissions/ar1/edit");
  });

  it("locks the name field when assignments exist", async () => {
    appRolesFixture = [makeAppRole()];
    userAppRolesFixture = [{ cnt: 2 }];
    const html = await (await adminRoutes.request("/permissions/ar1/edit")).text();
    expect(html).toContain(t("admin.permissions.modal.nameLocked"));
  });

  it("pre-checks the role's current permissions", async () => {
    appRolesFixture = [makeAppRole()];
    userAppRolesFixture = [{ cnt: 0 }];
    appRolePermissionsFixture = [{ permission: "members:read" }];
    const html = await (await adminRoutes.request("/permissions/ar1/edit")).text();
    expect(html).toMatch(/value="members:read"[^>]*checked/);
  });
});

describe("POST /permissions", () => {
  it("requires a name", async () => {
    const res = await adminRoutes.request("/permissions", { method: "POST", body: formBody({ name: "" }) });
    expect(res.status).toBe(422);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a role without any permission", async () => {
    const res = await adminRoutes.request("/permissions", { method: "POST", body: formBody({ name: "Leer" }) });
    expect(res.status).toBe(422);
    expect(insertCalls.some((c) => c.table === appRoles)).toBe(false);
  });

  it("creates the role with its permissions", async () => {
    const res = await adminRoutes.request("/permissions", {
      method: "POST",
      body: formBody({ name: "Kassier", permissions: ["members:read", "members:write"] }),
    });
    expect(res.status).toBe(302);
    expect(insertCalls.some((c) => c.table === appRoles && c.values.name === "Kassier")).toBe(true);
    expect(insertCalls.some((c) => c.table === appRolePermissions)).toBe(true);
  });

  it("silently drops system:admin even if submitted", async () => {
    await adminRoutes.request("/permissions", {
      method: "POST",
      body: formBody({ name: "Kassier", permissions: ["system:admin"] }),
    });
    expect(insertCalls.some((c) => c.table === appRolePermissions)).toBe(false);
  });
});

describe("POST /permissions/:id", () => {
  it("404s for a protected role", async () => {
    appRolesFixture = [makeAppRole({ isProtected: true })];
    expect((await adminRoutes.request("/permissions/ar1", { method: "POST", body: formBody({}) })).status).toBe(404);
  });

  it("requires a name when there are no assignments yet", async () => {
    appRolesFixture = [makeAppRole()];
    userAppRolesFixture = [{ cnt: 0 }];
    const res = await adminRoutes.request("/permissions/ar1", { method: "POST", body: formBody({ name: "" }) });
    expect(res.status).toBe(422);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects removing all permissions from a role", async () => {
    appRolesFixture = [makeAppRole()];
    userAppRolesFixture = [{ cnt: 0 }];
    const res = await adminRoutes.request("/permissions/ar1", { method: "POST", body: formBody({ name: "Neu" }) });
    expect(res.status).toBe(422);
    expect(update).not.toHaveBeenCalled();
  });

  it("updates name and permissions when unused", async () => {
    appRolesFixture = [makeAppRole()];
    userAppRolesFixture = [{ cnt: 0 }];
    const res = await adminRoutes.request("/permissions/ar1", {
      method: "POST",
      body: formBody({ name: "Neu", permissions: ["members:read"] }),
    });
    expect(res.status).toBe(302);
    expect(updateCalls.some((c) => c.table === appRoles && c.set.name === "Neu")).toBe(true);
  });
});

describe("POST /permissions/:id/delete", () => {
  it("refuses to delete a protected role", async () => {
    appRolesFixture = [makeAppRole({ isProtected: true })];
    const res = await adminRoutes.request("/permissions/ar1/delete", { method: "POST" });
    expect(res.headers.get("set-cookie")).toMatch(/flash=/);
    expect(del).not.toHaveBeenCalled();
  });

  it("refuses to delete a role with assignments", async () => {
    appRolesFixture = [makeAppRole()];
    userAppRolesFixture = [{ cnt: 1 }];
    const res = await adminRoutes.request("/permissions/ar1/delete", { method: "POST" });
    expect(res.headers.get("set-cookie")).toMatch(/flash=/);
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes an unused role", async () => {
    appRolesFixture = [makeAppRole()];
    userAppRolesFixture = [{ cnt: 0 }];
    const res = await adminRoutes.request("/permissions/ar1/delete", { method: "POST" });
    expect(res.status).toBe(302);
    expect(deleteCalls.some((c) => c.table === appRoles)).toBe(true);
  });
});

describe("GET /config", () => {
  it("lists env vars with a fallback for unset values", async () => {
    const html = await (await adminRoutes.request("/config")).text();
    expect(html).toContain("ORG_NAME");
    expect(html).toContain("Test Feuerwehr");
    expect(html).toContain("—");
  });

  it("puts the save button in the title row, bound to the form", async () => {
    const html = await (await adminRoutes.request("/config")).text();
    const h1 = html.indexOf("<h1");
    const btn = html.indexOf('id="config-save"');
    const form = html.indexOf('id="config-form"');
    expect(h1).toBeLessThan(btn);
    expect(btn).toBeLessThan(form);
    expect(html).toContain('form="config-form"');
  });

  it("shows no backup warning when healthy", async () => {
    backupStatus = { state: "ok", timestamp: new Date(), lastSuccess: new Date() };
    const html = await (await adminRoutes.request("/config")).text();
    expect(html).not.toContain("Sicherung der Datenbank");
  });

  it("shows the failed backup warning", async () => {
    backupStatus = { state: "failed", timestamp: new Date("2024-01-01T01:00:00Z"), lastSuccess: null };
    const html = await (await adminRoutes.request("/config")).text();
    expect(html).toContain("Sicherung der Datenbank ist fehlgeschlagen");
  });
});

describe("GET /backup", () => {
  const ts = new Date("2024-01-01T01:00:00Z");

  it("shows the not-configured card without banner", async () => {
    const html = await (await adminRoutes.request("/backup")).text();
    expect(html).toContain("Backup-Überwachung nicht eingerichtet");
    expect(html).not.toContain(`alert alert-error`);
  });

  it("shows the unknown card without banner", async () => {
    backupStatus = { state: "unknown", timestamp: null, lastSuccess: null };
    const html = await (await adminRoutes.request("/backup")).text();
    expect(html).toContain("Noch kein Backup-Status");
    expect(html).not.toContain(`alert alert-error`);
  });

  it("shows ok without banner", async () => {
    backupStatus = { state: "ok", timestamp: new Date(), lastSuccess: new Date() };
    const html = await (await adminRoutes.request("/backup")).text();
    expect(html).toContain("Backup aktuell");
    expect(html).not.toContain(`alert alert-error`);
  });

  it("shows a banner when failed", async () => {
    backupStatus = { state: "failed", timestamp: ts, lastSuccess: null };
    const html = await (await adminRoutes.request("/backup")).text();
    expect(html).toContain("fehlgeschlagen");
    expect(html).toContain("Sicherung der Datenbank ist fehlgeschlagen");
    expect(html).toContain("Server betreibt");
  });

  it("shows a banner when stale", async () => {
    backupStatus = { state: "stale", timestamp: ts, lastSuccess: ts };
    const html = await (await adminRoutes.request("/backup")).text();
    expect(html).toContain("keine erfolgreiche Sicherung");
    expect(html).toContain("Server betreibt");
  });
});

describe("permissionSearchText", () => {
  it("finds permissions by key and German label", async () => {
    const { permissionSearchText } = await import("../routes/admin.js");
    const txt = permissionSearchText(["members:read", "members:bank-data:read"]);
    expect(txt).toContain("members:read");
    expect(txt).toContain("bankdaten");
  });
});

// Guards the duplicated grouping logic: the inline script in EffectivePermissions must
// render the same badges as the server-side groupPermissionsForBadges.
describe("effective permissions inline script", () => {
  it("matches groupPermissionsForBadges for several role combinations", async () => {
    const { PERMISSIONS, groupPermissionsForBadges } = await import("../lib/roles.js");
    const res0 = PERMISSIONS[0].split(":")[0];
    const resPerms = PERMISSIONS.filter((p) => p.split(":")[0] === res0);
    const roleDefs: Record<string, string[]> = { all: [...PERMISSIONS], res: resPerms, one: [PERMISSIONS[PERMISSIONS.length - 1]], none: [] };
    appRolesFixture = Object.keys(roleDefs).map((id) => makeAppRole({ id, name: id }));
    appRolePermissionsFixture = Object.entries(roleDefs).flatMap(([roleId, ps]) => ps.map((permission) => ({ roleId, permission })));
    const html = await (await adminRoutes.request("/users/new")).text();
    const json = html.match(/<script type="application\/json">(.*?)<\/script>/s)![1];
    const code = html.match(/<script>(\(function\(\)\{var s=document\.currentScript.*?)<\/script>/s)![1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const cfg = JSON.parse(json.replace(/&quot;/g, '"').replace(/&amp;/g, "&"));

    for (const combo of [["all"], ["res"], ["one"], ["res", "one"], ["none"], []]) {
      let listener: (e: any) => void = () => {};
      const out: { className: string; textContent: string }[] = [];
      const outEl = { replaceChildren: () => (out.length = 0), append: (e: any) => out.push(e) };
      const form = {
        querySelectorAll: () => combo.map((value) => ({ value })),
        addEventListener: (_: string, fn: any) => (listener = fn),
      };
      const box = { parentElement: null, closest: () => form, querySelector: () => outEl };
      const script = { previousElementSibling: { textContent: json.replace(/&quot;/g, '"').replace(/&amp;/g, "&") }, parentElement: box };
      new Function("document", code)({ currentScript: script, createElement: () => ({ className: "", textContent: "" }) });
      listener({ target: { name: "roles" } });

      const perms = [...new Set(combo.flatMap((id) => roleDefs[id]))] as any[];
      const expected = groupPermissionsForBadges(perms).map((g) =>
        g.kind === "full" ? t("admin.permissions.badge.full")
        : g.kind === "resource-full" ? t("admin.permissions.badge.resourceFull", { resource: cfg.resources[g.resource] ?? g.resource })
        : cfg.labels[g.permission]);
      expect(out.map((e) => e.textContent)).toEqual(expected);
    }
  });
});
