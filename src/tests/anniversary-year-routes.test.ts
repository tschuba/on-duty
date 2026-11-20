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

const transaction = vi.fn(async (fn: any) => fn({ select, insert, update, delete: del }));

vi.mock("../db/index.js", () => ({
  db: { select, insert, update, delete: del, transaction },
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

const { yearRoutes: yearRoutes } = await import("../routes/anniversary-years.js");
const { anniversaryRoutes } = await import("../routes/anniversaries.js");
// Die Liste lebt auf /anniversaries?view=years; /anniversary-years leitet nur um.
const yearsList = (qs = "") => anniversaryRoutes.request(`/?view=years${qs ? `&${qs}` : ""}`);

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

// ── Pure logic ───────────────────────────────────────────────────────────────

describe("GET /anniversaries?view=years", () => {
  it("shows the empty state", async () => {
    yearsFixture = [];
    expect(await (await yearsList()).text()).toContain(t("admin.anniversaries.empty"));
  });

  it("renders one row per year with a badge per kind and its delete confirmation", async () => {
    yearsFixture = [makeYear({ year: 25, title: "Silber" }), makeYear({ kind: "membership", year: 25, title: "Silber" })];
    const html = await (await yearsList()).text();
    expect(html.match(/<tr[^>]*hx-get="\/anniversary-years\/25\/edit"/g)).toHaveLength(1);
    expect(html).toContain("badge-primary");
    expect(html).toContain("badge-secondary");
    expect(html).toContain(t("admin.anniversaries.confirmDelete.body", { year: "25" }));
  });

  it("marks kinds without a title as outline badges", async () => {
    yearsFixture = [makeYear({ year: 25, title: "Silber" }), makeYear({ kind: "membership", year: 25, title: null })];
    const html = await (await yearsList()).text();
    expect(html).toContain(`Dienst, ${t("admin.anniversaries.badge.withTitle")}`);
    expect(html).toContain(`Mitgliedschaft, ${t("admin.anniversaries.badge.noTitle")}`);
    expect(html).toContain("badge-secondary badge-outline");
    expect(html).not.toContain("badge-primary badge-outline");
  });

  it("shows differing titles per kind", async () => {
    yearsFixture = [makeYear({ year: 25, title: "Dienst25" }), makeYear({ kind: "membership", year: 25, title: "Mitgl25" })];
    const html = await (await yearsList()).text();
    expect(html).toContain("Dienst: Dienst25");
    expect(html).toContain("Mitgliedschaft: Mitgl25");
  });

  it("filters rows by kind", async () => {
    yearsFixture = [makeYear({ kind: "service", year: 25, title: "Dienst25" }), makeYear({ kind: "membership", year: 10, title: "Mitgl10" })];
    const html = await (await yearsList("kind=membership")).text();
    expect(html).toContain("Mitgl10");
    expect(html).not.toContain("Dienst25");
    expect(await (await yearsList("kind=bogus")).text()).toContain("Dienst25");
  });

  it("sorts by year descending and ignores bogus sort values", async () => {
    yearsFixture = [makeYear({ year: 10, title: "Aa" }), makeYear({ year: 50, title: "Zz" })];
    const html = await (await yearsList("sort=year&dir=desc")).text();
    expect(html.indexOf("Zz")).toBeLessThan(html.indexOf("Aa"));
    const bogus = await (await yearsList("sort=x")).text();
    expect(bogus.indexOf("Aa")).toBeLessThan(bogus.indexOf("Zz"));
  });
});

describe("GET /anniversary-years/new and /:year/edit", () => {
  it("renders the create form with both toggles on", async () => {
    const res = await yearRoutes.request("/new");
    expect(res.status).toBe(200);
    expect((await res.text()).match(/data-kind=[^>]*checked/g)).toHaveLength(2);
  });

  it("404s for an unknown year", async () => {
    yearsFixture = [];
    expect((await yearRoutes.request("/99/edit")).status).toBe(404);
  });

  it("renders the edit form with only the existing kinds on", async () => {
    yearsFixture = [makeYear({ year: 25, title: "Silber" })];
    const html = await (await yearRoutes.request("/25/edit")).text();
    expect(html).toContain("Silber");
    expect(html.match(/data-kind=[^>]*checked/g)).toHaveLength(1);
  });
});

describe("POST /anniversary-years", () => {
  const post = (b: Record<string, string>) => yearRoutes.request("/", { method: "POST", body: formBody(b) });
  it.each([0, -1, 300])("rejects an out-of-range year (%d)", async (year) => {
    expect((await post({ service: "1", year: String(year) })).status).toBe(302);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects when no kind is selected", async () => {
    await post({ year: "25" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("creates one row per selected kind with its own title", async () => {
    await post({ year: "25", service: "1", membership: "1", title_service: "Silber", title_membership: "" });
    const rows = insertCalls.find((c) => c.table === anniversaryYears)!.values;
    expect(rows).toEqual([{ kind: "service", year: 25, title: "Silber" }, { kind: "membership", year: 25, title: null }]);
  });

  it("rejects an already-used year", async () => {
    yearsFixture = [makeYear({ year: 25 })];
    await post({ year: "25", service: "1" });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("POST /anniversary-years/:year", () => {
  const post = (y: number, b: Record<string, string>) => yearRoutes.request(`/${y}`, { method: "POST", body: formBody(b) });
  it("404s for an unknown year", async () => {
    yearsFixture = [];
    expect((await post(10, { year: "10", service: "1" })).status).toBe(404);
  });

  it("rejects an out-of-range year or empty kind selection", async () => {
    yearsFixture = [makeYear({ year: 10 })];
    await post(10, { year: "0", service: "1" });
    await post(10, { year: "10" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("replaces the rows of the year", async () => {
    yearsFixture = [makeYear({ year: 10 })];
    const res = await post(10, { year: "10", membership: "1", title_membership: "Neu" });
    expect(res.status).toBe(302);
    expect(deleteCalls.some((c) => c.table === anniversaryYears)).toBe(true);
    expect(insertCalls.find((c) => c.table === anniversaryYears)!.values).toEqual([{ kind: "membership", year: 10, title: "Neu" }]);
  });

  it("rejects renaming onto an already-used year", async () => {
    queue(anniversaryYears, [makeYear({ year: 10 })], [makeYear({ year: 20 })]);
    await post(10, { year: "20", service: "1" });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("POST /anniversary-years/:year/delete", () => {
  it("deletes the year and redirects", async () => {
    const res = await yearRoutes.request("/10/delete", { method: "POST" });
    expect(res.status).toBe(302);
    expect(deleteCalls.some((c) => c.table === anniversaryYears)).toBe(true);
  });
});

describe("anniversary-year permissions", () => {
  it("hides anniversary-year write and delete controls without those permissions", async () => {
    yearsFixture = [{ kind: "service", year: 25, title: null }];
    currentUser = { id: "u1", disabled: false, permissions: new Set(["anniversary-years:read"]) };
    const ro = await (await yearsList()).text();
    expect(ro).not.toContain(t("admin.anniversaries.newYear"));
    expect(ro).not.toContain("/edit");
    expect(ro).not.toContain("delete-year-");
    currentUser = { id: "u1", disabled: false, permissions: new Set(["anniversary-years:read", "anniversary-years:write", "anniversary-years:delete"]) };
    const rw = await (await yearsList()).text();
    expect(rw).toContain(t("admin.anniversaries.newYear"));
    expect(rw).toContain("delete-year-");
  });
});

describe("GET /anniversaries?view=years toggle filter", () => {
  const toggleInputs = (html: string) => html.match(/<input[^>]*class="toggle toggle-primary"[^>]*data-href[^>]*>/g) ?? [];
  it("both toggles on without a parameter, no \"Alle\" entry", async () => {
    const html = await (await yearsList()).text();
    const inputs = toggleInputs(html);
    expect(inputs).toHaveLength(2);
    expect(inputs.filter((i) => i.includes("checked"))).toHaveLength(2);
    expect(inputs.filter((i) => i.includes("disabled"))).toHaveLength(0);
    expect(html).not.toContain(">Alle<");
  });

  it("a single active toggle (old link) is checked; switching it off activates the other", async () => {
    for (const [qs, idx] of [["?kind=service", 0], ["?kind=membership", 1]] as const) {
      const inputs = toggleInputs(await (await yearsList(qs.slice(1))).text());
      expect(inputs.filter((i) => i.includes("checked"))).toHaveLength(1);
      expect(inputs[idx]).toContain("checked");
      expect(inputs[idx]).not.toContain("disabled");
      expect(inputs[idx]).toContain(["kind=service", "kind=membership"][1 - idx]);
      expect(inputs[1 - idx]).not.toContain("checked");
    }
  });
});

describe("GET /anniversary-years (legacy)", () => {
  it("redirects to the combined page and keeps the query", async () => {
    const res = await yearRoutes.request("/?kind=service&sort=year");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/anniversaries?kind=service&sort=year&view=years");
  });
});
