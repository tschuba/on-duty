import { describe, it, expect, vi, beforeEach } from "vitest";
import { t } from "../i18n/index.js";
import { persons, donors } from "../db/schema/index.js";
import { formBody } from "./test-utils.js";
import { makePerson } from "./fixtures.js";

// ── DB chain-stub helpers (same philosophy as members.test.ts/admin.test.ts) ──

function chainOf(rows: unknown) {
  const chain: any = Object.assign(Promise.resolve(rows), {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
  });
  return chain;
}

let personsFixture: any[] = [];
let donorsFindManyResult: any[] = [];
let donorsFindFirstResult: any = undefined;

const insertCalls: { table: any; values: any }[] = [];
const updateCalls: { table: any; set: any }[] = [];
const deleteCalls: { table: any; where?: any }[] = [];

const selectCalls: any[] = [];
// getOrCreateDonor does `tx.select().from(donors).where(eq(donors.personId, id))` —
// donorLookupResult lets each test control whether that lookup "finds" a donor.
let donorLookupResult: any[] = [];
const select = vi.fn((cols?: any) => {
  selectCalls.push(cols);
  return {
    from: vi.fn((table: any) => {
      if (table === persons) return chainOf(personsFixture);
      if (table === donors) return chainOf(donorLookupResult);
      return chainOf([]);
    }),
  };
});

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
    const entry: { table: any; where?: any } = { table };
    deleteCalls.push(entry);
    return { where: vi.fn((w: any) => { entry.where = w; return Promise.resolve(undefined); }) };
  });
}

const insert = makeInsert();
const update = makeUpdate();
const del = makeDelete();
const transaction = vi.fn(async (cb: any) => cb({ select, insert, update, delete: del }));

vi.mock("../db/index.js", () => ({
  db: {
    query: {
      donors: {
        findMany: vi.fn(() => Promise.resolve(donorsFindManyResult)),
        findFirst: vi.fn(() => Promise.resolve(donorsFindFirstResult)),
      },
    },
    select,
    insert,
    update,
    delete: del,
    transaction,
  },
}));

let currentUser = { id: "u1", permissions: new Set(["donations:record", "donations:issue-receipts"]), disabled: false };

vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => async (c: any, next: any) => {
    c.set("user", currentUser);
    await next();
  },
}));

const { donorRoutes, parseDonorPersonFields, getOrCreateDonor } = await import("../routes/donors.js");

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  selectCalls.length = 0;
  personsFixture = [];
  donorsFindManyResult = [];
  donorsFindFirstResult = undefined;
  donorLookupResult = [];
  currentUser = { id: "u1", permissions: new Set(["donations:record", "donations:issue-receipts"]), disabled: false };
});

// ── Pure functions ───────────────────────────────────────────────────────────

describe("parseDonorPersonFields", () => {
  it("requires all six fields", () => {
    const { errors } = parseDonorPersonFields({});
    expect(Object.keys(errors).sort()).toEqual(["city", "firstName", "houseNumber", "lastName", "street", "zip"]);
  });

  it("trims and accepts a fully filled form", () => {
    const { values, errors } = parseDonorPersonFields({
      firstName: " Anna ", lastName: "Bauer", street: "Musterweg", houseNumber: "5", zip: "12345", city: "Musterstadt",
    });
    expect(errors).toEqual({});
    expect(values.firstName).toBe("Anna");
  });
});

describe("getOrCreateDonor", () => {
  it("reuses an existing donor row for the person", async () => {
    const existing = { id: "d1", personId: "p1" };
    const tx: any = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([existing])) })) })) };
    const result = await getOrCreateDonor(tx, "p1");
    expect(result).toBe(existing);
  });

  it("creates a new donor row when none exists for the person", async () => {
    const created = { id: "d2", personId: "p2" };
    const tx: any = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([created])) })) })),
    };
    const result = await getOrCreateDonor(tx, "p2");
    expect(result).toBe(created);
  });
});

// ── GET /search-persons ──────────────────────────────────────────────────────

describe("GET /search-persons", () => {
  it("returns nothing for a query shorter than 2 characters", async () => {
    const res = await donorRoutes.request("/search-persons?q=a");
    expect(await res.text()).toBe("");
    expect(select).not.toHaveBeenCalled();
  });

  it("projects only the narrow field set — never gender/birthDate/phone/email", async () => {
    personsFixture = [makePerson()];
    await donorRoutes.request("/search-persons?q=an");
    // first select = outer query; the exists() subqueries come after
    const cols = selectCalls.find((c) => "firstName" in c)!;
    expect(Object.keys(cols).sort()).toEqual(["city", "companyName", "firstName", "houseNumber", "id", "lastName", "street", "zip"]);
  });

  it("shows a create-new prompt when nothing matches", async () => {
    personsFixture = [];
    const res = await donorRoutes.request("/search-persons?q=zz");
    const html = await res.text();
    expect(html).toContain("donor-create-new");
  });

  it("renders matching persons as selectable results", async () => {
    personsFixture = [makePerson()];
    const res = await donorRoutes.request("/search-persons?q=bau");
    const html = await res.text();
    expect(html).toContain("donor-result");
    expect(html).toContain("Anna Bauer");
  });
});

// ── GET / (list) ─────────────────────────────────────────────────────────────

describe("GET /", () => {
  it("lists donors by name and address only", async () => {
    donorsFindManyResult = [{ id: "d1", personId: "p1", person: makePerson() }];
    const res = await donorRoutes.request("/");
    const html = await res.text();
    expect(html).toContain("Bauer");
    expect(html).toContain("Musterweg");
  });

  it("filters by search term", async () => {
    donorsFindManyResult = [
      { id: "d1", personId: "p1", person: makePerson({ lastName: "Bauer", firstName: "Anna" }) },
      { id: "d2", personId: "p2", person: makePerson({ lastName: "Adler", firstName: "Ben" }) },
    ];
    const res = await donorRoutes.request("/?search=bau");
    const html = await res.text();
    expect(html).toContain("Bauer");
    expect(html).not.toContain("Adler");
  });

  const mixed = () => {
    donorsFindManyResult = [
      { id: "d1", personId: "p1", person: { ...makePerson({ lastName: "Bauer", firstName: "Anna" }), member: { id: "m1" } } },
      { id: "d2", personId: "p2", person: { ...makePerson({ lastName: "Adler", firstName: "Ben" }), member: null } },
    ];
  };

  it("marks members; icon is a link only with members:read", async () => {
    mixed();
    let html = await (await donorRoutes.request("/")).text();
    expect(html.match(/title="Mitglied"/g)).toHaveLength(1);
    expect(html).not.toContain("/members/m1");
    currentUser = { ...currentUser, permissions: new Set(["donations:issue-receipts", "members:read"]) };
    html = await (await donorRoutes.request("/")).text();
    expect(html).toContain('href="/members/m1"');
  });

  it("filters by membership, combined with search", async () => {
    mixed();
    let html = await (await donorRoutes.request("/?member=yes")).text();
    expect(html).toContain("Bauer");
    expect(html).not.toContain("Adler");
    html = await (await donorRoutes.request("/?member=no")).text();
    expect(html).toContain("Adler");
    expect(html).not.toContain("Bauer");
    html = await (await donorRoutes.request("/?member=yes&search=adl")).text();
    expect(html).not.toContain("Adler");
  });

  it("sorts by first name descending when requested", async () => {
    donorsFindManyResult = [
      { id: "d1", personId: "p1", person: makePerson({ lastName: "Bauer", firstName: "Anna" }) },
      { id: "d2", personId: "p2", person: makePerson({ lastName: "Adler", firstName: "Ben" }) },
    ];
    const res = await donorRoutes.request("/?sort=firstName&sort_dir=desc");
    const html = await res.text();
    expect(html.indexOf("Ben")).toBeLessThan(html.indexOf("Anna"));
  });
});

// ── POST /new ────────────────────────────────────────────────────────────────

describe("POST /new", () => {
  it("returns 422 with field errors when required fields are missing", async () => {
    const res = await donorRoutes.request("/new", { method: "POST", body: formBody({ firstName: "" }) });
    expect(res.status).toBe(422);
    expect(insert).not.toHaveBeenCalled();
  });

  it("warns instead of creating when a member/donor with the same name exists", async () => {
    personsFixture = [{ id: "p9" }];
    const fields = { firstName: "Anna", lastName: "Bauer", street: "Musterweg", houseNumber: "5", zip: "12345", city: "Musterstadt" };
    const res = await donorRoutes.request("/new", { method: "POST", body: formBody(fields) });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain(t("donations.form.duplicateWarning"));
    expect(insertCalls.some((c) => c.table === persons)).toBe(false);
  });

  it("creates anyway once the duplicate is confirmed", async () => {
    personsFixture = [{ id: "p9" }];
    donorLookupResult = [];
    const fields = { firstName: "Anna", lastName: "Bauer", street: "Musterweg", houseNumber: "5", zip: "12345", city: "Musterstadt", confirmDuplicate: "1" };
    const res = await donorRoutes.request("/new", { method: "POST", body: formBody(fields) });
    expect(res.status).toBe(302);
    expect(insertCalls.some((c) => c.table === persons)).toBe(true);
  });

  it("creates a new person and donor when no personId is given", async () => {
    donorLookupResult = [];
    const res = await donorRoutes.request("/new", {
      method: "POST",
      body: formBody({ firstName: "Anna", lastName: "Bauer", street: "Musterweg", houseNumber: "5", zip: "12345", city: "Musterstadt" }),
    });
    expect(res.status).toBe(302);
    expect(insertCalls.some((c) => c.table === persons)).toBe(true);
    expect(insertCalls.some((c) => c.table === donors)).toBe(true);
  });

  it("updates the existing person and reuses the donor when personId matches one", async () => {
    donorLookupResult = [{ id: "d1", personId: "p1" }];
    const res = await donorRoutes.request("/new", {
      method: "POST",
      body: formBody({ personId: "p1", firstName: "Anna", lastName: "Bauer", street: "Musterweg", houseNumber: "5", zip: "12345", city: "Musterstadt" }),
    });
    expect(res.status).toBe(302);
    expect(updateCalls.some((c) => c.table === persons)).toBe(true);
    expect(insertCalls.some((c) => c.table === donors)).toBe(false);
  });
});


describe("parseDonorPersonFields with company", () => {
  const addr = { street: "A", houseNumber: "1", zip: "1", city: "X" };
  it("makes first/last name optional when a company name is given", () => {
    expect(parseDonorPersonFields({ companyName: "Müller GmbH", ...addr }).errors).toEqual({});
  });
  it("still requires the address", () => {
    expect(Object.keys(parseDonorPersonFields({ companyName: "Müller GmbH" }).errors).sort()).toEqual(["city", "houseNumber", "street", "zip"]);
  });
});

describe("GET /donors toggle filter", () => {
  const toggleInputs = (html: string) => html.match(/<input[^>]*class="toggle toggle-primary"[^>]*data-href[^>]*>/g) ?? [];
  it("both toggles on without a parameter, no \"Alle\" entry", async () => {
    const html = await (await donorRoutes.request("/")).text();
    const inputs = toggleInputs(html);
    expect(inputs).toHaveLength(2);
    expect(inputs.filter((i) => i.includes("checked"))).toHaveLength(2);
    expect(inputs.filter((i) => i.includes("disabled"))).toHaveLength(0);
    expect(html).not.toContain(">Alle<");
  });

  it("a single active toggle (old link) is checked; switching it off activates the other", async () => {
    for (const [qs, idx] of [["?member=yes", 0], ["?member=no", 1]] as const) {
      const inputs = toggleInputs(await (await donorRoutes.request(`/${qs}`)).text());
      expect(inputs.filter((i) => i.includes("checked"))).toHaveLength(1);
      expect(inputs[idx]).toContain("checked");
      expect(inputs[idx]).not.toContain("disabled");
      expect(inputs[idx]).toContain(["member=yes", "member=no"][1 - idx]);
      expect(inputs[1 - idx]).not.toContain("checked");
    }
  });
});
