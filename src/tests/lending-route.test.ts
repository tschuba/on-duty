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
});

// ── POST /new (convenience form) ────────────────────────────────────────────

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
