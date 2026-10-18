import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { members, persons, memberRoles, memberRoleAssignments, applications, applicationGuardians, donors, inventoryItemAssignments } from "../db/schema/index.js";
import { t } from "../i18n/index.js";
import { formBody } from "./test-utils.js";

process.env.CHILDREN_AGE_LIMIT = "12";
process.env.YOUTH_AGE_LIMIT = "18";
process.env.ORG_NAME = "Test Feuerwehr";

// ── DB chain-stub helpers ───────────────────────────────────────────────────
// Thin stubs matching the exact chain shapes members.tsx uses. No predicate
// interpretation: `.where()`/`.orderBy()`/`.innerJoin()` just re-return the
// same canned rows — filtering by search/id is Drizzle's job, not ours.

function chainOf(rows: unknown) {
  const chain: any = Object.assign(Promise.resolve(rows), {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
  });
  return chain;
}

let rolesFixture: any[] = [];
let assignmentRowsFixture: any[] = []; // export: pre-joined {memberId, roleTitle, from, to}
let findManyResult: any[] = [];
let findFirstResult: any = undefined;
let personLookupResult: any[] = []; // db.select().from(persons).where(...) — GET/POST /new personId linking
let memberLookupResult: any[] = []; // db.select().from(members).where(...) — "already a member" guard / linkMemberId target lookup
let applicationFindFirstResult: any = undefined; // db.query.applications.findFirst(...) — linkMemberId prefill
let donorLookupResult: any[] = []; // db.select().from(donors).where(...) — delete blocking check
let inventoryAssignmentRowsFixture: { quantity: number }[] = []; // db.select().from(inventoryItemAssignments).where(...) — delete confirmation count
let applicationLookupResult: any[] = []; // db.select().from(applications).where(...) — delete blocking check
let applicationGuardianLookupResult: any[] = []; // db.select().from(applicationGuardians).where(...) — delete blocking check

const insertCalls: { table: any; values: any }[] = [];
const updateCalls: { table: any; set: any }[] = [];
const deleteCalls: { table: any }[] = [];

const select = vi.fn(() => ({
  from: vi.fn((table: any) => {
    if (table === memberRoles) return chainOf(rolesFixture);
    if (table === memberRoleAssignments) return chainOf(assignmentRowsFixture);
    if (table === persons) return chainOf(personLookupResult);
    if (table === members) return chainOf(memberLookupResult);
    if (table === donors) return chainOf(donorLookupResult);
    if (table === inventoryItemAssignments) return chainOf(inventoryAssignmentRowsFixture);
    if (table === applications) return chainOf(applicationLookupResult);
    if (table === applicationGuardians) return chainOf(applicationGuardianLookupResult);
    return chainOf([]);
  }),
}));

function makeInsert() {
  return vi.fn((table: any) => ({
    values: vi.fn((vals: any) => {
      insertCalls.push({ table, values: vals });
      const row = { id: "new-id", ...vals };
      return Object.assign(Promise.resolve(undefined), {
        returning: vi.fn(() => Promise.resolve([row])),
      });
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
const transaction = vi.fn(async (cb: any) => cb({ insert, update, delete: del }));

vi.mock("../db/index.js", () => ({
  db: {
    query: {
      members: {
        findMany: vi.fn(() => Promise.resolve(findManyResult)),
        findFirst: vi.fn(() => Promise.resolve(findFirstResult)),
      },
      memberRoles: {
        findMany: vi.fn(() => Promise.resolve(rolesFixture)),
      },
      applications: {
        findFirst: vi.fn(() => Promise.resolve(applicationFindFirstResult)),
      },
    },
    select,
    insert,
    update,
    delete: del,
    transaction,
  },
}));

let currentUser = { id: "u1", permissions: new Set(["members:write"]), disabled: false };

vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => async (c: any, next: any) => {
    c.set("user", currentUser);
    await next();
  },
}));

const {
  memberRoutes,
  sortMembers,
  parseListQuery,
  buildExportSheets,
  StatsCards,
  MembersTable,
  SortIcon,
} = await import("../routes/members.js");

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  rolesFixture = [];
  assignmentRowsFixture = [];
  findManyResult = [];
  findFirstResult = undefined;
  personLookupResult = [];
  memberLookupResult = [];
  applicationFindFirstResult = undefined;
  donorLookupResult = [];
  inventoryAssignmentRowsFixture = [];
  applicationLookupResult = [];
  applicationGuardianLookupResult = [];
  currentUser = { id: "u1", permissions: new Set(["members:write"]), disabled: false };
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const roleAktiv = { id: "role-aktiv", title: "Aktives Mitglied", grantsActiveStatus: true, isProtected: false };
const roleVorstand = { id: "role-vorstand", title: "Vorstand", grantsActiveStatus: true, isProtected: true };

function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    personId: "p1",
    lastName: "Bauer",
    firstName: "Anna",
    street: null,
    houseNumber: null,
    zip: null,
    city: null,
    gender: null,
    birthDate: "1985-05-01",
    entryDate: "2010-01-01",
    exitDate: null,
    deathDate: null,
    iban: null,
    bic: null,
    accountHolder: null,
    phone: null,
    email: null,
    ...overrides,
  };
}

function makeAssignment(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    memberId: "m1",
    memberRoleId: roleAktiv.id,
    from: "2010-01-01",
    to: null,
    autoClosed: false,
    role: roleAktiv,
    ...overrides,
  };
}

function memberWithAssignments(overrides: Record<string, unknown> = {}, assignments = [makeAssignment()]) {
  return { ...makeMember(overrides), assignments };
}

// ── Pure functions ───────────────────────────────────────────────────────────

describe("sortMembers", () => {
  const withStatus = (m: ReturnType<typeof memberWithAssignments>) => ({
    ...m,
    status: "aktiv" as const,
  });
  const a = withStatus(memberWithAssignments({ id: "1", lastName: "Bauer", firstName: "Anna", birthDate: "1990-01-01", entryDate: "2015-01-01" }));
  const b = withStatus(memberWithAssignments({ id: "2", lastName: "Adler", firstName: "Ben", birthDate: "1980-01-01", entryDate: "2020-01-01" }));
  const c = withStatus(memberWithAssignments({ id: "3", lastName: "Bauer", firstName: "Chris", birthDate: "1970-01-01", entryDate: "2005-01-01" }));

  it("sorts by lastName asc, tie-broken by firstName", () => {
    const sorted = sortMembers([a, c, b], "lastName", "asc");
    expect(sorted.map((m) => m.id)).toEqual(["2", "1", "3"]);
  });

  it("reverses order for desc", () => {
    const sorted = sortMembers([a, c, b], "lastName", "desc");
    expect(sorted.map((m) => m.id)).toEqual(["3", "1", "2"]);
  });

  it("sorts by a date key (birthDate)", () => {
    const sorted = sortMembers([a, c, b], "birthDate", "asc");
    expect(sorted.map((m) => m.id)).toEqual(["3", "2", "1"]);
  });

  it("treats a missing birthDate as sorting first", () => {
    const noBirthDate = withStatus(memberWithAssignments({ id: "4", lastName: "Zorn", firstName: "Zoe", birthDate: null as any, entryDate: "2015-01-01" }));
    const sorted = sortMembers([a, noBirthDate], "birthDate", "asc");
    expect(sorted.map((m) => m.id)).toEqual(["4", "1"]);
  });
});

describe("parseListQuery", () => {
  it("applies defaults when nothing is set", () => {
    expect(parseListQuery({}, [], [])).toEqual({
      search: "",
      sort: "lastName",
      dir: "asc",
      statusFilter: ["aktiv", "passiv", "kinder", "jugend"],
      roleFilter: [],
      page: 1,
      pageSize: 25,
    });
  });

  it("keeps repeated status/role params as-is", () => {
    const q = parseListQuery({}, ["aktiv", "jugend"], ["r1", "r2"]);
    expect(q.statusFilter).toEqual(["aktiv", "jugend"]);
    expect(q.roleFilter).toEqual(["r1", "r2"]);
  });

  it("clamps page to at least 1 and rejects invalid pageSize", () => {
    expect(parseListQuery({ page: "0" }, [], []).page).toBe(1);
    expect(parseListQuery({ page: "-5" }, [], []).page).toBe(1);
    expect(parseListQuery({ pageSize: "7" }, [], []).pageSize).toBe(25);
    expect(parseListQuery({ pageSize: "50" }, [], []).pageSize).toBe(50);
  });

  it("reads search, sort and dir", () => {
    const q = parseListQuery({ search: "an", sort: "birthDate", sort_dir: "desc" }, [], []);
    expect(q.search).toBe("an");
    expect(q.sort).toBe("birthDate");
    expect(q.dir).toBe("desc");
  });
});

describe("buildExportSheets", () => {
  it("never leaks bank data, even with every option enabled", () => {
    const m = makeMember({ iban: "DE89370400440532013000", bic: "COBADEFF", accountHolder: "Geheim Konto" });
    const sheets = buildExportSheets([m], [], { addr: true, contact: true, dates: true, gender: true, assignments: true });
    const cells = JSON.stringify(sheets);
    for (const secret of ["DE89", "COBADEFF", "Geheim Konto"]) expect(cells).not.toContain(secret);
  });

  const m1 = makeMember({ id: "m1", lastName: "Bauer", firstName: "Anna", gender: "female", street: "Hauptstr.", houseNumber: "1", zip: "12345", city: "Altenhammer", phone: "123", email: "a@b.de" });
  const m2 = makeMember({ id: "m2", lastName: "Adler", firstName: "Ben", gender: "male" });

  it("always includes lastName/firstName in the members sheet, sorted by lastName", () => {
    const sheets = buildExportSheets([m1, m2], [], { addr: false, contact: false, dates: false, gender: false, assignments: false });
    expect(sheets).toHaveLength(1);
    expect(sheets[0].header).toEqual(["Nachname", "Vorname"]);
    expect(sheets[0].rows.map((r) => r[0])).toEqual(["Adler", "Bauer"]);
  });

  it("adds gender/dates/address/contact columns per toggle", () => {
    const sheets = buildExportSheets([m1], [], { addr: true, contact: true, dates: true, gender: true, assignments: false });
    const row = sheets[0].rows[0];
    // lastName, firstName, gender, birth, entry, exit, death, street, houseNumber, zip, city, phone, email
    expect(row).toHaveLength(13);
    expect(row[2]).toBe("Weiblich");
    expect(row[7]).toBe("Hauptstr.");
    expect(row[11]).toBe("123");
  });

  it("maps unset gender to 'ohne Angabe'", () => {
    const sheets = buildExportSheets([makeMember({ gender: null })], [], { addr: false, contact: false, dates: false, gender: true, assignments: false });
    expect(sheets[0].rows[0][2]).toBe("Keine Angabe");
  });

  it("adds an assignments sheet only when requested, sorted by member name", () => {
    const rows = [
      { memberId: "m2", roleTitle: "Vorstand", from: "2020-01-01", to: null },
      { memberId: "m1", roleTitle: "Kassier", from: "2019-01-01", to: null },
    ];
    const none = buildExportSheets([m1, m2], rows, { addr: false, contact: false, dates: false, gender: false, assignments: false });
    expect(none).toHaveLength(1);

    const withAsg = buildExportSheets([m1, m2], rows, { addr: false, contact: false, dates: false, gender: false, assignments: true });
    expect(withAsg).toHaveLength(2);
    expect(withAsg[1].rows.map((r) => r[0])).toEqual(["Adler", "Bauer"]);
  });
});

// ── Presentational components ───────────────────────────────────────────────

function renderApp(el: any) {
  const app = new Hono();
  app.get("/", (c) => c.html(el));
  return app.request("/");
}

describe("StatsCards", () => {
  it("counts members per status and splits gender within aktiv/jugend/kinder", async () => {
    const all = [
      { ...makeMember(), status: "aktiv", gender: "male" },
      { ...makeMember(), status: "aktiv", gender: "female" },
      { ...makeMember(), status: "aktiv", gender: null },
      { ...makeMember(), status: "passiv", gender: "male" },
      { ...makeMember(), status: "ausgetreten", gender: "male" },
    ] as any;
    const res = await renderApp(StatsCards({ all }));
    const html = await res.text();
    expect(html).toContain("♂");
    expect(html).toContain("♀");
    expect(html).toContain("o.A.");
  });
});

describe("MembersTable", () => {
  const baseProps = {
    sort: "lastName" as const,
    dir: "asc" as const,
    page: 1,
    pageSize: 25,
    totalPages: 1,
    totalCount: 0,
    search: "",
    statusFilter: ["aktiv"] as any,
    roleFilter: [] as string[],
    isEditor: true,
  };

  it("shows the empty-state row when there are no items", async () => {
    const res = await renderApp(MembersTable({ ...baseProps, items: [] }));
    expect(await res.text()).toMatch(/py-8/);
  });

  it("renders a single badge for one open role", async () => {
    const item = memberWithAssignments({}, [makeAssignment({ role: roleAktiv })]);
    const res = await renderApp(MembersTable({ ...baseProps, items: [{ ...item, status: "aktiv" } as any] }));
    const html = await res.text();
    expect(html).toContain(roleAktiv.title);
    expect(html).not.toContain("role-popover");
  });

  it("renders a count dropdown for more than one open role", async () => {
    const item = memberWithAssignments({}, [
      makeAssignment({ id: "a1", role: roleAktiv }),
      makeAssignment({ id: "a2", role: roleVorstand, memberRoleId: roleVorstand.id }),
    ]);
    const res = await renderApp(MembersTable({ ...baseProps, items: [{ ...item, status: "aktiv" } as any] }));
    const html = await res.text();
    expect(html).toContain("role-popover");
    expect(html).toContain(roleAktiv.title);
    expect(html).toContain(roleVorstand.title);
  });

  it("hides closed assignments from the open-roles display", async () => {
    const item = memberWithAssignments({}, [makeAssignment({ to: "2020-01-01" })]);
    const res = await renderApp(MembersTable({ ...baseProps, items: [{ ...item, status: "aktiv" } as any] }));
    expect(await res.text()).not.toContain(roleAktiv.title);
  });
});

describe("SortIcon", () => {
  it("shows a neutral icon for an inactive column", async () => {
    const res = await renderApp(SortIcon({ col: "birthDate", active: "lastName", dir: "asc" }));
    expect(await res.text()).toContain("↕");
  });

  it("shows an up arrow for the active column ascending", async () => {
    const res = await renderApp(SortIcon({ col: "lastName", active: "lastName", dir: "asc" }));
    expect(await res.text()).toContain("↑");
  });

  it("shows a down arrow for the active column descending", async () => {
    const res = await renderApp(SortIcon({ col: "lastName", active: "lastName", dir: "desc" }));
    expect(await res.text()).toContain("↓");
  });
});

// ── Routes ───────────────────────────────────────────────────────────────────

describe("GET /", () => {
  it("renders the full page with stats and table for a normal request", async () => {
    findManyResult = [memberWithAssignments()];
    rolesFixture = [roleAktiv];
    const res = await memberRoutes.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<html");
    expect(html).toContain("Bauer");
  });

  it("returns only the table fragment for an HTMX request", async () => {
    findManyResult = [memberWithAssignments()];
    const res = await memberRoutes.request("/", { headers: { "HX-Request": "true" } });
    const html = await res.text();
    expect(html).not.toContain("<html");
    expect(html).toContain("members-results");
  });

  it("filters out members whose status is not in the status filter", async () => {
    findManyResult = [
      memberWithAssignments({ id: "m1", lastName: "Aktiv" }),
      memberWithAssignments({ id: "m2", lastName: "Weg", exitDate: "2020-01-01" }, []),
    ];
    const res = await memberRoutes.request("/?status=aktiv");
    const html = await res.text();
    expect(html).toContain("Aktiv");
    expect(html).not.toContain("Weg");
  });

  it("filters by search term against first/last name, case-insensitively", async () => {
    findManyResult = [
      memberWithAssignments({ id: "m1", lastName: "Bauer", firstName: "Anna" }),
      memberWithAssignments({ id: "m2", lastName: "Adler", firstName: "Ben" }),
    ];
    const res = await memberRoutes.request("/?search=bau");
    const html = await res.text();
    expect(html).toContain("Bauer");
    expect(html).not.toContain("Adler");
  });

  it("hides the add-member button for a read-only user", async () => {
    currentUser = { id: "u1", permissions: new Set(), disabled: false };
    findManyResult = [];
    const res = await memberRoutes.request("/");
    expect(await res.text()).not.toContain("/members/new");
  });
});

describe("GET /new", () => {
  it("renders the empty creation form", async () => {
    rolesFixture = [roleAktiv];
    const res = await memberRoutes.request("/new");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(roleAktiv.title);
  });

  it("prefills from an existing person when ?personId is given", async () => {
    personLookupResult = [{ id: "p1", lastName: "Bauer", firstName: "Anna", street: "Musterweg", houseNumber: "5", zip: "12345", city: "Musterstadt", gender: null, birthDate: "1995-01-01", phone: null, email: "anna@example.com" }];
    const res = await memberRoutes.request("/new?personId=p1&applicationId=app1");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('value="Bauer"');
    expect(html).toContain('name="personId" value="p1"');
    expect(html).toContain('name="applicationId" value="app1"');
  });

  it("redirects to the application with an error when the person is already a member", async () => {
    memberLookupResult = [{ id: "m-existing" }];
    const res = await memberRoutes.request("/new?personId=p1&applicationId=app1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/applications/app1");
  });

  it("prefills from an archived member match (?linkMemberId) using the application's fresher contact data", async () => {
    findFirstResult = memberWithAssignments({ id: "m-old", personId: "p-old", lastName: "Altname", firstName: "Alt", entryDate: "2005-01-01", exitDate: "2020-01-01" });
    applicationFindFirstResult = {
      id: "app1",
      person: { lastName: "Bauer", firstName: "Anna", birthDate: "1995-01-01", street: "Neuweg", houseNumber: "1", zip: "99999", city: "Neustadt", email: "anna@new.example", phone: "555" },
    };
    const res = await memberRoutes.request("/new?linkMemberId=m-old&applicationId=app1");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('value="Bauer"');
    expect(html).toContain('value="2005-01-01"');
    expect(html).toContain('name="linkMemberId" value="m-old"');
  });

  it("prefills from an active member match (?linkMemberId) and shows the active relink notice", async () => {
    findFirstResult = memberWithAssignments({ id: "m-active", personId: "p-active", lastName: "Bauer", firstName: "Anna", entryDate: "2015-01-01" });
    const res = await memberRoutes.request("/new?linkMemberId=m-active");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('value="2015-01-01"');
    expect(html).toContain(t("members.relink.noticeActive"));
    expect(html).not.toContain(t("members.relink.notice"));
  });

  it("404s for an unknown linkMemberId", async () => {
    findFirstResult = undefined;
    const res = await memberRoutes.request("/new?linkMemberId=missing");
    expect(res.status).toBe(404);
  });
});

describe("GET /role-row", () => {
  it("renders one role-row fragment", async () => {
    rolesFixture = [roleAktiv];
    const res = await memberRoutes.request("/role-row?index=2");
    const html = await res.text();
    expect(html).toContain("role-row-2");
    expect(html).toContain(`data-id="${roleAktiv.id}"`);
    expect(html).toContain(`data-title="${roleAktiv.title}"`);
    expect(html).not.toContain("<select");
  });
});

describe("POST /new", () => {
  it("re-renders the form with 422 when required fields are missing", async () => {
    const res = await memberRoutes.request("/new", { method: "POST", body: formBody({ lastName: "" }) });
    expect(res.status).toBe(422);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a role assignment missing its from-date", async () => {
    const res = await memberRoutes.request("/new", {
      method: "POST",
      body: formBody({
        lastName: "Bauer", firstName: "Anna", birthDate: "1990-01-01", entryDate: "2020-01-01",
        "assignment_role[]": roleAktiv.id, "assignment_from[]": "", "assignment_to[]": "",
      }),
    });
    expect(res.status).toBe(422);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a role assignment missing its role", async () => {
    const res = await memberRoutes.request("/new", {
      method: "POST",
      body: formBody({
        lastName: "Bauer", firstName: "Anna", birthDate: "1990-01-01", entryDate: "2020-01-01",
        "assignment_role[]": "", "assignment_from[]": "2020-01-01", "assignment_to[]": "",
      }),
    });
    expect(res.status).toBe(422);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects when an earlier row is incomplete even if a later row is valid (index alignment)", async () => {
    rolesFixture = [roleAktiv];
    const res = await memberRoutes.request("/new", {
      method: "POST",
      body: formBody({
        lastName: "Bauer", firstName: "Anna", birthDate: "1990-01-01", entryDate: "2020-01-01",
        "assignment_role[]": ["", roleAktiv.id],
        "assignment_from[]": ["2020-01-01", "2021-01-01"],
        "assignment_to[]": ["", ""],
      }),
    });
    expect(res.status).toBe(422);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects duplicate open assignments for the same role", async () => {
    rolesFixture = [roleAktiv];
    const res = await memberRoutes.request("/new", {
      method: "POST",
      body: formBody({
        lastName: "Bauer", firstName: "Anna", birthDate: "1990-01-01", entryDate: "2020-01-01",
        "assignment_role[]": [roleAktiv.id, roleAktiv.id],
        "assignment_from[]": ["2020-01-01", "2021-01-01"],
        "assignment_to[]": ["", ""],
      }),
    });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain(roleAktiv.title);
    expect(insert).not.toHaveBeenCalled();
  });

  it("creates the member and its assignments, then redirects", async () => {
    const res = await memberRoutes.request("/new", {
      method: "POST",
      body: formBody({
        lastName: "Bauer", firstName: "Anna", birthDate: "1990-01-01", entryDate: "2020-01-01",
        "assignment_role[]": roleAktiv.id, "assignment_from[]": "2020-01-01", "assignment_to[]": "",
      }),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/members");
    expect(res.headers.get("set-cookie")).toMatch(/flash=/);
    expect(insertCalls.some((c) => c.table === persons)).toBe(true);
    expect(insertCalls.some((c) => c.table === members)).toBe(true);
    expect(insertCalls.some((c) => c.table === memberRoleAssignments)).toBe(true);
  });

  it("redirects back to the new-member form for save_and_new", async () => {
    const res = await memberRoutes.request("/new", {
      method: "POST",
      body: formBody({ lastName: "Bauer", firstName: "Anna", birthDate: "1990-01-01", entryDate: "2020-01-01", _action: "save_and_new" }),
    });
    expect(res.headers.get("location")).toBe("/members/new");
  });

  it("links an existing person (via personId) instead of creating a new one, and approves the application", async () => {
    const res = await memberRoutes.request("/new", {
      method: "POST",
      body: formBody({
        personId: "p1", applicationId: "app1",
        lastName: "Bauer", firstName: "Anna", birthDate: "1990-01-01", entryDate: "2020-01-01",
      }),
    });
    expect(res.status).toBe(302);
    expect(insertCalls.some((c) => c.table === persons)).toBe(false);
    expect(updateCalls.some((c) => c.table === persons && c.set.lastName === "Bauer")).toBe(true);
    const memberInsert = insertCalls.find((c) => c.table === members);
    expect(memberInsert?.values.personId).toBe("p1");
    const appUpdate = updateCalls.find((c) => c.table === applications);
    expect(appUpdate?.set.status).toBe("approved");
  });

  it("links an archived member (via linkMemberId) instead of creating a new person/member, and approves the application", async () => {
    memberLookupResult = [{ personId: "old-p1" }];
    const res = await memberRoutes.request("/new", {
      method: "POST",
      body: formBody({
        linkMemberId: "m-old", applicationId: "app1",
        lastName: "Bauer", firstName: "Anna", birthDate: "1990-01-01", entryDate: "2010-01-01",
      }),
    });
    expect(res.status).toBe(302);
    expect(insertCalls.some((c) => c.table === persons)).toBe(false);
    expect(insertCalls.some((c) => c.table === members)).toBe(false);
    const personUpdate = updateCalls.find((c) => c.table === persons);
    expect(personUpdate?.set.lastName).toBe("Bauer");
    const memberUpdate = updateCalls.find((c) => c.table === members);
    expect(memberUpdate?.set.exitDate).toBe(null);
    const appUpdate = updateCalls.find((c) => c.table === applications);
    expect(appUpdate?.set.status).toBe("approved");
  });

  it("404s when linkMemberId doesn't match an existing member", async () => {
    memberLookupResult = [];
    const res = await memberRoutes.request("/new", {
      method: "POST",
      body: formBody({ linkMemberId: "missing", lastName: "Bauer", firstName: "Anna", birthDate: "1990-01-01", entryDate: "2010-01-01" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /export", () => {
  it("returns a single-sheet workbook by default", async () => {
    findManyResult = [makeMember()];
    const res = await memberRoutes.request("/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("content-disposition")).toContain("Test_Feuerwehr_mitglieder_");

    const XLSX = await import("xlsx");
    const wb = XLSX.read(await res.arrayBuffer(), { type: "array" });
    expect(wb.SheetNames).toHaveLength(1);
  });

  it("adds the assignments sheet only when requested, and only then queries it", async () => {
    findManyResult = [makeMember()];
    assignmentRowsFixture = [{ memberId: "m1", roleTitle: "Vorstand", from: "2020-01-01", to: null }];

    const withoutAsg = await memberRoutes.request("/export");
    const XLSX = await import("xlsx");
    expect(XLSX.read(await withoutAsg.arrayBuffer(), { type: "array" }).SheetNames).toHaveLength(1);

    const withAsg = await memberRoutes.request("/export?assignments=1");
    expect(XLSX.read(await withAsg.arrayBuffer(), { type: "array" }).SheetNames).toHaveLength(2);
  });
});

describe("GET /:id", () => {
  it("returns 404 for an unknown member", async () => {
    findFirstResult = undefined;
    const res = await memberRoutes.request("/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("renders a read-only view without a form for non-editors", async () => {
    currentUser = { id: "u1", permissions: new Set(), disabled: false };
    findFirstResult = memberWithAssignments();
    const res = await memberRoutes.request("/m1");
    const html = await res.text();
    expect(html).toContain("Bauer");
    expect(html).not.toContain('name="lastName"');
  });

  it("renders the editable form with existing assignments for editors", async () => {
    findFirstResult = memberWithAssignments();
    rolesFixture = [roleAktiv];
    const res = await memberRoutes.request("/m1");
    const html = await res.text();
    expect(html).toContain("<form");
    expect(html).toContain("role-row-0");
  });

  it("hides the delete button without the members:delete permission", async () => {
    findFirstResult = memberWithAssignments();
    const res = await memberRoutes.request("/m1");
    expect(await res.text()).not.toContain("delete-member-modal");
  });

  it("shows an enabled delete button when unblocked", async () => {
    currentUser = { id: "u1", permissions: new Set(["members:write", "members:delete"]), disabled: false };
    findFirstResult = memberWithAssignments();
    rolesFixture = [roleAktiv];
    const res = await memberRoutes.request("/m1");
    const html = await res.text();
    expect(html).toContain("delete-member-modal");
    expect(html).toContain("/members/m1/delete");
  });

  it("shows an inventory hint in the delete modal when the member has assigned items", async () => {
    currentUser = { id: "u1", permissions: new Set(["members:write", "members:delete"]), disabled: false };
    findFirstResult = memberWithAssignments();
    rolesFixture = [roleAktiv];
    inventoryAssignmentRowsFixture = [{ quantity: 2 }, { quantity: 1 }];
    const res = await memberRoutes.request("/m1");
    const html = await res.text();
    expect(html).toContain(t("members.delete.hintInventory", { count: 3 }));
  });

  it("shows a disabled delete button with a reason when the person still has a donor profile", async () => {
    currentUser = { id: "u1", permissions: new Set(["members:write", "members:delete"]), disabled: false };
    findFirstResult = memberWithAssignments();
    donorLookupResult = [{ id: "d1" }];
    const res = await memberRoutes.request("/m1");
    const html = await res.text();
    expect(html).not.toContain("delete-member-modal");
    expect(html).toContain(t("members.delete.blockedDonor"));
  });
});

describe("bank data gating", () => {
  const perms = (...p: string[]) => { currentUser = { id: "u1", permissions: new Set(p), disabled: false }; };
  const VALID = "DE89 3704 0044 0532 0130 00";

  it("hides the section without bank-data:read", async () => {
    perms("members:write");
    findFirstResult = memberWithAssignments({ iban: "DE89370400440532013000" });
    const html = await (await memberRoutes.request("/m1")).text();
    expect(html).not.toContain("Bankverbindung");
    expect(html).not.toContain("DE89");
  });

  it("shows read-only grouped IBAN with read, editable input with write", async () => {
    findFirstResult = memberWithAssignments({ iban: "DE89370400440532013000" });
    perms("members:read", "members:bank-data:read");
    let html = await (await memberRoutes.request("/m1")).text();
    expect(html).toContain("DE89 3704 0044 0532 0130 00");
    expect(html).not.toContain('name="iban"');
    perms("members:read", "members:bank-data:write");
    html = await (await memberRoutes.request("/m1")).text();
    expect(html).toContain('name="iban"');
  });

  it("bank-only writer saves bank data and ignores master data", async () => {
    perms("members:bank-data:write");
    findFirstResult = memberWithAssignments();
    const res = await memberRoutes.request("/m1", { method: "POST", body: formBody({ lastName: "Hacked", iban: VALID, bic: "cobadeff" }) });
    expect(res.status).toBe(302);
    expect(updateCalls.some((c) => c.table === persons)).toBe(false);
    expect(updateCalls.find((c) => c.table === members)?.set).toMatchObject({ iban: "DE89370400440532013000", bic: "COBADEFF", accountHolder: null });
  });

  it("master-data writer without bank permission cannot change bank data", async () => {
    perms("members:write");
    findFirstResult = memberWithAssignments();
    await memberRoutes.request("/m1", { method: "POST", body: formBody({ lastName: "Bauer", firstName: "Anna", birthDate: "1985-05-01", entryDate: "2010-01-01", iban: VALID }) });
    expect(updateCalls.find((c) => c.table === members)?.set).not.toHaveProperty("iban");
  });

  it("stores bank data on create only with bank-data:write", async () => {
    const form = { lastName: "Neu", firstName: "Nina", birthDate: "1990-01-01", entryDate: "2024-01-01", iban: VALID };
    perms("members:write", "members:bank-data:write");
    await memberRoutes.request("/new", { method: "POST", body: formBody(form) });
    expect(insertCalls.find((c) => c.table === members)?.values).toMatchObject({ iban: "DE89370400440532013000" });
    insertCalls.length = 0;
    perms("members:write");
    await memberRoutes.request("/new", { method: "POST", body: formBody(form) });
    expect(insertCalls.find((c) => c.table === members)?.values).not.toHaveProperty("iban");
  });

  it("rejects an invalid IBAN", async () => {
    perms("members:bank-data:write");
    findFirstResult = memberWithAssignments();
    const res = await memberRoutes.request("/m1", { method: "POST", body: formBody({ iban: "DE00 1234" }) });
    expect(res.status).toBe(422);
    expect(updateCalls.some((c) => c.table === members)).toBe(false);
  });
});

describe("POST /:id/delete", () => {
  it("returns 404 for an unknown member", async () => {
    findFirstResult = undefined;
    const res = await memberRoutes.request("/does-not-exist/delete", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("blocks deletion and redirects back when the person still has a donor profile", async () => {
    findFirstResult = memberWithAssignments();
    donorLookupResult = [{ id: "d1" }];
    const res = await memberRoutes.request("/m1/delete", { method: "POST" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/members/m1");
    expect(res.headers.get("set-cookie")).toMatch(/flash=/);
    expect(deleteCalls.some((c) => c.table === members)).toBe(false);
  });

  it("blocks deletion when the person still has an application", async () => {
    findFirstResult = memberWithAssignments();
    applicationLookupResult = [{ id: "app1" }];
    const res = await memberRoutes.request("/m1/delete", { method: "POST" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/members/m1");
    expect(deleteCalls.some((c) => c.table === members)).toBe(false);
  });

  it("blocks deletion when the person is a guardian on another application", async () => {
    findFirstResult = memberWithAssignments();
    applicationGuardianLookupResult = [{ id: "g1" }];
    const res = await memberRoutes.request("/m1/delete", { method: "POST" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/members/m1");
    expect(deleteCalls.some((c) => c.table === members)).toBe(false);
  });

  it("deletes the member and its person record, then redirects to the list", async () => {
    findFirstResult = memberWithAssignments();
    const res = await memberRoutes.request("/m1/delete", { method: "POST" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/members");
    expect(res.headers.get("set-cookie")).toMatch(/flash=/);
    expect(deleteCalls.some((c) => c.table === members)).toBe(true);
    expect(deleteCalls.some((c) => c.table === persons)).toBe(true);
  });
});

describe("POST /:id", () => {
  it("returns 404 for an unknown member", async () => {
    findFirstResult = undefined;
    const res = await memberRoutes.request("/does-not-exist", { method: "POST", body: formBody({}) });
    expect(res.status).toBe(404);
  });

  it("re-renders with 422 when required fields are missing", async () => {
    findFirstResult = memberWithAssignments();
    const res = await memberRoutes.request("/m1", { method: "POST", body: formBody({ lastName: "" }) });
    expect(res.status).toBe(422);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("shows the reactivation modal instead of saving when reopening auto-closed assignments", async () => {
    findFirstResult = memberWithAssignments(
      { exitDate: "2023-01-01" },
      [makeAssignment({ autoClosed: true, to: "2023-01-01" })]
    );
    const res = await memberRoutes.request("/m1", {
      method: "POST",
      body: formBody({ lastName: "Bauer", firstName: "Anna", birthDate: "1985-05-01", entryDate: "2010-01-01", exitDate: "" }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("reactivate=1");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("reopens auto-closed assignments when reactivation is confirmed", async () => {
    findFirstResult = memberWithAssignments(
      { exitDate: "2023-01-01" },
      [makeAssignment({ autoClosed: true, to: "2023-01-01" })]
    );
    const res = await memberRoutes.request("/m1?reactivate=1", {
      method: "POST",
      body: formBody({ lastName: "Bauer", firstName: "Anna", birthDate: "1985-05-01", entryDate: "2010-01-01", exitDate: "" }),
    });
    expect(res.status).toBe(302);
    expect(updateCalls.some((c) => c.table === memberRoleAssignments && c.set.autoClosed === false)).toBe(true);
  });

  it("saves without touching assignments when reactivation is declined", async () => {
    findFirstResult = memberWithAssignments(
      { exitDate: "2023-01-01" },
      [makeAssignment({ autoClosed: true, to: "2023-01-01" })]
    );
    const res = await memberRoutes.request("/m1?reactivate=0", {
      method: "POST",
      body: formBody({ lastName: "Bauer", firstName: "Anna", birthDate: "1985-05-01", entryDate: "2010-01-01", exitDate: "" }),
    });
    expect(res.status).toBe(302);
    expect(updateCalls.some((c) => c.table === memberRoleAssignments && c.set.autoClosed === false)).toBe(false);
  });

  it("auto-closes open assignments when a member is newly archived", async () => {
    findFirstResult = memberWithAssignments({ exitDate: null }, [makeAssignment()]);
    const res = await memberRoutes.request("/m1", {
      method: "POST",
      body: formBody({ lastName: "Bauer", firstName: "Anna", birthDate: "1985-05-01", entryDate: "2010-01-01", exitDate: "2024-06-01" }),
    });
    expect(res.status).toBe(302);
    expect(updateCalls.some((c) => c.table === persons)).toBe(true);
    expect(updateCalls.some((c) => c.table === members)).toBe(true);
    expect(updateCalls.some((c) => c.table === memberRoleAssignments && c.set.autoClosed === true)).toBe(true);
  });

  it("rejects a role assignment missing its role on edit (same as create)", async () => {
    findFirstResult = memberWithAssignments({}, []);
    const res = await memberRoutes.request("/m1", {
      method: "POST",
      body: formBody({
        lastName: "Bauer", firstName: "Anna", birthDate: "1985-05-01", entryDate: "2010-01-01",
        "assignment_role[]": "", "assignment_from[]": "2024-01-01", "assignment_to[]": "",
      }),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.some((c) => c.table === memberRoleAssignments)).toBe(false);
    expect(updateCalls.some((c) => c.table === memberRoleAssignments)).toBe(false);
  });

  it("deletes removed assignments and inserts new ones on reconciliation", async () => {
    findFirstResult = memberWithAssignments({}, [makeAssignment({ id: "old-a" })]);
    const res = await memberRoutes.request("/m1", {
      method: "POST",
      body: formBody({
        lastName: "Bauer", firstName: "Anna", birthDate: "1985-05-01", entryDate: "2010-01-01",
        "assignment_id[]": "", "assignment_role[]": roleVorstand.id, "assignment_from[]": "2024-01-01", "assignment_to[]": "",
      }),
    });
    expect(res.status).toBe(302);
    expect(deleteCalls.some((c) => c.table === memberRoleAssignments)).toBe(true);
    expect(insertCalls.some((c) => c.table === memberRoleAssignments)).toBe(true);
  });

  it("updates an existing assignment in place when its id is resubmitted", async () => {
    findFirstResult = memberWithAssignments({}, [makeAssignment({ id: "old-a" })]);
    const res = await memberRoutes.request("/m1", {
      method: "POST",
      body: formBody({
        lastName: "Bauer", firstName: "Anna", birthDate: "1985-05-01", entryDate: "2010-01-01",
        "assignment_id[]": "old-a", "assignment_role[]": roleAktiv.id, "assignment_from[]": "2024-01-01", "assignment_to[]": "",
      }),
    });
    expect(res.status).toBe(302);
    expect(deleteCalls.some((c) => c.table === memberRoleAssignments)).toBe(false);
    expect(updateCalls.some((c) => c.table === memberRoleAssignments && c.set.memberRoleId === roleAktiv.id)).toBe(true);
  });
});
