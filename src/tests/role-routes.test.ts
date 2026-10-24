import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  users,
  sessions,
  accounts,
  memberRoles,
  memberRoleTypes,
  memberRoleAssignments,
  anniversaryYears,
  backupHistory,
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
let backupHistoryFixture: any[] = [];
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
    if (table === backupHistory) return chainOf(nextRows(backupHistory, backupHistoryFixture));
    if (table === appRoles) return chainOf(nextRows(appRoles, appRolesFixture));
    if (table === appRolePermissions) return chainOf(nextRows(appRolePermissions, appRolePermissionsFixture));
    if (table === userAppRoles) return chainOf(nextRows(userAppRoles, userAppRolesFixture));
    if (table === orgConfig) return chainOf(nextRows(orgConfig, orgConfigFixture));
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

let backupConfigured = false;
let lastBackupResult: any = null;
let scheduleResult: { prev: Date | null; next: Date | null } = { prev: null, next: null };
const runBackupMock = vi.fn(() => Promise.resolve());

// Layout badge count is a separate DB query; keep it out of the per-route select-call assertions.
vi.mock("../lib/registration.js", async (orig) => ({ ...(await orig<typeof import("../lib/registration.js")>()), countPendingUsers: async () => 0 }));

vi.mock("../lib/backup.js", () => ({
  isBackupConfigured: () => backupConfigured,
  getLastBackup: () => Promise.resolve(lastBackupResult),
  getCronScheduleTimes: () => scheduleResult,
  runBackup: () => runBackupMock(),
}));

const { roleRoutes } = await import("../routes/roles.js");

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
  backupHistoryFixture = [];
  appRolesFixture = [];
  appRolePermissionsFixture = [];
  userAppRolesFixture = [];
  orgConfigFixture = [];
  currentUser = { id: "u1", disabled: false, permissions: new Set(["system:admin", "member-roles:read", "member-roles:write", "member-roles:delete", "member-role-types:read", "member-role-types:write", "member-role-types:delete", "anniversary-years:read", "anniversary-years:write", "anniversary-years:delete"]) };
  backupConfigured = false;
  lastBackupResult = null;
  scheduleResult = { prev: null, next: null };
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

// ── Pure logic ───────────────────────────────────────────────────────────────

describe("GET /roles", () => {
  it("renders the unfiltered, active and passive views", async () => {
    rolesFixture = [makeRoleRow()];
    for (const qs of ["", "?active=1", "?active=0"]) {
      expect((await roleRoutes.request(`/roles${qs}`)).status).toBe(200);
    }
  });

  it("locks deletion for a protected role", async () => {
    rolesFixture = [makeRoleRow({ isProtected: true })];
    const html = await (await roleRoutes.request("/roles")).text();
    expect(html).toContain(t("admin.roles.cannotDelete.protected"));
  });

  it("locks deletion with a singular usage message", async () => {
    rolesFixture = [makeRoleRow({ assignmentCount: 1 })];
    const html = await (await roleRoutes.request("/roles")).text();
    expect(html).toContain(t("admin.roles.cannotDelete.usedBySingle", { count: 1 }));
  });

  it("locks deletion with a plural usage message", async () => {
    rolesFixture = [makeRoleRow({ assignmentCount: 3 })];
    const html = await (await roleRoutes.request("/roles")).text();
    expect(html).toContain(t("admin.roles.cannotDelete.usedByMultiple", { count: 3 }));
  });

  it("allows deletion when unused and unprotected", async () => {
    rolesFixture = [makeRoleRow({ assignmentCount: 0 })];
    const html = await (await roleRoutes.request("/roles")).text();
    expect(html).toContain(t("admin.roles.confirmDelete.title"));
  });
});

describe("GET /roles/new", () => {
  it("renders the create-role form", async () => {
    expect((await roleRoutes.request("/roles/new")).status).toBe(200);
  });
});

describe("GET /roles/:id/edit", () => {
  it("404s for an unknown role", async () => {
    rolesFixture = [];
  typesFixture = [makeType()];
    expect((await roleRoutes.request("/roles/nope/edit")).status).toBe(404);
  });

  it("renders a protected role read-only", async () => {
    rolesFixture = [makeRole({ isProtected: true })];
    const res = await roleRoutes.request("/roles/r1/edit");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<fieldset disabled");
    expect(html).toContain(t("admin.permissions.readOnlyHint"));
    expect(html).not.toContain(t("common.save"));
  });

  it("locks the name field when assignments exist", async () => {
    rolesFixture = [makeRole()];
    assignmentCountFixture = [{ cnt: 2 }];
    const html = await (await roleRoutes.request("/roles/r1/edit")).text();
    expect(html).toContain(t("admin.roles.modal.nameLocked"));
  });

  it("keeps the name field editable with no assignments", async () => {
    rolesFixture = [makeRole({ grantsActiveStatus: false })];
    assignmentCountFixture = [{ cnt: 0 }];
    const html = await (await roleRoutes.request("/roles/r1/edit")).text();
    expect(html).not.toContain(t("admin.roles.modal.nameLocked"));
  });
});

describe("POST /roles", () => {
  it("requires a title", async () => {
    const res = await roleRoutes.request("/roles", { method: "POST", body: formBody({ title: "" }) });
    expect(res.status).toBe(302);
    expect(insert).not.toHaveBeenCalled();
  });

  it("creates the role", async () => {
    const res = await roleRoutes.request("/roles", { method: "POST", body: formBody({ title: "Kassier", typeId: "t1", grantsActiveStatus: "1" }) });
    expect(res.status).toBe(302);
    expect(insertCalls.some((c) => c.table === memberRoles && c.values.grantsActiveStatus === true)).toBe(true);
  });
});

describe("POST /roles/:id", () => {
  it("404s for an unknown role", async () => {
    rolesFixture = [];
  typesFixture = [makeType()];
    expect((await roleRoutes.request("/roles/nope", { method: "POST", body: formBody({}) })).status).toBe(404);
  });

  it("404s for a protected role", async () => {
    rolesFixture = [makeRole({ isProtected: true })];
    expect((await roleRoutes.request("/roles/r1", { method: "POST", body: formBody({}) })).status).toBe(404);
  });

  it("requires a title when there are no assignments yet", async () => {
    rolesFixture = [makeRole()];
    assignmentCountFixture = [{ cnt: 0 }];
    const res = await roleRoutes.request("/roles/r1", { method: "POST", body: formBody({ title: "" }) });
    expect(res.status).toBe(302);
    expect(update).not.toHaveBeenCalled();
  });

  it("updates title and status when unused", async () => {
    rolesFixture = [makeRole()];
    assignmentCountFixture = [{ cnt: 0 }];
    const res = await roleRoutes.request("/roles/r1", { method: "POST", body: formBody({ title: "Neu", typeId: "t1", grantsActiveStatus: "1" }) });
    expect(res.status).toBe(302);
    expect(updateCalls.some((c) => c.table === memberRoles && c.set.title === "Neu")).toBe(true);
  });

  it("only updates the active-status flag when the role is in use", async () => {
    rolesFixture = [makeRole()];
    assignmentCountFixture = [{ cnt: 5 }];
    const res = await roleRoutes.request("/roles/r1", { method: "POST", body: formBody({ grantsActiveStatus: "1" }) });
    expect(res.status).toBe(302);
    expect(updateCalls.some((c) => c.table === memberRoles && !("title" in c.set))).toBe(true);
  });
});

describe("POST /roles/:id/delete", () => {
  it("silently redirects for an unknown role", async () => {
    rolesFixture = [];
  typesFixture = [makeType()];
    const res = await roleRoutes.request("/roles/nope/delete", { method: "POST" });
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(del).not.toHaveBeenCalled();
  });

  it("refuses to delete a protected role", async () => {
    rolesFixture = [makeRole({ isProtected: true })];
    const res = await roleRoutes.request("/roles/r1/delete", { method: "POST" });
    expect(res.headers.get("set-cookie")).toMatch(/flash=/);
    expect(del).not.toHaveBeenCalled();
  });

  it("refuses to delete a role with assignments", async () => {
    rolesFixture = [makeRole()];
    assignmentCountFixture = [{ cnt: 1 }];
    const res = await roleRoutes.request("/roles/r1/delete", { method: "POST" });
    expect(res.headers.get("set-cookie")).toMatch(/flash=/);
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes an unused role", async () => {
    rolesFixture = [makeRole()];
    assignmentCountFixture = [{ cnt: 0 }];
    const res = await roleRoutes.request("/roles/r1/delete", { method: "POST" });
    expect(res.status).toBe(302);
    expect(deleteCalls.some((c) => c.table === memberRoles)).toBe(true);
  });
});

describe("role types (Spec 47)", () => {
  const post = (path: string, fields: Record<string, string>) => roleRoutes.request(path, { method: "POST", body: formBody(fields) });

  it("rejects the active flag on a type that does not allow it (400)", async () => {
    typesFixture = [makeType({ allowsActiveStatus: false })];
    expect((await post("/roles", { title: "X", typeId: "t1", grantsActiveStatus: "1" })).status).toBe(400);
    rolesFixture = [makeRole()];
    expect((await post("/roles/r1", { title: "X", typeId: "t1", grantsActiveStatus: "1" })).status).toBe(400);
    expect(updateCalls.some((c) => c.table === memberRoles)).toBe(false);
  });

  it("rejects removing allows_active_status while roles carry the flag", async () => {
    typesFixture = [makeType()];
    queue(memberRoles, [makeRole()]);
    const res = await post("/role-types/t1", { name: "Dienstgrad" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Vorstand");
    expect(updateCalls.some((c) => c.table === memberRoleTypes)).toBe(false);
  });

  it("refuses to delete a non-empty type, lists its roles", async () => {
    queue(memberRoles, [makeRole()]);
    const res = await post("/role-types/t1/delete", {});
    expect(res.status).toBe(400);
    expect(deleteCalls.some((c) => c.table === memberRoleTypes)).toBe(false);
  });

  it("refuses to delete a protected type", async () => {
    typesFixture = [makeType({ isProtected: true })];
    expect((await post("/role-types/t1/delete", {})).status).toBe(400);
  });

  it("deletes an empty, unprotected type", async () => {
    queue(memberRoles, []);
    expect((await post("/role-types/t1/delete", {})).status).toBe(302);
    expect(deleteCalls.some((c) => c.table === memberRoleTypes)).toBe(true);
  });

  it("reorder rejects ids that are not a permutation of the type's roles", async () => {
    queue(memberRoles, [makeRole()], [makeRole(), makeRole({ id: "r2" })]);
    expect((await roleRoutes.request("/roles/reorder", { method: "POST", body: formBody({ id: "r1" }) })).status).toBe(400);
  });

  it("shows roles or types depending on the tab", async () => {
    rolesFixture = [makeRoleRow()];
    const roles = await (await roleRoutes.request("/roles")).text();
    expect(roles).toContain(t("admin.roles.newRole"));
    expect(roles).not.toContain(t("admin.roleTypes.new"));
    const types = await (await roleRoutes.request("/role-types")).text();
    expect(types).toContain(t("admin.roleTypes.new"));
    expect(types).not.toContain(t("admin.roles.newRole"));
  });

  it("shows short active-allowed header with full text as title", async () => {
    const types = await (await roleRoutes.request("/role-types")).text();
    expect(types).toContain(`title="${t("admin.roleTypes.table.allowsActiveLong")}"`);
    expect(types).toContain(`>${t("admin.roleTypes.table.allowsActive")}</th>`);
  });

  it("renders one collapsible section per type", async () => {
    typesFixture = [makeType(), makeType({ id: "t2", name: "Verein", sortOrder: 2 })];
    rolesFixture = [makeRoleRow()];
    const html = await (await roleRoutes.request("/roles")).text();
    expect(html.match(/<details[^>]*data-section=/g)?.length).toBe(2);
  });

  it("toggles the active flag from the list, but not on types that forbid it", async () => {
    rolesFixture = [makeRole({ grantsActiveStatus: false })];
    const ok = await post("/roles/r1/active", { grantsActiveStatus: "1" });
    expect(ok.status).toBe(302);
    expect(updateCalls.some((c) => c.table === memberRoles && c.set.grantsActiveStatus === true)).toBe(true);
    updateCalls.length = 0;
    typesFixture = [makeType({ allowsActiveStatus: false })];
    expect((await post("/roles/r1/active", { grantsActiveStatus: "1" })).status).toBe(400);
    expect(updateCalls.length).toBe(0);
  });

  it("toggles allows_active_status on a type, blocked while flagged roles exist", async () => {
    queue(memberRoles, []);
    expect((await post("/role-types/t1/allows-active", {})).status).toBe(302);
    expect(updateCalls.some((c) => c.table === memberRoleTypes && c.set.allowsActiveStatus === false)).toBe(true);
    updateCalls.length = 0;
    queue(memberRoles, [makeRole()]);
    expect((await post("/role-types/t1/allows-active", {})).status).toBe(400);
    expect(updateCalls.length).toBe(0);
  });

  it("shows the type description as section subheading and saves it trimmed", async () => {
    typesFixture = [makeType({ description: "Rang in der Wehr" })];
    rolesFixture = [makeRoleRow()];
    expect(await (await roleRoutes.request("/roles")).text()).toContain("Rang in der Wehr");
    await post("/role-types/t1", { name: "Dienstgrad", allowsActiveStatus: "1", description: "  Neu  " });
    expect(updateCalls.some((c) => c.table === memberRoleTypes && c.set.description === "Neu")).toBe(true);
    await post("/role-types", { name: "X", description: "  " });
    expect(insertCalls.some((c) => c.table === memberRoleTypes && c.values.description === null)).toBe(true);
  });

  it("hides write and delete controls without those permissions", async () => {
    typesFixture = [makeType()];
    rolesFixture = [makeRoleRow()];
    currentUser = { id: "u1", disabled: false, permissions: new Set(["member-roles:read"]) };
    const roles = await (await roleRoutes.request("/roles")).text();
    expect(roles).not.toContain(t("admin.roles.newRole"));
    expect(roles).not.toContain("/roles/r1/edit");
    expect(roles).not.toContain("/roles/r1/move");
    expect(roles).not.toContain("/roles/r1/delete");
    currentUser = { id: "u1", disabled: false, permissions: new Set(["member-roles:read", "member-roles:write"]) };
    const writer = await (await roleRoutes.request("/roles")).text();
    expect(writer).toContain(t("admin.roles.newRole"));
    expect(writer).not.toContain("/roles/r1/delete");
  });


  it("role types have their own permissions, independent of roles", async () => {
    typesFixture = [makeType()];
    currentUser = { id: "u1", disabled: false, permissions: new Set(["member-role-types:read"]) };
    const ro = await (await roleRoutes.request("/role-types")).text();
    expect(ro).not.toContain(t("admin.roleTypes.new"));
    expect(ro).not.toContain("/role-types/t1/edit");
    expect(ro).not.toContain("delete-type-");
    currentUser = { id: "u1", disabled: false, permissions: new Set(["member-roles:read", "member-roles:write", "member-roles:delete", "member-role-types:read", "member-role-types:write", "member-role-types:delete"]) };
    const rw = await (await roleRoutes.request("/role-types")).text();
    expect(rw).toContain(t("admin.roleTypes.new"));
  });
});

describe("GET /roles toggle filter", () => {
  const toggleInputs = (html: string) => html.match(/<input[^>]*class="toggle toggle-primary"[^>]*data-href[^>]*>/g) ?? [];
  it("both toggles on without a parameter, no \"Alle\" entry", async () => {
    rolesFixture = [makeRoleRow()];
    const html = await (await roleRoutes.request("/roles")).text();
    const inputs = toggleInputs(html);
    expect(inputs).toHaveLength(2);
    expect(inputs.filter((i) => i.includes("checked"))).toHaveLength(2);
    expect(inputs.filter((i) => i.includes("disabled"))).toHaveLength(0);
    expect(html).not.toContain(">Alle<");
  });

  it("a single active toggle (old link) is checked and disabled", async () => {
    rolesFixture = [makeRoleRow()];
    for (const [qs, idx] of [["?active=1", 0], ["?active=0", 1]] as const) {
      const inputs = toggleInputs(await (await roleRoutes.request(`/roles${qs}`)).text());
      expect(inputs.filter((i) => i.includes("checked"))).toHaveLength(1);
      expect(inputs[idx]).toContain("checked");
      expect(inputs[idx]).toContain("disabled");
      expect(inputs[1 - idx]).not.toContain("checked");
    }
  });
});
