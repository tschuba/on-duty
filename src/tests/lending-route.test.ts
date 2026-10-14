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

// ── GET / (Vorgangsliste) ─────────────────────────────────────────────────────

describe("GET /inventory/lending", () => {
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
    const res = await lendingRoutes.request("/");
    const html = await res.text();
    expect(html).toContain("Externer");
    expect(html).toContain("Stehtisch #1");
  });

  it("shows member borrower name when loan has a member", async () => {
    lendingLoansFindManyResult = [makeLoan({ borrowerMember: { person: { firstName: "Max", lastName: "Muster" } }, borrowerName: null })];
    const res = await lendingRoutes.request("/");
    const html = await res.text();
    expect(html).toContain("Max Muster");
  });

  it("marks overdue loans and groups multiple months with multiple loans each", async () => {
    lendingLoansFindManyResult = [
      makeLoan({ id: "loan1", plannedFrom: "2026-01-01", plannedTo: "1999-01-01", borrowerName: "Erster" }),
      makeLoan({ id: "loan2", plannedFrom: "2026-01-02", plannedTo: "2026-01-03", borrowerName: null, borrowerMember: null }),
      makeLoan({ id: "loan3", plannedFrom: "2026-02-01", plannedTo: "2026-02-05", borrowerName: "Dritter" }),
    ];
    const res = await lendingRoutes.request("/");
    const html = await res.text();
    expect(html).toContain("Erster");
    expect(html).toContain("\u2014");
  });

  it("excludes finished loans outside the default window", async () => {
    lendingLoansFindManyResult = [makeLoan({ returnedAt: "2020-01-01", plannedFrom: "2020-01-01" })];
    const res = await lendingRoutes.request("/");
    const html = await res.text();
    expect(html).toContain(t_empty());
    function t_empty() { return "Keine"; }
  });

  it("includes non-returned loans past the default window", async () => {
    lendingLoansFindManyResult = [makeLoan({ returnedAt: null, plannedFrom: "2020-01-01", plannedTo: "2020-01-05" })];
    const res = await lendingRoutes.request("/");
    const html = await res.text();
    expect(html).toContain("Externer");
  });

  it("supports an explicit date range", async () => {
    lendingLoansFindManyResult = [makeLoan({ plannedFrom: "2026-01-01" }), makeLoan({ id: "loan2", plannedFrom: "2030-01-01", plannedTo: "2030-01-05" })];
    const res = await lendingRoutes.request("/?start=2030-01-01&end=2030-01-31");
    const html = await res.text();
    expect(html).toContain("2030");
  });

  it("filters by free text on item name and borrower", async () => {
    lendingLoansFindManyResult = [
      makeLoan({ id: "l1", borrowerName: "Alpha" }),
      makeLoan({ id: "l2", borrowerName: "Beta", lendingItem: makeLendingItem({ inventoryItem: { ...makeLendingItem().inventoryItem, name: "Zelt" } }) }),
    ];
    const byBorrower = await (await lendingRoutes.request("/?q=alp")).text();
    expect(byBorrower).toContain("Alpha");
    expect(byBorrower).not.toContain("Beta");
    const byItem = await (await lendingRoutes.request("/?q=zelt")).text();
    expect(byItem).toContain("Beta");
    expect(byItem).not.toContain("Alpha");
  });

  it("filters by status", async () => {
    lendingLoansFindManyResult = [
      makeLoan({ id: "l1", borrowerName: "Offen", plannedFrom: "2999-01-01", plannedTo: "2999-01-05" }),
      makeLoan({ id: "l2", borrowerName: "Ueberfaellig", plannedFrom: "2020-01-01", plannedTo: "2020-01-05", pickedUpAt: "2020-01-01" }),
    ];
    const html = await (await lendingRoutes.request("/?status=overdue")).text();
    expect(html).toContain("Ueberfaellig");
    expect(html).not.toContain("Offen");
  });

  it("filters by category", async () => {
    lendingLoansFindManyResult = [
      makeLoan({ id: "l1", borrowerName: "Anderer" }),
      makeLoan({ id: "l2", borrowerName: "Fahrzeug", lendingItem: makeLendingItem({ inventoryItem: { ...makeLendingItem().inventoryItem, category: "vehicle" } }) }),
    ];
    const html = await (await lendingRoutes.request("/?category=vehicle&start=2026-01-01&end=2026-12-31")).text();
    expect(html).toContain("Fahrzeug");
    expect(html).not.toContain("Anderer");
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

  it("blocks a quantity above stock even without dates", async () => {
    lendingItemsFindFirstResult = makeLendingItem({ individualTracking: false, inventoryItem: { ...makeLendingItem().inventoryItem, quantity: 1, retiredQuantity: 0 } });
    lendingLoansFindManyResult = [];
    const res = await lendingRoutes.request("/li1/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ borrowerType: "external", borrowerName: "Externer", quantity: "5" }),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.find((c) => c.table === lendingLoans)).toBeUndefined();
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

// ── GET /loans/new + POST /loans (Item aus Formular) ────────────────────────

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
      body: formBody({ borrowerType: "external", borrowerName: "Externer" }),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.length).toBe(0);
  });

  it("creates the loan for the selected item and redirects to the list", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", borrowerType: "external", borrowerName: "Externer", plannedFrom: "2026-01-05", plannedTo: "2026-01-15" }),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/inventory/lending");
    expect(insertCalls.find((c) => c.table === lendingLoans)?.values).toMatchObject({ lendingItemId: "li1", borrowerName: "Externer" });
  });

  it("still enforces availability", async () => {
    lendingItemsFindFirstResult = makeLendingItem();
    lendingLoansFindManyResult = [{ id: "loan1", quantity: 1, plannedFrom: "2026-01-01", plannedTo: "2026-01-10", pickedUpAt: null, returnedAt: null }];
    const res = await lendingRoutes.request("/loans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ lendingItemId: "li1", borrowerType: "external", borrowerName: "Externer", plannedFrom: "2026-01-05", plannedTo: "2026-01-15" }),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.length).toBe(0);
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

// ── Aktions-Popup ────────────────────────────────────────────────────────────

describe("loan dialog", () => {
  const planned = { id: "loan1", lendingItemId: "li1", quantity: 1, plannedFrom: "2026-01-01", plannedTo: "2026-01-05", pickedUpAt: null, returnedAt: null, borrowerMember: null, borrowerName: "Externer" };
  const post = (path: string, fields: Record<string, string>, htmx = false) =>
    lendingRoutes.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...(htmx ? { "HX-Request": "true" } : {}) },
      body: formBody(fields),
    });

  beforeEach(() => {
    lendingLoansFindFirstResult = planned;
    lendingItemsFindFirstResult = makeLendingItem();
    lendingLoansFindManyResult = [planned];
  });

  it("offers pickup, edit and delete for a planned loan", async () => {
    const html = await (await lendingRoutes.request("/loans/loan1/actions?returnTo=/inventory/lending%3Fstatus%3Dplanned")).text();
    expect(html).toContain("Abgeholt eintragen");
    expect(html).not.toContain("Zurückgegeben eintragen");
    expect(html).toContain("Bearbeiten");
    expect(html).toContain("Löschen");
    expect(html).toContain("Alle Vorgänge dieses Items");
  });

  it("offers return (not pickup) for a picked-up loan", async () => {
    lendingLoansFindFirstResult = { ...planned, pickedUpAt: "2026-01-01" };
    const html = await (await lendingRoutes.request("/loans/loan1/actions")).text();
    expect(html).toContain("Zurückgegeben eintragen");
    expect(html).not.toContain("Abgeholt eintragen");
  });

  it("offers only edit and delete for a returned loan", async () => {
    lendingLoansFindFirstResult = { ...planned, pickedUpAt: "2026-01-01", returnedAt: "2026-01-04" };
    const html = await (await lendingRoutes.request("/loans/loan1/actions")).text();
    expect(html).not.toContain("eintragen");
    expect(html).toContain("Bearbeiten");
  });

  it("prefills the pickup date and 404s for unknown views/loans", async () => {
    const html = await (await lendingRoutes.request("/loans/loan1/pickup")).text();
    expect(html).toContain(`value="${new Date().toISOString().slice(0, 10)}"`);
    expect((await lendingRoutes.request("/loans/loan1/bogus")).status).toBe(404);
    lendingLoansFindFirstResult = undefined;
    expect((await lendingRoutes.request("/loans/missing/actions")).status).toBe(404);
  });

  it("pickup only touches pickedUpAt and keeps planned dates", async () => {
    const res = await post("/loans/loan1/pickup", { pickedUpAt: "2026-01-02", returnTo: "/inventory/lending?status=planned" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/inventory/lending?status=planned");
    expect(updateCalls[0].set).toEqual({ pickedUpAt: "2026-01-02" });
  });

  it("uses HX-Redirect for htmx posts", async () => {
    const res = await post("/loans/loan1/pickup", { pickedUpAt: "2026-01-02", returnTo: "/inventory/lending" }, true);
    expect(res.status).toBe(200);
    expect(res.headers.get("HX-Redirect")).toBe("/inventory/lending");
  });

  it("ignores a foreign returnTo", async () => {
    const res = await post("/loans/loan1/pickup", { pickedUpAt: "2026-01-02", returnTo: "https://evil.example/" });
    expect(res.headers.get("location")).toBe("/inventory/lending/li1/loans");
  });

  it("rejects a return before pickup inline in the dialog", async () => {
    lendingLoansFindFirstResult = { ...planned, pickedUpAt: "2026-01-03" };
    const res = await post("/loans/loan1/return", { returnedAt: "2026-01-02" }, true);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("liegt vor dem Abholdatum");
    expect(updateCalls.length).toBe(0);
  });

  it("rejects a return without pickup", async () => {
    const res = await post("/loans/loan1/return", { returnedAt: "2026-01-02" }, true);
    expect(await res.text()).toContain("ohne Abholdatum");
    expect(updateCalls.length).toBe(0);
  });

  it("never blocks a pickup on availability", async () => {
    lendingLoansFindManyResult = [planned, { id: "loan2", quantity: 1, plannedFrom: "2026-01-02", plannedTo: "2026-01-04", pickedUpAt: null, returnedAt: null }];
    const res = await post("/loans/loan1/pickup", { pickedUpAt: "2026-01-03" });
    expect(res.status).toBe(302);
    expect(updateCalls[0].set).toEqual({ pickedUpAt: "2026-01-03" });
  });

  it("edit keeps fields missing from the body", async () => {
    const res = await post("/loans/loan1", { pickedUpAt: "2026-01-02" });
    expect(res.status).toBe(302);
    expect(updateCalls[0].set).toMatchObject({ plannedFrom: "2026-01-01", plannedTo: "2026-01-05", pickedUpAt: "2026-01-02", quantity: 1 });
  });

  it("deletes the loan and redirects", async () => {
    const res = await post("/loans/loan1/delete", { returnTo: "/inventory/lending" });
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
    const res = await post("/li1/loans", { borrowerType: "external", borrowerName: "X", returnedAt: "2026-01-02" });
    expect(res.status).toBe(422);
    expect(insertCalls.length).toBe(0);
  });

  it("shows the dialog trigger only for managers", async () => {
    lendingLoansFindManyResult = [{ ...planned, lendingItem: makeLendingItem() }];
    expect(await (await lendingRoutes.request("/")).text()).toContain("hx-get");
    currentUser = { ...currentUser, permissions: new Set(["lending:read"]) };
    const html = await (await lendingRoutes.request("/")).text();
    expect(html).not.toContain("hx-get");
    expect(html).toContain("window.location");
  });
});
