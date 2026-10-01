import { describe, it, expect, vi, beforeEach } from "vitest";
import { inventoryItems, inventoryItemTags, lendingItems, lendingLoans } from "../db/schema/index.js";
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

const insert = makeInsert();
const update = makeUpdate();
const transaction = vi.fn(async (cb: any) => cb({ insert, update }));

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
  lendingItemsFindManyResult = [];
  lendingItemsFindFirstResult = undefined;
  lendingLoansFindManyResult = [];
  lendingLoansFindFirstResult = undefined;
  membersFindFirstResult = undefined;
  currentUser = { id: "u1", permissions: new Set(["lending:read", "lending:manage"]), disabled: false };
});

function makeLendingItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "li1",
    inventoryItemId: "item1",
    individualTracking: true,
    inventoryItem: {
      id: "item1", name: "Stehtisch #1", category: "other",
      retiredAt: null, retiredReason: null, quantity: 1, retiredQuantity: 0,
      tags: [],
    },
    ...overrides,
  };
}

// ── GET / (list) ─────────────────────────────────────────────────────────────

describe("GET /inventory/lending", () => {
  it("lists active lending items with available quantity", async () => {
    lendingItemsFindManyResult = [makeLendingItem()];
    const res = await lendingRoutes.request("/");
    const html = await res.text();
    expect(html).toContain("Stehtisch #1");
  });

  it("hides items whose inventory item is retired", async () => {
    lendingItemsFindManyResult = [makeLendingItem({ inventoryItem: { ...makeLendingItem().inventoryItem, retiredAt: "2026-01-01" } })];
    const res = await lendingRoutes.request("/");
    const html = await res.text();
    expect(html).not.toContain("Stehtisch #1");
  });

  it("excludes a loan with no effective date range from availability", async () => {
    lendingItemsFindManyResult = [makeLendingItem()];
    lendingLoansFindManyResult = [{ id: "loan1", quantity: 1, plannedFrom: null, plannedTo: null, pickedUpAt: null, returnedAt: null }];
    const res = await lendingRoutes.request("/");
    expect(res.status).toBe(200);
  });

  it("shows multiple items with distinct tags", async () => {
    lendingItemsFindManyResult = [
      makeLendingItem({ id: "li1", inventoryItem: { ...makeLendingItem().inventoryItem, name: "A", tags: [{ tag: "keller" }] } }),
      makeLendingItem({ id: "li2", inventoryItem: { ...makeLendingItem().inventoryItem, name: "B", tags: [{ tag: "dach" }] } }),
    ];
    const res = await lendingRoutes.request("/");
    const html = await res.text();
    expect(html).toContain("A");
    expect(html).toContain("B");
  });

  it("filters by category and tag", async () => {
    lendingItemsFindManyResult = [
      makeLendingItem({ id: "li1", inventoryItem: { ...makeLendingItem().inventoryItem, name: "A", category: "other", tags: [{ tag: "keller" }] } }),
      makeLendingItem({ id: "li2", inventoryItem: { ...makeLendingItem().inventoryItem, name: "B", category: "vehicle", tags: [] } }),
    ];
    const res = await lendingRoutes.request("/?category=other&tag=keller");
    const html = await res.text();
    expect(html).toContain("A");
    expect(html).not.toContain(">B<");
  });
});

// ── GET /overview ────────────────────────────────────────────────────────────

describe("GET /inventory/lending/overview", () => {
  function makeLoan(overrides: Record<string, unknown> = {}) {
    return {
      id: "loan1",
      quantity: 1,
      plannedFrom: "2026-01-01",
      plannedTo: "2026-01-05",
      pickedUpAt: null,
      returnedAt: null,
      borrowerMember: null,
      borrowerName: "Externer",
      lendingItem: makeLendingItem(),
      ...overrides,
    };
  }

  it("shows loans grouped by month, newest default window", async () => {
    lendingLoansFindManyResult = [makeLoan()];
    const res = await lendingRoutes.request("/overview");
    const html = await res.text();
    expect(html).toContain("Externer");
    expect(html).toContain("Stehtisch #1");
  });

  it("shows member borrower name when loan has a member", async () => {
    lendingLoansFindManyResult = [makeLoan({ borrowerMember: { person: { firstName: "Max", lastName: "Muster" } }, borrowerName: null })];
    const res = await lendingRoutes.request("/overview");
    const html = await res.text();
    expect(html).toContain("Max Muster");
  });

  it("marks overdue loans and groups multiple months with multiple loans each", async () => {
    lendingLoansFindManyResult = [
      makeLoan({ id: "loan1", plannedFrom: "2026-01-01", plannedTo: "1999-01-01", borrowerName: "Erster" }),
      makeLoan({ id: "loan2", plannedFrom: "2026-01-02", plannedTo: "2026-01-03", borrowerName: null, borrowerMember: null }),
      makeLoan({ id: "loan3", plannedFrom: "2026-02-01", plannedTo: "2026-02-05", borrowerName: "Dritter" }),
    ];
    const res = await lendingRoutes.request("/overview");
    const html = await res.text();
    expect(html).toContain("Erster");
    expect(html).toContain("\u2014");
  });

  it("excludes finished loans outside the default window", async () => {
    lendingLoansFindManyResult = [makeLoan({ returnedAt: "2020-01-01", plannedFrom: "2020-01-01" })];
    const res = await lendingRoutes.request("/overview");
    const html = await res.text();
    expect(html).toContain(t_empty());
    function t_empty() { return "Keine"; }
  });

  it("includes non-returned loans past the default window", async () => {
    lendingLoansFindManyResult = [makeLoan({ returnedAt: null, plannedFrom: "2020-01-01", plannedTo: "2020-01-05" })];
    const res = await lendingRoutes.request("/overview");
    const html = await res.text();
    expect(html).toContain("Externer");
  });

  it("supports an explicit date range", async () => {
    lendingLoansFindManyResult = [makeLoan({ plannedFrom: "2026-01-01" }), makeLoan({ id: "loan2", plannedFrom: "2030-01-01", plannedTo: "2030-01-05" })];
    const res = await lendingRoutes.request("/overview?start=2030-01-01&end=2030-01-31");
    const html = await res.text();
    expect(html).toContain("2030");
  });

  it("renders empty state with no loans", async () => {
    lendingLoansFindManyResult = [];
    const res = await lendingRoutes.request("/overview");
    expect(res.status).toBe(200);
  });
});

// ── POST /new (convenience form) ────────────────────────────────────────────

describe("GET /inventory/lending/new", () => {
  it("renders the new-item form", async () => {
    const res = await lendingRoutes.request("/new");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("lending-new-form");
  });
});

describe("POST /inventory/lending/new", () => {
  it("rejects a missing name/category", async () => {
    const res = await lendingRoutes.request("/new", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ name: "", category: "" }),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.length).toBe(0);
  });

  it("creates inventory_items + lending_items in one step", async () => {
    const res = await lendingRoutes.request("/new", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ name: "Stehtisch #1", category: "other", individualTracking: "1" }),
    });
    expect(res.status).toBe(302);
    expect(insertCalls[0].table).toBe(inventoryItems);
    expect(insertCalls.find((c) => c.table === lendingItems)?.values).toMatchObject({ inventoryItemId: "new-id", individualTracking: true });
  });

  it("inserts tags when provided", async () => {
    const res = await lendingRoutes.request("/new", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ name: "Stehtisch #2", category: "other", individualTracking: "1", tags: "keller,draussen" }),
    });
    expect(res.status).toBe(302);
    expect(insertCalls.find((c) => c.table === inventoryItemTags)).toBeDefined();
  });
});

// ── POST /:id/loans (availability check) ────────────────────────────────────

describe("POST /inventory/lending/:id/loans", () => {
  it("404s for an unknown item", async () => {
    lendingItemsFindFirstResult = undefined;
    const res = await lendingRoutes.request("/missing/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ borrowerName: "Externer" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects without a borrower", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    const res = await lendingRoutes.request("/li1/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ borrowerType: "external", plannedFrom: "2026-01-01", plannedTo: "2026-01-05" }),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.length).toBe(0);
  });

  it("blocks an individual-tracking item when the period overlaps an existing loan", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    lendingLoansFindManyResult = [{ id: "loan1", quantity: 1, plannedFrom: "2026-01-01", plannedTo: "2026-01-10", pickedUpAt: null, returnedAt: null }];
    const res = await lendingRoutes.request("/li1/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ borrowerType: "external", borrowerName: "Externer", plannedFrom: "2026-01-05", plannedTo: "2026-01-15" }),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.length).toBe(0);
  });

  it("creates a loan when the period is free", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    lendingLoansFindManyResult = [];
    const res = await lendingRoutes.request("/li1/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ borrowerType: "external", borrowerName: "Externer", plannedFrom: "2026-01-05", plannedTo: "2026-01-15" }),
    });
    expect(res.status).toBe(302);
    expect(insertCalls.find((c) => c.table === lendingLoans)?.values).toMatchObject({ lendingItemId: "li1", quantity: 1, borrowerName: "Externer" });
  });

  it("blocks a batch item once the summed overlapping quantity exceeds stock", async () => {
    lendingItemsFindFirstResult = makeLendingItem({ individualTracking: false, inventoryItem: { ...makeLendingItem().inventoryItem, quantity: 5, retiredQuantity: 0 } });
    lendingLoansFindManyResult = [{ id: "loan1", quantity: 4, plannedFrom: "2026-01-01", plannedTo: "2026-01-10", pickedUpAt: null, returnedAt: null }];
    const res = await lendingRoutes.request("/li1/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ borrowerType: "external", borrowerName: "Externer", quantity: "2", plannedFrom: "2026-01-05", plannedTo: "2026-01-06" }),
    });
    expect(res.status).toBe(422);
  });

  it("404s for a retired item", async () => {
    lendingItemsFindFirstResult = makeLendingItem({ inventoryItem: { ...makeLendingItem().inventoryItem, retiredAt: "2026-01-01" } });
    const res = await lendingRoutes.request("/li1/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ borrowerType: "external", borrowerName: "Externer" }),
    });
    expect(res.status).toBe(404);
  });

  it("re-renders the form with resolved member name when a member borrower hits a conflict", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    lendingLoansFindManyResult = [{ id: "loan1", quantity: 1, plannedFrom: "2026-01-01", plannedTo: "2026-01-10", pickedUpAt: null, returnedAt: null }];
    membersFindFirstResult = { person: { firstName: "Max", lastName: "Muster" } };
    const res = await lendingRoutes.request("/li1/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ borrowerType: "member", borrowerMemberId: "m1", plannedFrom: "2026-01-05", plannedTo: "2026-01-15" }),
    });
    const html = await res.text();
    expect(res.status).toBe(422);
    expect(html).toContain("Max Muster");
  });

  it("creates a loan for a known member borrower", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    const res = await lendingRoutes.request("/li1/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ borrowerType: "member", borrowerMemberId: "m1", plannedFrom: "2026-01-05", plannedTo: "2026-01-15" }),
    });
    expect(res.status).toBe(302);
    expect(insertCalls.find((c) => c.table === lendingLoans)?.values).toMatchObject({ borrowerMemberId: "m1" });
  });
});

// ── GET /:id/loans (detail) ──────────────────────────────────────────────────

describe("GET /inventory/lending/:id/loans", () => {
  it("404s for an unknown item", async () => {
    lendingItemsFindFirstResult = undefined;
    const res = await lendingRoutes.request("/missing/loans");
    expect(res.status).toBe(404);
  });

  it("shows retired notice and hides the loan form for a retired item", async () => {
    lendingItemsFindFirstResult = makeLendingItem({ inventoryItem: { ...makeLendingItem().inventoryItem, retiredAt: "2026-01-01" } });
    const res = await lendingRoutes.request("/li1/loans");
    const html = await res.text();
    expect(html).not.toContain("lending-new-form");
    expect(res.status).toBe(200);
  });

  it("marks overdue loans and shows the loan form for a manager", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    lendingLoansFindManyResult = [{ id: "loan1", quantity: 1, plannedFrom: "2020-01-01", plannedTo: "2020-01-05", pickedUpAt: "2020-01-01", returnedAt: null, borrowerMember: null, borrowerName: "Externer" }];
    const res = await lendingRoutes.request("/li1/loans");
    const html = await res.text();
    expect(html).toContain("Externer");
    expect(res.status).toBe(200);
  });

  it("renders empty loans table", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    lendingLoansFindManyResult = [];
    const res = await lendingRoutes.request("/li1/loans");
    expect(res.status).toBe(200);
  });
});

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
});
