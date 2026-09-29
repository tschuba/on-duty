import { describe, it, expect, vi, beforeEach } from "vitest";
import { persons, donors, donations } from "../db/schema/index.js";
import { t } from "../i18n/index.js";

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
let donationsFixture: any[] = [];
let orgConfigFixture: any[] = [];

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
      if (table === donations) return chainOf(donationsFixture);
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

vi.mock("../lib/org-config.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/org-config.js")>("../lib/org-config.js");
  return {
    ...actual,
    loadOrgConfig: vi.fn(() => Promise.resolve(Object.fromEntries(orgConfigFixture.map((r: any) => [r.key, r.value])))),
  };
});

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
  donationsFixture = [];
  donorLookupResult = [];
  orgConfigFixture = [];
  currentUser = { id: "u1", permissions: new Set(["donations:record", "donations:issue-receipts"]), disabled: false };
});

function completeOrgConfig(overrides: Record<string, string> = {}) {
  orgConfigFixture = Object.entries({
    orgName: "Feuerwehr Musterstadt e.V.",
    orgStreet: "Hauptstr.",
    orgHouseNumber: "1",
    orgZip: "12345",
    orgCity: "Musterstadt",
    taxExemptionDate: "2020-01-01",
    taxExemptionNumber: "12/345/6789",
    taxOffice: "Finanzamt Musterstadt",
    taxAssessmentPeriodFrom: "2019",
    taxAssessmentPeriodTo: "2019",
    charitablePurpose: "Förderung des Feuerwehrwesens",
    ...overrides,
  }).map(([key, value]) => ({ key, value }));
}

function makePerson(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1", firstName: "Anna", lastName: "Bauer",
    street: "Musterweg", houseNumber: "5", zip: "12345", city: "Musterstadt",
    gender: "female", birthDate: "1985-05-01", phone: "0123", email: "a@b.de",
    ...overrides,
  };
}

function formBody(fields: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.append(k, v);
  return params;
}

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
    const cols = selectCalls[selectCalls.length - 1];
    expect(Object.keys(cols).sort()).toEqual(["city", "firstName", "houseNumber", "id", "lastName", "street", "zip"]);
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
});

// ── POST /new ────────────────────────────────────────────────────────────────

describe("POST /new", () => {
  it("returns 422 with field errors when required fields are missing", async () => {
    const res = await donorRoutes.request("/new", { method: "POST", body: formBody({ firstName: "" }) });
    expect(res.status).toBe(422);
    expect(insert).not.toHaveBeenCalled();
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

// ── Summary receipt ──────────────────────────────────────────────────────────

describe("GET /:id/summary-receipt", () => {
  it("blocks with a link to org-config when org data is incomplete", async () => {
    orgConfigFixture = [];
    donorsFindFirstResult = { id: "d1", personId: "p1", person: makePerson() };
    const res = await donorRoutes.request("/d1/summary-receipt");
    const html = await res.text();
    expect(html).toContain("/admin/org-config");
    expect(html).not.toContain(t("donors.summaryReceipt.total"));
  });

  it("excludes already-issued donations from the included set and total", async () => {
    completeOrgConfig();
    donorsFindFirstResult = { id: "d1", personId: "p1", person: makePerson() };
    donationsFixture = [
      { id: "don1", donorId: "d1", amount: "50.00", date: "2026-03-01", type: "cash", purpose: null, receiptIssuedAt: null },
      { id: "don2", donorId: "d1", amount: "30.00", date: "2026-04-01", type: "transfer", purpose: null, receiptIssuedAt: new Date() },
    ];
    const res = await donorRoutes.request("/d1/summary-receipt");
    const html = await res.text();
    expect(html).toContain("50,00");
    expect(html).not.toContain("30,00");
    expect(html).toContain(t("donors.summaryReceipt.excludedNote", { count: 1 }));
  });
});

describe("POST /:id/summary-receipt/mark-issued", () => {
  it("stamps receiptIssuedAt via an update scoped by donor and period", async () => {
    donorsFindFirstResult = { id: "d1", personId: "p1" };
    const res = await donorRoutes.request("/d1/summary-receipt/mark-issued", {
      method: "POST",
      body: formBody({ from: "2026-01-01", to: "2026-12-31" }),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("print=1");
    expect(updateCalls.some((c) => c.table === donations && "receiptIssuedAt" in c.set)).toBe(true);
  });
});
