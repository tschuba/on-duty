import { describe, it, expect, vi, beforeEach } from "vitest";
import { persons, donors, donations } from "../db/schema/index.js";
import { t } from "../i18n/index.js";

function chainOf(rows: unknown) {
  const chain: any = Object.assign(Promise.resolve(rows), {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
  });
  return chain;
}

let donationsFindManyResult: any[] = [];
let donationsFindFirstResult: any = undefined;
let donorLookupResult: any[] = [];
let orgConfigFixture: any[] = [];

const insertCalls: { table: any; values: any }[] = [];
const updateCalls: { table: any; set: any }[] = [];
const deleteCalls: { table: any }[] = [];

const select = vi.fn(() => ({
  from: vi.fn((table: any) => {
    if (table === donors) return chainOf(donorLookupResult);
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
const transaction = vi.fn(async (cb: any) => cb({ select, insert, update, delete: del }));

vi.mock("../db/index.js", () => ({
  db: {
    query: {
      donations: {
        findMany: vi.fn(() => Promise.resolve(donationsFindManyResult)),
        findFirst: vi.fn(() => Promise.resolve(donationsFindFirstResult)),
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

const { donationRoutes } = await import("../routes/donations.js");

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  donationsFindManyResult = [];
  donationsFindFirstResult = undefined;
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

function makeDonation(overrides: Record<string, unknown> = {}) {
  return {
    id: "don1", donorId: "d1", amount: "100.00", date: "2026-03-01", type: "cash", purpose: null, receiptIssuedAt: null,
    donor: {
      id: "d1", personId: "p1",
      person: { id: "p1", firstName: "Anna", lastName: "Bauer", street: "Musterweg", houseNumber: "5", zip: "12345", city: "Musterstadt" },
    },
    ...overrides,
  };
}

function formBody(fields: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.append(k, v);
  return params;
}

// ── GET / (list) ─────────────────────────────────────────────────────────────

describe("GET /", () => {
  it("lists donations with donor name and formatted amount", async () => {
    donationsFindManyResult = [makeDonation()];
    const res = await donationRoutes.request("/");
    const html = await res.text();
    expect(html).toContain("Bauer");
    expect(html).toContain("100,00");
  });

  it("filters by donor-name search", async () => {
    donationsFindManyResult = [
      makeDonation({ id: "don1" }),
      makeDonation({ id: "don2", donor: { id: "d2", personId: "p2", person: { id: "p2", firstName: "Ben", lastName: "Adler", street: null, houseNumber: null, zip: null, city: null } } }),
    ];
    const res = await donationRoutes.request("/?search=bau");
    const html = await res.text();
    expect(html).toContain("Bauer");
    expect(html).not.toContain("Adler");
  });

  it("filters by date range", async () => {
    donationsFindManyResult = [
      makeDonation({ id: "don1", date: "2026-01-15" }),
      makeDonation({ id: "don2", date: "2026-06-15" }),
    ];
    const res = await donationRoutes.request("/?from=2026-05-01&to=2026-12-31");
    const html = await res.text();
    expect(html).not.toContain("15.01.2026");
    expect(html).toContain("15.06.2026");
  });
});

// ── POST / (create) ──────────────────────────────────────────────────────────

describe("POST /", () => {
  it("returns 422 when donor and donation fields are missing", async () => {
    const res = await donationRoutes.request("/", { method: "POST", body: formBody({}) });
    expect(res.status).toBe(422);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a zero or non-numeric amount", async () => {
    const res = await donationRoutes.request("/", {
      method: "POST",
      body: formBody({
        firstName: "Anna", lastName: "Bauer", street: "Musterweg", houseNumber: "5", zip: "12345", city: "Musterstadt",
        amount: "0", date: "2026-03-01", type: "cash",
      }),
    });
    expect(res.status).toBe(422);
  });

  it("creates a new person, donor and donation together when no personId is given", async () => {
    donorLookupResult = [];
    const res = await donationRoutes.request("/", {
      method: "POST",
      body: formBody({
        firstName: "Anna", lastName: "Bauer", street: "Musterweg", houseNumber: "5", zip: "12345", city: "Musterstadt",
        amount: "50", date: "2026-03-01", type: "cash",
      }),
    });
    expect(res.status).toBe(302);
    expect(insertCalls.some((c) => c.table === persons)).toBe(true);
    expect(insertCalls.some((c) => c.table === donors)).toBe(true);
    expect(insertCalls.some((c) => c.table === donations)).toBe(true);
  });

  it("reuses the existing donor (get-or-create) when personId matches one", async () => {
    donorLookupResult = [{ id: "d1", personId: "p1" }];
    const res = await donationRoutes.request("/", {
      method: "POST",
      body: formBody({
        personId: "p1", firstName: "Anna", lastName: "Bauer", street: "Musterweg", houseNumber: "5", zip: "12345", city: "Musterstadt",
        amount: "50", date: "2026-03-01", type: "transfer",
      }),
    });
    expect(res.status).toBe(302);
    expect(insertCalls.some((c) => c.table === donors)).toBe(false);
    const donationInsert = insertCalls.find((c) => c.table === donations);
    expect(donationInsert?.values.donorId).toBe("d1");
  });
});

// ── Receipt ──────────────────────────────────────────────────────────────────

describe("GET /:id/receipt", () => {
  it("blocks with a link to org-config when org data is incomplete", async () => {
    orgConfigFixture = [];
    donationsFindFirstResult = makeDonation();
    const res = await donationRoutes.request("/don1/receipt");
    const html = await res.text();
    expect(html).toContain("/admin/org-config");
    expect(html).not.toContain(t("donations.receipt.explanation"));
  });

  it("renders the receipt summary and download link when org data is complete", async () => {
    completeOrgConfig();
    donationsFindFirstResult = makeDonation();
    const res = await donationRoutes.request("/don1/receipt");
    const html = await res.text();
    expect(html).toContain("Anna Bauer");
    expect(html).toContain(t("donations.receipt.explanation"));
  });
});

describe("GET /:id/receipt.xml", () => {
  it("404s when org data is incomplete", async () => {
    orgConfigFixture = [];
    donationsFindFirstResult = makeDonation();
    const res = await donationRoutes.request("/don1/receipt.xml");
    expect(res.status).toBe(404);
  });

  it("404s when the donation doesn't exist", async () => {
    completeOrgConfig();
    donationsFindFirstResult = undefined;
    const res = await donationRoutes.request("/don1/receipt.xml");
    expect(res.status).toBe(404);
  });

  it("builds the FFW xml-data file with donor, org and amount-in-words", async () => {
    completeOrgConfig();
    donationsFindFirstResult = makeDonation({ amount: "100.00", date: "2026-03-01" });
    const res = await donationRoutes.request("/don1/receipt.xml");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    expect(res.headers.get("content-disposition")).toContain("Zuwendungsbestaetigung-don1.xml");
    const xml = await res.text();
    expect(xml).toContain('<form>catalog://Steuerformulare/gemein/034122</form>');
    expect(xml).toContain('<element id="name">Anna Bauer\nMusterweg 5\n12345 Musterstadt</element>');
    expect(xml).toContain('<element id="wert">100,00</element>');
    expect(xml).toContain('<element id="wert2">Einhundert Euro</element>');
    expect(xml).toContain('<element id="datum">01.03.2026 00:00:00</element>');
    expect(xml).toContain('<element id="k1">false</element>');
    expect(xml).toContain('<element id="k2">true</element>');
    expect(xml).toContain('<element id="finamt">Finanzamt Musterstadt</element>');
    expect(xml).toContain('<element id="zeitraum">2019</element>');
  });
});

describe("POST /:id/mark-issued", () => {
  it("stamps receiptIssuedAt and redirects to the xml download", async () => {
    const res = await donationRoutes.request("/don1/mark-issued", { method: "POST" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/donations/don1/receipt.xml");
    expect(updateCalls.some((c) => c.table === donations && "receiptIssuedAt" in c.set)).toBe(true);
  });
});

describe("POST /:id/delete", () => {
  it("deletes the donation and redirects to the list", async () => {
    const res = await donationRoutes.request("/don1/delete", { method: "POST" });
    expect(res.status).toBe(302);
    expect(deleteCalls.some((c) => c.table === donations)).toBe(true);
  });
});
