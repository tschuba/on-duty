import { describe, it, expect, vi, beforeEach } from "vitest";
import { lendingLoans } from "../db/schema/index.js";
import { formBody } from "./test-utils.js";

process.env.CHILDREN_AGE_LIMIT = "12";
process.env.YOUTH_AGE_LIMIT = "18";

let lendingItemsFindManyResult: any[] = [];
let lendingItemsFindFirstResult: any = undefined;
let lendingLoansFindManyResult: any[] = [];
let lendingLoansFindFirstResult: any = undefined;
let membersFindFirstResult: any = undefined;

const insertCalls: { table: any; values: any }[] = [];
const updateCalls: { table: any; set: any }[] = [];
const deleteCalls: { table: any }[] = [];

function makeInsert() {
  return vi.fn((table: any) => ({
    values: vi.fn((vals: any) => {
      insertCalls.push({ table, values: vals });
      const row = { id: "new-id", ...(Array.isArray(vals) ? vals[0] : vals) };
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

const deleteFn = vi.fn((table: any) => ({
  where: vi.fn(() => {
    deleteCalls.push({ table });
    return Promise.resolve(undefined);
  }),
}));

const insert = makeInsert();
const update = makeUpdate();
const transaction = vi.fn(async (cb: any) => cb({ insert, update }));
let searchPersonsResult: any[] = [];
const select = vi.fn(() => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(searchPersonsResult) }) }) }) }));

vi.mock("../db/index.js", () => ({
  db: {
    query: {
      lendingItems: {
        findMany: vi.fn(() => Promise.resolve(lendingItemsFindManyResult)),
        findFirst: vi.fn(() => Promise.resolve(lendingItemsFindFirstResult)),
      },
      inventoryItems: {
        findMany: vi.fn(() => Promise.resolve([])),
      },
      lendingLoans: {
        findMany: vi.fn(() => Promise.resolve(lendingLoansFindManyResult)),
        findFirst: vi.fn(() => Promise.resolve(lendingLoansFindFirstResult)),
      },
      members: {
        findFirst: vi.fn(() => Promise.resolve(membersFindFirstResult)),
      },
    },
    insert,
    update,
    select,
    delete: deleteFn,
    transaction,
  },
}));

let currentUser = { id: "u1", permissions: new Set(["lending:read", "lending:manage"]), disabled: false };

vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => async (c: any, next: any) => {
    c.set("user", currentUser);
    await next();
  },
}));

const { lendingRoutes } = await import("../routes/lending.js");

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  lendingItemsFindManyResult = [];
  lendingItemsFindFirstResult = undefined;
  lendingLoansFindManyResult = [];
  lendingLoansFindFirstResult = undefined;
  membersFindFirstResult = undefined;
  searchPersonsResult = [];
  currentUser = { id: "u1", permissions: new Set(["lending:read", "lending:manage"]), disabled: false };
});

function makeLendingItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "li1",
    inventoryItemId: "item1",
    individualTracking: true,
    inventoryItem: {
      id: "item1", name: "Stehtisch #1",
      retiredAt: null, retiredReason: null, quantity: 1, retiredQuantity: 0,
      tags: [],
    },
    ...overrides,
  };
}

// ── GET / (Vorgangsliste) ─────────────────────────────────────────────────────

function person(lastName: string, extra: Record<string, unknown> = {}) {
  return { id: "p-" + lastName, firstName: "", lastName, email: null, phone: null, member: null, ...extra };
}

describe("GET /inventory/lending", () => {
  function makeLoan(overrides: Record<string, unknown> = {}) {
    return {
      id: "loan1",
      quantity: 1,
      plannedFrom: "2026-01-01",
      plannedTo: "2026-01-05",
      pickedUpAt: null,
      returnedAt: null,
      borrower: person("Externer"),
      lendingItem: makeLendingItem(),
      ...overrides,
    };
  }

  it("shows loans grouped by month, newest default window", async () => {
    lendingLoansFindManyResult = [makeLoan()];
    const res = await lendingRoutes.request("/?start=&end=");
    const html = await res.text();
    expect(html).toContain("Externer");
    expect(html).toContain("Stehtisch #1");
  });

  it("keeps range/rel/dir on member-filter links and the hidden fields", async () => {
    lendingLoansFindManyResult = [makeLoan()];
    const html = (await (await lendingRoutes.request("/?range=rel&rel=P1M&dir=both&member=yes")).text()).replace(/&amp;/g, "&");
    expect(html).toMatch(/href="\/inventory\/lending\?[^"]*range=rel&rel=P1M&dir=both[^"]*member=no/);
    expect(html).toMatch(/<input type="hidden" name="range" value="rel"(?![^>]*disabled)/);
    expect(html).toMatch(/<input type="hidden" name="rel" value="P1M"(?![^>]*disabled)/);
    expect(html).toMatch(/<input type="hidden" name="dir" value="both"(?![^>]*disabled)/);
    expect(html).toMatch(/data-qrf-dir="past" checked/);
    expect(html).toMatch(/data-qrf-dir="future" checked/);
  });

  it("shows the borrower's contact for lending:read", async () => {
    lendingLoansFindManyResult = [makeLoan({ borrower: person("Externer", { phone: "0171 123456" }) })];
    currentUser = { ...currentUser, permissions: new Set(["lending:read"]) };
    expect(await (await lendingRoutes.request("/?start=&end=")).text()).toContain("0171 123456");
  });

  it("shows member borrower name when loan has a member", async () => {
    lendingLoansFindManyResult = [makeLoan({ borrower: person("Muster", { firstName: "Max", member: { id: "m1" } }) })];
    const res = await lendingRoutes.request("/?start=&end=");
    const html = await res.text();
    expect(html).toContain("Max Muster");
  });

  it("marks member borrowers, links only with members:read, filters by member", async () => {
    lendingLoansFindManyResult = [
      makeLoan({ id: "l1", borrower: person("Muster", { firstName: "Max", member: { id: "m1" } }) }),
      makeLoan({ id: "l2", borrower: person("Externer") }),
    ];
    let html = await (await lendingRoutes.request("/?start=&end=")).text();
    expect(html.match(/title="Mitglied"/g)).toHaveLength(1);
    expect(html).not.toContain("/members/m1");
    html = await (await lendingRoutes.request("/?member=yes&start=&end=")).text();
    expect(html).toContain("Max Muster");
    expect(html).not.toContain("Externer");
    html = await (await lendingRoutes.request("/?member=no&start=2026-01-01")).text();
    expect(html).toContain("Externer");
    expect(html).not.toContain("Max Muster");
    currentUser = { ...currentUser, permissions: new Set(["lending:read", "members:read"]) };
    html = await (await lendingRoutes.request("/?start=&end=")).text();
    expect(html).toContain('href="/members/m1"');
  });

  it("marks overdue loans and groups multiple months with multiple loans each", async () => {
    lendingLoansFindManyResult = [
      makeLoan({ id: "loan1", plannedFrom: "2026-01-01", plannedTo: "1999-01-01", borrower: person("Erster") }),
      makeLoan({ id: "loan2", plannedFrom: "2026-01-02", plannedTo: "2026-01-03", borrower: person("Zweiter") }),
      makeLoan({ id: "loan3", plannedFrom: "2026-02-01", plannedTo: "2026-02-05", borrower: person("Dritter") }),
    ];
    const res = await lendingRoutes.request("/?start=&end=");
    const html = await res.text();
    expect(html).toContain("Erster");
    expect(html).toContain("Dritter");
    expect(html).toContain("text-error");
  });

  it("excludes finished loans outside the default window", async () => {
    lendingLoansFindManyResult = [makeLoan({ returnedAt: "2020-01-01", plannedFrom: "2020-01-01" })];
    const res = await lendingRoutes.request("/");
    const html = await res.text();
    expect(html).toContain(t_empty());
    function t_empty() { return "Keine"; }
  });

  it("keeps overdue loans in every window that ends after their start", async () => {
    lendingLoansFindManyResult = [makeLoan({ plannedFrom: "2020-01-01", plannedTo: "2020-01-05" })];
    expect(await (await lendingRoutes.request("/")).text()).toContain("Externer");
    expect(await (await lendingRoutes.request("/?start=2010-01-01&end=2010-12-31")).text()).not.toContain("Externer");
  });

  it("hides old returned loans in the default window", async () => {
    lendingLoansFindManyResult = [makeLoan({ plannedFrom: "2020-01-01", plannedTo: "2020-01-05", pickedUpAt: "2020-01-01", returnedAt: "2020-01-04" })];
    expect(await (await lendingRoutes.request("/")).text()).not.toContain("Externer");
    expect(await (await lendingRoutes.request("/?start=&end=")).text()).toContain("Externer");
  });

  it("supports an explicit date range", async () => {
    lendingLoansFindManyResult = [makeLoan({ plannedFrom: "2026-01-01" }), makeLoan({ id: "loan2", plannedFrom: "2030-01-01", plannedTo: "2030-01-05" })];
    const res = await lendingRoutes.request("/?start=2030-01-01&end=2030-01-31");
    const html = await res.text();
    expect(html).toContain("2030");
  });

  it("filters by free text on item name and borrower", async () => {
    lendingLoansFindManyResult = [
      makeLoan({ id: "l1", borrower: person("Alpha") }),
      makeLoan({ id: "l2", borrower: person("Beta"), lendingItem: makeLendingItem({ inventoryItem: { ...makeLendingItem().inventoryItem, name: "Zelt" } }) }),
    ];
    const byBorrower = await (await lendingRoutes.request("/?q=alp&start=&end=")).text();
    expect(byBorrower).toContain("Alpha");
    expect(byBorrower).not.toContain("Beta");
    const byItem = await (await lendingRoutes.request("/?q=zelt&start=&end=")).text();
    expect(byItem).toContain("Beta");
    expect(byItem).not.toContain("Alpha");
  });

  it("filters by item", async () => {
    lendingLoansFindManyResult = [
      makeLoan({ id: "l1", borrower: person("Alpha") }),
      makeLoan({ id: "l2", borrower: person("Beta"), lendingItem: { ...makeLendingItem(), id: "li2" } }),
    ];
    const html = await (await lendingRoutes.request("/?item=li2&start=&end=")).text();
    expect(html).toContain("Beta");
    expect(html).not.toContain("Alpha");
  });

  it("filters by status", async () => {
    lendingLoansFindManyResult = [
      makeLoan({ id: "l1", borrower: person("Offen"), plannedFrom: "2999-01-01", plannedTo: "2999-01-05" }),
      makeLoan({ id: "l2", borrower: person("Ueberfaellig"), plannedFrom: "2020-01-01", plannedTo: "2020-01-05", pickedUpAt: "2020-01-01" }),
    ];
    const html = await (await lendingRoutes.request("/?status=overdue&start=&end=")).text();
    expect(html).toContain("Ueberfaellig");
    expect(html).not.toContain("Offen");
  });

  it("filters by tag, matching any of several tags", async () => {
    const withTag = (tag: string) => makeLendingItem({ inventoryItem: { ...makeLendingItem().inventoryItem, tags: [{ id: "tg", inventoryItemId: "item1", tag }] } });
    lendingLoansFindManyResult = [
      makeLoan({ id: "l1", borrower: person("Anderer") }),
      makeLoan({ id: "l2", borrower: person("Fahrzeug"), lendingItem: withTag("Fahrzeug") }),
      makeLoan({ id: "l3", borrower: person("Zelt"), lendingItem: withTag("Zelt") }),
    ];
    const one = await (await lendingRoutes.request("/?tag=Fahrzeug&start=2026-01-01&end=2026-12-31")).text();
    expect(one).toContain("Fahrzeug");
    expect(one).not.toContain("Anderer");
    expect(one).not.toContain("Zelt</td>");
    const both = await (await lendingRoutes.request("/?tag=Fahrzeug&tag=Zelt&start=2026-01-01&end=2026-12-31")).text();
    expect(both).toContain("Fahrzeug");
    expect(both).toContain("Zelt");
    expect(both).not.toContain("Anderer");
  });

  it("only offers 'Neuer Verleihvorgang' with lending:manage", async () => {
    expect(await (await lendingRoutes.request("/")).text()).toContain("/inventory/lending/loans/new");
    currentUser = { id: "u1", permissions: new Set(["lending:read"]), disabled: false };
    expect(await (await lendingRoutes.request("/")).text()).not.toContain("/inventory/lending/loans/new");
  });

  it("renders empty state with no loans", async () => {
    lendingLoansFindManyResult = [];
    const res = await lendingRoutes.request("/");
    expect(res.status).toBe(200);
  });
});

// ── POST /:id/loans (availability check) ────────────────────────────────────

describe("POST /inventory/lending/loans (item given as field)", () => {
  it("404s for a retired item", async () => {
    lendingItemsFindFirstResult = makeLendingItem({ inventoryItem: { ...makeLendingItem().inventoryItem, retiredAt: "2026-01-01" } });
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", lastName: "Externer" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects without a borrower", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", plannedFrom: "2026-01-01", plannedTo: "2026-01-05" }),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.length).toBe(0);
  });

  it("blocks an individual-tracking item when the period overlaps an existing loan", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    lendingLoansFindManyResult = [{ id: "loan1", quantity: 1, plannedFrom: "2026-01-01", plannedTo: "2026-01-10", pickedUpAt: null, returnedAt: null }];
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", lastName: "Externer", phone: "0171 1", plannedFrom: "2026-01-05", plannedTo: "2026-01-15" }),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.length).toBe(0);
  });

  it("creates a loan when the period is free", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    lendingLoansFindManyResult = [];
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", lastName: "Externer", phone: "0171 1", plannedFrom: "2026-01-05", plannedTo: "2026-01-15" }),
    });
    expect(res.status).toBe(302);
    expect(insertCalls.find((c) => c.table === lendingLoans)?.values).toMatchObject({ lendingItemId: "li1", quantity: 1, borrowerPersonId: "new-id" });
  });

  it("blocks a batch item once the summed overlapping quantity exceeds stock", async () => {
    lendingItemsFindFirstResult = makeLendingItem({ individualTracking: false, inventoryItem: { ...makeLendingItem().inventoryItem, quantity: 5, retiredQuantity: 0 } });
    lendingLoansFindManyResult = [{ id: "loan1", quantity: 4, plannedFrom: "2026-01-01", plannedTo: "2026-01-10", pickedUpAt: null, returnedAt: null }];
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", lastName: "Externer", quantity: "2", plannedFrom: "2026-01-05", plannedTo: "2026-01-06" }),
    });
    expect(res.status).toBe(422);
  });

  it("blocks a quantity above stock even without dates", async () => {
    lendingItemsFindFirstResult = makeLendingItem({ individualTracking: false, inventoryItem: { ...makeLendingItem().inventoryItem, quantity: 1, retiredQuantity: 0 } });
    lendingLoansFindManyResult = [];
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", lastName: "Externer", quantity: "5" }),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.find((c) => c.table === lendingLoans)).toBeUndefined();
  });

  it("re-renders the form with the entered person fields on a conflict", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    lendingLoansFindManyResult = [{ id: "loan1", quantity: 1, plannedFrom: "2026-01-01", plannedTo: "2026-01-10", pickedUpAt: null, returnedAt: null }];
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", borrowerPersonId: "p1", firstName: "Max", lastName: "Muster", plannedFrom: "2026-01-05", plannedTo: "2026-01-15" }),
    });
    const html = await res.text();
    expect(res.status).toBe(422);
    expect(html).toContain('value="Muster"');
    expect(html).toContain('value="p1"');
  });

  it("updates an existing person instead of creating one", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", borrowerPersonId: "p1", firstName: "Max", lastName: "Muster", email: "m@x.de", plannedFrom: "2026-01-05", plannedTo: "2026-01-15" }),
    });
    expect(res.status).toBe(302);
    expect(updateCalls.find((c) => c.set.email === "m@x.de")?.set).toMatchObject({ lastName: "Muster", phone: null });
    expect(insertCalls.find((c) => c.table === lendingLoans)?.values).toMatchObject({ borrowerPersonId: "p1" });
    expect(insertCalls.filter((c) => c.table !== lendingLoans)).toHaveLength(0);
  });

  it("creates a new person with contact data for an external borrower", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", lastName: "Extern", phone: "0171 1", plannedFrom: "2026-01-05", plannedTo: "2026-01-15" }),
    });
    expect(res.status).toBe(302);
    expect(insertCalls.find((c) => c.table !== lendingLoans)?.values).toMatchObject({ lastName: "Extern", phone: "0171 1", email: null });
    expect(insertCalls.find((c) => c.table === lendingLoans)?.values).toMatchObject({ borrowerPersonId: "new-id" });
  });

  it("renders the date error as a block element, not inline next to the button", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", lastName: "X", phone: "1", plannedFrom: "2026-01-05", plannedTo: "2026-01-06", returnedAt: "2026-01-06" }),
    });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain('<p class="text-error text-sm" role="alert">Rückgabe ohne Abholdatum nicht möglich.</p>');
  });

  it("rejects a planned end before the planned start on creation and edit", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", lastName: "X", phone: "1", plannedFrom: "2026-01-10", plannedTo: "2026-01-05" }),
    });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("liegt vor");
    expect(insertCalls.length).toBe(0);
  });

  it("requires planned from and to on creation, pickup/return stay optional", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    const send = (fields: Record<string, string>) => lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", lastName: "X", phone: "1", ...fields }),
    });
    expect((await send({})).status).toBe(422);
    expect((await send({ plannedTo: "2026-01-05", pickedUpAt: "2026-01-01" })).status).toBe(422);
    expect((await send({ plannedFrom: "2026-01-05" })).status).toBe(422);
    expect(insertCalls.length).toBe(0);
    expect((await send({ plannedFrom: "2026-01-05", plannedTo: "2026-01-06" })).status).toBe(302);
  });

  it("requires email or phone for a new person, but not for an existing one", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    const send = (fields: Record<string, string>) => lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", plannedFrom: "2026-01-05", plannedTo: "2026-01-06", ...fields }),
    });
    const res = await send({ lastName: "Neu" });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("E-Mail oder Telefon angeben.");
    expect(insertCalls.length).toBe(0);
    expect((await send({ lastName: "Neu", email: "a@b.de" })).status).toBe(302);
    expect((await send({ borrowerPersonId: "p1", lastName: "Alt" })).status).toBe(302);
  });

  it("requires a last name once a person is being entered", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", firstName: "Nur", plannedFrom: "2026-01-05", plannedTo: "2026-01-06" }),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.length).toBe(0);
  });
});

// ── GET /loans/new + POST /loans (Item aus Formular) ────────────────────────

describe("GET /inventory/lending/loans/new (borrower picker)", () => {
  it("starts with the person search open and the fields hidden", async () => {
    lendingItemsFindManyResult = [makeLendingItem()];
    const html = await (await lendingRoutes.request("/loans/new")).text();
    expect(html).toContain("/inventory/lending/search-persons");
    expect(html).toMatch(/id="borrower-personId"[^>]*value=""/);
    expect(html).toMatch(/id="borrower-fields" class="space-y-4 hidden"/);
  });
});

describe("GET /inventory/lending/search-persons", () => {
  it("returns nothing for a too-short query", async () => {
    expect(await (await lendingRoutes.request("/search-persons?q=a")).text()).toBe("");
  });

  it("lists hits with contact data and offers to create a new person", async () => {
    searchPersonsResult = [{ id: "p1", firstName: "Max", lastName: "Muster", email: "m@x.de", phone: null }];
    const html = await (await lendingRoutes.request("/search-persons?q=mus")).text();
    expect(html).toContain("Max Muster");
    expect(html).toContain('data-email="m@x.de"');
    expect(html).toContain("borrower-create-new");
  });

  it("shows a no-results message plus the create option", async () => {
    const html = await (await lendingRoutes.request("/search-persons?q=xyz")).text();
    expect(html).toContain("Keine Treffer");
    expect(html).toContain("borrower-create-new");
  });
});

describe("GET /inventory/lending/loans/new", () => {
  it("lists lendable, non-retired items and preselects ?item=", async () => {
    lendingItemsFindManyResult = [
      makeLendingItem({ id: "li1" }),
      makeLendingItem({ id: "li2", inventoryItem: { ...makeLendingItem().inventoryItem, name: "Ausgemustert", retiredAt: "2026-01-01" } }),
    ];
    const html = await (await lendingRoutes.request("/loans/new?item=li1")).text();
    expect(html).toContain("Stehtisch #1");
    expect(html).not.toContain("Ausgemustert");
    expect(html).toMatch(/<option value="li1" selected/);
  });
});

describe("POST /inventory/lending/loans", () => {
  it("rejects a missing item with 422", async () => {
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lastName: "Externer" }),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.length).toBe(0);
  });

  it("creates the loan for the selected item and redirects to the list", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", lastName: "Externer", phone: "0171 1", plannedFrom: "2026-01-05", plannedTo: "2026-01-15" }),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/inventory/lending?item=li1&start=&end=");
    expect(insertCalls.find((c) => c.table === lendingLoans)?.values).toMatchObject({ lendingItemId: "li1", borrowerPersonId: "new-id" });
  });

  it("still enforces availability", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    lendingLoansFindManyResult = [{ id: "loan1", quantity: 1, plannedFrom: "2026-01-01", plannedTo: "2026-01-10", pickedUpAt: null, returnedAt: null }];
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", lastName: "Externer", phone: "0171 1", plannedFrom: "2026-01-05", plannedTo: "2026-01-15" }),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.length).toBe(0);
  });

  it("saves optional planned times", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", lastName: "Externer", phone: "0171 1", plannedFrom: "2026-01-05", plannedTo: "2026-01-05", plannedFromTime: "08:00", plannedToTime: "12:00" }),
    });
    expect(res.status).toBe(302);
    expect(insertCalls.find((c) => c.table === lendingLoans)?.values).toMatchObject({ plannedFromTime: "08:00", plannedToTime: "12:00" });
  });

  it("rejects a lone time without its counterpart", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", lastName: "Externer", phone: "0171 1", plannedFrom: "2026-01-05", plannedTo: "2026-01-05", plannedFromTime: "08:00" }),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.length).toBe(0);
  });

  it("rejects a same-day end time before the start time", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", lastName: "Externer", phone: "0171 1", plannedFrom: "2026-01-05", plannedTo: "2026-01-05", plannedFromTime: "12:00", plannedToTime: "08:00" }),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.length).toBe(0);
  });
});

// ── GET /:id/loans (detail) ──────────────────────────────────────────────────

// ── POST /loans/:loanId (edit) ───────────────────────────────────────────────

describe("POST /inventory/lending/loans/:loanId", () => {
  it("404s for an unknown loan", async () => {
    lendingLoansFindFirstResult = undefined;
    const res = await lendingRoutes.request("/loans/missing", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({}),
    });
    expect(res.status).toBe(404);
  });

  it("404s when the loan's item is missing", async () => {
    lendingLoansFindFirstResult = { id: "loan1", lendingItemId: "li1", quantity: 1, plannedFrom: "2026-01-01", plannedTo: "2026-01-05", pickedUpAt: null, returnedAt: null };
    lendingItemsFindFirstResult = undefined;
    const res = await lendingRoutes.request("/loans/loan1", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({}),
    });
    expect(res.status).toBe(404);
  });

  it("redirects with a flash error on conflict", async () => {
    lendingLoansFindFirstResult = { id: "loan1", lendingItemId: "li1", quantity: 1, plannedFrom: "2026-01-01", plannedTo: "2026-01-05", pickedUpAt: null, returnedAt: null };
    lendingItemsFindFirstResult = makeLendingItem();
    lendingLoansFindManyResult = [
      lendingLoansFindFirstResult,
      { id: "loan2", quantity: 1, plannedFrom: "2026-02-01", plannedTo: "2026-02-10", pickedUpAt: null, returnedAt: null },
    ];
    const res = await lendingRoutes.request("/loans/loan1", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ plannedFrom: "2026-02-05", plannedTo: "2026-02-06" }),
    });
    expect(res.status).toBe(302);
    expect(updateCalls.length).toBe(0);
  });

  it("records pickedUpAt/returnedAt", async () => {
    lendingLoansFindFirstResult = { id: "loan1", lendingItemId: "li1", quantity: 1, plannedFrom: "2026-01-01", plannedTo: "2026-01-05", pickedUpAt: null, returnedAt: null };
    lendingItemsFindFirstResult = makeLendingItem();
    lendingLoansFindManyResult = [lendingLoansFindFirstResult];
    const res = await lendingRoutes.request("/loans/loan1", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ plannedFrom: "2026-01-01", plannedTo: "2026-01-05", pickedUpAt: "2026-01-01", returnedAt: "2026-01-05" }),
    });
    expect(res.status).toBe(302);
    expect(updateCalls[0].set).toMatchObject({ pickedUpAt: "2026-01-01", returnedAt: "2026-01-05" });
  });

  it("updates planned times", async () => {
    lendingLoansFindFirstResult = { id: "loan1", lendingItemId: "li1", quantity: 1, plannedFrom: "2026-01-01", plannedTo: "2026-01-05", plannedFromTime: null, plannedToTime: null, pickedUpAt: null, returnedAt: null };
    lendingItemsFindFirstResult = makeLendingItem();
    lendingLoansFindManyResult = [lendingLoansFindFirstResult];
    const res = await lendingRoutes.request("/loans/loan1", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ plannedFrom: "2026-01-01", plannedTo: "2026-01-01", plannedFromTime: "09:00", plannedToTime: "11:00" }),
    });
    expect(res.status).toBe(302);
    expect(updateCalls[0].set).toMatchObject({ plannedFromTime: "09:00", plannedToTime: "11:00" });
  });
});

// ── Vorgangsseite ────────────────────────────────────────────────────────────

describe("loan page", () => {
  const planned = { id: "loan1", lendingItemId: "li1", quantity: 1, plannedFrom: "2026-01-01", plannedTo: "2026-01-05", pickedUpAt: null, returnedAt: null, borrower: person("Externer"), borrowerPersonId: "p-Externer" };
  const post = (path: string, fields: Record<string, string>) =>
    lendingRoutes.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody(fields),
    });

  beforeEach(() => {
    lendingLoansFindFirstResult = planned;
    lendingItemsFindFirstResult = makeLendingItem();
    lendingLoansFindManyResult = [planned];
  });

  const page = async () => (await lendingRoutes.request("/loans/loan1")).text();

  it("renders the edit form and the delete action", async () => {
    const html = await page();
    expect(html).toContain('action="/inventory/lending/loans/loan1"');
    expect(html).toContain("/loans/loan1/delete");
    expect(html).not.toContain("/loans/loan1/pickup");
  });

  it("links email and phone of the borrower", async () => {
    lendingLoansFindFirstResult = { ...planned, borrower: person("Externer", { email: "max@example.org", phone: "0171 123 456" }) };
    const html = await page();
    expect(html).toContain('href="mailto:max@example.org"');
    expect(html).toContain('href="tel:0171123456"');
  });

  it("404s for an unknown loan", async () => {
    lendingLoansFindFirstResult = undefined;
    expect((await lendingRoutes.request("/loans/missing")).status).toBe(404);
  });

  it("rejects a return before pickup and redirects back to the loan page", async () => {
    const res = await post("/loans/loan1", { pickedUpAt: "2026-01-03", returnedAt: "2026-01-02" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/inventory/lending/loans/loan1");
    expect(updateCalls.length).toBe(0);
  });

  it("rejects a return without pickup", async () => {
    const res = await post("/loans/loan1", { returnedAt: "2026-01-02" });
    expect(res.headers.get("location")).toBe("/inventory/lending/loans/loan1");
    expect(updateCalls.length).toBe(0);
  });

  it("never blocks recording a pickup on availability", async () => {
    lendingLoansFindManyResult = [planned, { id: "loan2", quantity: 1, plannedFrom: "2026-01-02", plannedTo: "2026-01-04", pickedUpAt: null, returnedAt: null }];
    const res = await post("/loans/loan1", { pickedUpAt: "2026-01-03" });
    expect(res.status).toBe(302);
    expect(updateCalls[0].set).toMatchObject({ pickedUpAt: "2026-01-03" });
  });

  it("rejects a planned end before the planned start when editing", async () => {
    const res = await post("/loans/loan1", { plannedFrom: "2026-01-10", plannedTo: "2026-01-05" });
    expect(res.headers.get("location")).toBe("/inventory/lending/loans/loan1");
    expect(updateCalls.length).toBe(0);
  });

  it("edit keeps fields missing from the body", async () => {
    const res = await post("/loans/loan1", { pickedUpAt: "2026-01-02" });
    expect(res.status).toBe(302);
    expect(updateCalls[0].set).toMatchObject({ plannedFrom: "2026-01-01", plannedTo: "2026-01-05", pickedUpAt: "2026-01-02", quantity: 1 });
  });

  it("deletes the loan and redirects", async () => {
    const res = await post("/loans/loan1/delete", {});
    expect(res.status).toBe(302);
    expect(deleteCalls.length).toBe(1);
  });

  it("404s delete for an unknown loan", async () => {
    lendingLoansFindFirstResult = undefined;
    expect((await post("/loans/missing/delete", {})).status).toBe(404);
    expect(deleteCalls.length).toBe(0);
  });

  it("applies the date rules when creating", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    const res = await post("/loans", { lendingItemId: "li1", lastName: "X", returnedAt: "2026-01-02" });
    expect(res.status).toBe(422);
    expect(insertCalls.length).toBe(0);
  });

  it("links rows to the loan page for managers only", async () => {
    lendingLoansFindManyResult = [{ ...planned, lendingItem: makeLendingItem() }];
    expect(await (await lendingRoutes.request("/?start=&end=")).text()).toContain("/inventory/lending/loans/loan1");
    currentUser = { ...currentUser, permissions: new Set(["lending:read"]) };
    const html = await (await lendingRoutes.request("/?start=&end=")).text();
    expect(html).not.toContain("/inventory/lending/loans/loan1");
  });
});

describe("GET /lending toggle filter", () => {
  const toggleInputs = (html: string) => html.match(/<input[^>]*class="toggle toggle-primary"[^>]*data-href[^>]*>/g) ?? [];
  it("both toggles on without a parameter, no \"Alle\" entry", async () => {
    const html = await (await lendingRoutes.request("/")).text();
    const inputs = toggleInputs(html);
    expect(inputs).toHaveLength(2);
    expect(inputs.filter((i) => i.includes("checked"))).toHaveLength(2);
    expect(inputs.filter((i) => i.includes("disabled"))).toHaveLength(0);
    expect(html).not.toContain(">Alle<");
  });

  it("a single active toggle (old link) is checked; switching it off activates the other", async () => {
    for (const [qs, idx] of [["?member=yes", 0], ["?member=no", 1]] as const) {
      const inputs = toggleInputs(await (await lendingRoutes.request(`/${qs}`)).text());
      expect(inputs.filter((i) => i.includes("checked"))).toHaveLength(1);
      expect(inputs[idx]).toContain("checked");
      expect(inputs[idx]).not.toContain("disabled");
      expect(inputs[idx]).toContain(["member=yes", "member=no"][1 - idx]);
      expect(inputs[1 - idx]).not.toContain("checked");
    }
  });
});
