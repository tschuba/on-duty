import { describe, it, expect, vi, beforeEach } from "vitest";
import { inventoryItems, inventoryItemTags, inventoryItemAssignments, lendingItems } from "../db/schema/index.js";
import { formBody } from "./test-utils.js";

process.env.CHILDREN_AGE_LIMIT = "12";
process.env.YOUTH_AGE_LIMIT = "18";

let itemsFindManyResult: any[] = [];
let itemsFindFirstResult: any = undefined;
let membersFindManyResult: any[] = [];
let lendingItemFindFirstResult: any = undefined;
let lendingItemsFindManyResult: any[] = [];
let lendingLoanFindFirstResult: any = undefined;

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
      inventoryItems: {
        findMany: vi.fn(() => Promise.resolve(itemsFindManyResult)),
        findFirst: vi.fn(() => Promise.resolve(itemsFindFirstResult)),
      },
      members: {
        findMany: vi.fn(() => Promise.resolve(membersFindManyResult)),
      },
      lendingItems: {
        findFirst: vi.fn(() => Promise.resolve(lendingItemFindFirstResult)),
        findMany: vi.fn(() => Promise.resolve(lendingItemsFindManyResult)),
      },
      lendingLoans: {
        findFirst: vi.fn(() => Promise.resolve(lendingLoanFindFirstResult)),
        findMany: vi.fn(() => Promise.resolve([])),
      },
    },
    insert,
    update,
    delete: del,
    transaction,
  },
}));

let currentUser = { id: "u1", permissions: new Set(["inventory:read", "inventory:manage"]), disabled: false };

vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => async (c: any, next: any) => {
    c.set("user", currentUser);
    await next();
  },
}));

const { inventoryRoutes } = await import("../routes/inventory.js");

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  itemsFindManyResult = [];
  itemsFindFirstResult = undefined;
  membersFindManyResult = [];
  lendingItemFindFirstResult = undefined;
  lendingItemsFindManyResult = [];
  lendingLoanFindFirstResult = undefined;
  currentUser = { id: "u1", permissions: new Set(["inventory:read", "inventory:manage"]), disabled: false };
});

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item1", name: "TSF-W", category: "vehicle",
    purchaseDate: null, purchasePrice: null, notes: null,
    retiredAt: null, retiredReason: null, quantity: 1, retiredQuantity: 0,
    licensePlate: "ABC-123", yearOfManufacture: 2015, vehicleInspectionDue: "2026-06-01",
    serialNumber: null, nextInspectionDue: null, lastInspectionDate: null,
    tags: [], assignments: [],
    ...overrides,
  };
}

// ── GET / (list) ─────────────────────────────────────────────────────────────

describe("GET /", () => {
  it("lists items with category badge", async () => {
    itemsFindManyResult = [makeItem()];
    const res = await inventoryRoutes.request("/");
    const html = await res.text();
    expect(html).toContain("TSF-W");
    expect(html).toContain("Fahrzeuge");
  });

  it("hides retired items by default", async () => {
    itemsFindManyResult = [makeItem({ id: "a", name: "Aktiv" }), makeItem({ id: "b", name: "Alt", retiredAt: "2026-01-01" })];
    const res = await inventoryRoutes.request("/");
    const html = await res.text();
    expect(html).toContain("Aktiv");
    expect(html).not.toContain("Alt");
  });

  it("shows retired items with ?archived=1", async () => {
    itemsFindManyResult = [makeItem({ id: "b", name: "Alt", retiredAt: "2026-01-01" })];
    const res = await inventoryRoutes.request("/?archived=1");
    const html = await res.text();
    expect(html).toContain("Alt");
  });

  it("filters by category", async () => {
    itemsFindManyResult = [makeItem({ id: "a", name: "Fahrzeugname", category: "vehicle" }), makeItem({ id: "b", name: "Jacke", category: "ppe" })];
    const res = await inventoryRoutes.request("/?category=ppe");
    const html = await res.text();
    expect(html).toContain("Jacke");
    expect(html).not.toContain("Fahrzeugname");
  });

  it("filters by tag (item must carry every selected tag)", async () => {
    itemsFindManyResult = [
      makeItem({ id: "a", name: "Mit Tag", tags: [{ tag: "gross" }] }),
      makeItem({ id: "b", name: "Ohne Tag", tags: [] }),
    ];
    const res = await inventoryRoutes.request("/?tag=gross");
    const html = await res.text();
    expect(html).toContain("Mit Tag");
    expect(html).not.toContain("Ohne Tag");
  });
});

// ── POST / (create) ──────────────────────────────────────────────────────────

describe("POST /", () => {
  it("rejects a missing name/category", async () => {
    const res = await inventoryRoutes.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ name: "", category: "" }),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.length).toBe(0);
  });

  it("creates an item with tags", async () => {
    const res = await inventoryRoutes.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ name: "Helm", category: "equipment", tags: "schnell,gross" }),
    });
    expect(res.status).toBe(302);
    expect(insertCalls[0].table).toBe(inventoryItems);
    expect(insertCalls[0].values).toMatchObject({ name: "Helm", category: "equipment" });
    expect(insertCalls[1].table).toBe(inventoryItemTags);
    expect(insertCalls[1].values).toEqual([{ inventoryItemId: "new-id", tag: "schnell" }, { inventoryItemId: "new-id", tag: "gross" }]);
  });

  it("drops assignedMemberId for a non-ppe category (no assignment row is inserted)", async () => {
    const res = await inventoryRoutes.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ name: "Helm", category: "equipment", assignedMemberId: "m1" }),
    });
    expect(res.status).toBe(302);
    expect(insertCalls.some((c) => c.table === inventoryItemAssignments)).toBe(false);
  });

  it("assigns a single ppe item to a member", async () => {
    const res = await inventoryRoutes.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ name: "Jacke", category: "ppe", quantity: "1", assignedMemberId: "m1" }),
    });
    expect(res.status).toBe(302);
    expect(insertCalls.find((c) => c.table === inventoryItemAssignments)?.values).toEqual([{ inventoryItemId: "new-id", memberId: "m1", quantity: 1 }]);
  });

  it("rejects a batch assignment total exceeding quantity", async () => {
    const res = await inventoryRoutes.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({
        name: "Helme", category: "equipment", quantity: "3",
        assignments: JSON.stringify([{ memberId: "m1", quantity: 2 }, { memberId: "m2", quantity: 2 }]),
      }),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.length).toBe(0);
  });
});

// ── Retire / reactivate ──────────────────────────────────────────────────────

describe("POST /:id/retire and /:id/reactivate", () => {
  it("sets retiredAt (and an optional reason) on retire", async () => {
    itemsFindFirstResult = makeItem();
    const res = await inventoryRoutes.request("/item1/retire", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ retiredReason: "kaputt" }),
    });
    expect(res.status).toBe(302);
    expect(updateCalls[0].set.retiredReason).toBe("kaputt");
    expect(updateCalls[0].set.retiredQuantity).toBe(1);
    expect(typeof updateCalls[0].set.retiredAt).toBe("string");
  });

  it("clears retiredAt/retiredReason/retiredQuantity on reactivate", async () => {
    const res = await inventoryRoutes.request("/item1/reactivate", { method: "POST" });
    expect(res.status).toBe(302);
    expect(updateCalls[0].set).toEqual({ retiredAt: null, retiredReason: null, retiredQuantity: 0 });
  });
});

// ── Verleih-Flag im Formular ────────────────────────────────────────────────

const lendingManager = () => ({ id: "u1", permissions: new Set(["inventory:read", "inventory:manage", "lending:read", "lending:manage"]), disabled: false });
const post = (path: string, fields: Record<string, string>) =>
  inventoryRoutes.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody(fields),
  });

describe("lendable flag on POST /", () => {
  it("creates a lending_items row in the same transaction, individualTracking from quantity", async () => {
    currentUser = lendingManager();
    const res = await post("/", { name: "Helm", category: "equipment", lendable: "1" });
    expect(res.status).toBe(302);
    expect(insertCalls.find((c) => c.table === lendingItems)?.values).toEqual({ inventoryItemId: "new-id", individualTracking: true });
  });

  it("uses batch tracking for quantity > 1", async () => {
    currentUser = lendingManager();
    await post("/", { name: "Helm", category: "equipment", lendable: "1", quantity: "5" });
    expect(insertCalls.find((c) => c.table === lendingItems)?.values.individualTracking).toBe(false);
  });

  it("ignores the flag without lending:manage (server-side)", async () => {
    await post("/", { name: "Helm", category: "equipment", lendable: "1" });
    expect(insertCalls.find((c) => c.table === lendingItems)).toBeUndefined();
  });
});

describe("lendable flag on POST /:id", () => {
  const base = { name: "TSF-W", category: "vehicle", licensePlate: "ABC-123" };

  it("marks an existing item lendable", async () => {
    currentUser = lendingManager();
    itemsFindFirstResult = makeItem();
    const res = await post("/item1", { ...base, lendable: "1" });
    expect(res.status).toBe(302);
    expect(insertCalls.find((c) => c.table === lendingItems)?.values).toEqual({ inventoryItemId: "item1", individualTracking: true });
  });

  it("refuses to make a retired item lendable", async () => {
    currentUser = lendingManager();
    itemsFindFirstResult = makeItem({ retiredAt: "2026-01-01" });
    const res = await post("/item1", { ...base, lendable: "1" });
    expect(res.status).toBe(422);
    expect(insertCalls.find((c) => c.table === lendingItems)).toBeUndefined();
  });

  it("removes the flag when no loans exist", async () => {
    currentUser = lendingManager();
    itemsFindFirstResult = makeItem();
    lendingItemFindFirstResult = { id: "li1" };
    const res = await post("/item1", base);
    expect(res.status).toBe(302);
    expect(deleteCalls.some((c) => c.table === lendingItems)).toBe(true);
  });

  it("refuses to remove the flag while loans exist", async () => {
    currentUser = lendingManager();
    itemsFindFirstResult = makeItem();
    lendingItemFindFirstResult = { id: "li1" };
    lendingLoanFindFirstResult = { id: "loan1" };
    const res = await post("/item1", base);
    expect(res.status).toBe(422);
    expect(deleteCalls.some((c) => c.table === lendingItems)).toBe(false);
  });

  it("leaves lending untouched without lending:manage", async () => {
    itemsFindFirstResult = makeItem();
    lendingItemFindFirstResult = { id: "li1" };
    const res = await post("/item1", base);
    expect(res.status).toBe(302);
    expect(deleteCalls.some((c) => c.table === lendingItems)).toBe(false);
    expect(insertCalls.find((c) => c.table === lendingItems)).toBeUndefined();
  });
});

describe("GET /:id/edit lendable checkbox", () => {
  it("is editable for lending:manage and read-only (disabled) otherwise", async () => {
    itemsFindFirstResult = makeItem();
    currentUser = lendingManager();
    const editable = await (await inventoryRoutes.request("/item1/edit")).text();
    expect(editable).toContain('name="lendable"');
    expect(editable).not.toMatch(/name="lendable"[^>]*disabled/);

    currentUser = { id: "u1", permissions: new Set(["inventory:read", "inventory:manage", "lending:read"]), disabled: false };
    const readonly = await (await inventoryRoutes.request("/item1/edit")).text();
    expect(readonly).toMatch(/name="lendable"[^>]*disabled/);
  });

  it("is locked while loans exist", async () => {
    currentUser = lendingManager();
    itemsFindFirstResult = makeItem();
    lendingItemFindFirstResult = { id: "li1" };
    lendingLoanFindFirstResult = { id: "loan1" };
    const html = await (await inventoryRoutes.request("/item1/edit")).text();
    expect(html).toMatch(/name="lendable"[^>]*disabled/);
    expect(html).toContain('type="hidden" name="lendable"');
  });
});

describe("GET / lending columns", () => {
  it("shows availability, 'Verleihen' action and the lendable filter", async () => {
    currentUser = lendingManager();
    itemsFindManyResult = [makeItem({ id: "a", name: "Verleihbar", quantity: 3 }), makeItem({ id: "b", name: "Normal" })];
    lendingItemsFindManyResult = [{ id: "li1", inventoryItemId: "a", individualTracking: false, loans: [] }];
    const html = await (await inventoryRoutes.request("/")).text();
    expect(html).toContain("3 verfügbar");
    expect(html).toContain("/inventory/lending/loans/new?item=li1");

    const filtered = await (await inventoryRoutes.request("/?lendable=1")).text();
    expect(filtered).toContain("Verleihbar");
    expect(filtered).not.toContain("Normal");
  });

  it("hides lending UI without lending:read", async () => {
    itemsFindManyResult = [makeItem()];
    const html = await (await inventoryRoutes.request("/")).text();
    expect(html).not.toContain("verfügbar");
    expect(html).not.toContain("loans/new");
  });
});

// ── Inspections overview ─────────────────────────────────────────────────────

describe("GET /inspections", () => {
  it("marks an overdue item", async () => {
    itemsFindManyResult = [makeItem({ id: "a", name: "TÜV fällig", category: "vehicle", vehicleInspectionDue: "2000-01-01" })];
    const res = await inventoryRoutes.request("/inspections?start=1999-01-01&end=2100-01-01");
    const html = await res.text();
    expect(html).toContain("TÜV fällig");
    expect(html).toContain("überfällig");
  });

  it("shows an overdue item even outside the selected date range", async () => {
    itemsFindManyResult = [makeItem({ id: "a", name: "TÜV fällig", category: "vehicle", vehicleInspectionDue: "2000-01-01" })];
    // No start/end query params → route defaults to today..+12 months, which
    // would otherwise hide this item entirely.
    const res = await inventoryRoutes.request("/inspections");
    const html = await res.text();
    expect(html).toContain("TÜV fällig");
    expect(html).toContain("überfällig");
  });
});

// ── search-members ───────────────────────────────────────────────────────────

describe("GET /search-members", () => {
  it("only returns aktiv/jugend members matching the query", async () => {
    membersFindManyResult = [
      { id: "m1", exitDate: null, deathDate: null, birthDate: "1990-01-01", person: { firstName: "Anna", lastName: "Aktiv" }, assignments: [{ to: null, role: { grantsActiveStatus: true } }] },
      { id: "m2", exitDate: "2020-01-01", deathDate: null, birthDate: "1990-01-01", person: { firstName: "Anna", lastName: "Archiviert" }, assignments: [] },
    ];
    const res = await inventoryRoutes.request("/search-members?q=anna");
    const html = await res.text();
    expect(html).toContain("Aktiv");
    expect(html).not.toContain("Archiviert");
  });

  it("returns nothing for a too-short query", async () => {
    const res = await inventoryRoutes.request("/search-members?q=a");
    const html = await res.text();
    expect(html).toBe("");
  });

  it("shows a no-results message when nothing matches", async () => {
    membersFindManyResult = [];
    const res = await inventoryRoutes.request("/search-members?q=xyz");
    const html = await res.text();
    expect(html).toContain("Keine Treffer");
  });
});

// ── New / edit pages ─────────────────────────────────────────────────────

describe("GET /new", () => {
  it("renders the empty form", async () => {
    const res = await inventoryRoutes.request("/new");
    const html = await res.text();
    expect(html).toContain("Neuer Gegenstand");
  });
});

describe("GET /:id/edit", () => {
  it("404s for an unknown item", async () => {
    itemsFindFirstResult = undefined;
    const res = await inventoryRoutes.request("/missing/edit");
    expect(res.status).toBe(404);
  });

  it("renders the ppe assignment picker with the current member pre-filled", async () => {
    itemsFindFirstResult = makeItem({
      category: "ppe", serialNumber: "SN-1",
      assignments: [{ id: "a1", inventoryItemId: "item1", memberId: "m1", quantity: 1, member: { id: "m1", person: { firstName: "Anna", lastName: "Bauer" } } }],
    });
    const res = await inventoryRoutes.request("/item1/edit");
    const html = await res.text();
    expect(html).toContain("Anna Bauer");
    expect(html).toContain("Ausmustern");
  });

  it("shows the reactivate action and retired notice for a retired item", async () => {
    itemsFindFirstResult = makeItem({ retiredAt: "2026-01-05", retiredReason: "defekt" });
    const res = await inventoryRoutes.request("/item1/edit");
    const html = await res.text();
    expect(html).toContain("Ausmusterung rückgängig");
    expect(html).toContain("defekt");
  });
});

describe("POST /:id", () => {
  it("404s for an unknown item", async () => {
    itemsFindFirstResult = undefined;
    const res = await inventoryRoutes.request("/missing", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ name: "X", category: "other" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects an invalid update and re-renders the form", async () => {
    itemsFindFirstResult = makeItem();
    const res = await inventoryRoutes.request("/item1", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ name: "", category: "vehicle" }),
    });
    expect(res.status).toBe(422);
  });

  it("updates an item and replaces its tags", async () => {
    itemsFindFirstResult = makeItem({ tags: [{ tag: "alt" }] });
    const res = await inventoryRoutes.request("/item1", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ name: "TSF-W 2", category: "vehicle", tags: "neu" }),
    });
    expect(res.status).toBe(302);
    expect(updateCalls[0].table).toBe(inventoryItems);
    expect(deleteCalls[0].table).toBe(inventoryItemTags);
    expect(insertCalls[0].table).toBe(inventoryItemTags);
    expect(insertCalls[0].values).toEqual([{ inventoryItemId: "item1", tag: "neu" }]);
  });
});
