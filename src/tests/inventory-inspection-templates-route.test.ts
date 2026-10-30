import { describe, it, expect, vi, beforeEach } from "vitest";
import { inventoryInspectionTemplates } from "../db/schema/index.js";
import { formBody } from "./test-utils.js";

process.env.OIDC_APP_URL = "http://localhost:3000";

let findFirstResult: any = undefined;
let insertError: unknown;
const inserts: any[] = [];
const updates: any[] = [];
const deletes: any[] = [];

vi.mock("../db/index.js", () => ({
  db: {
    query: { inventoryInspectionTemplates: { findFirst: vi.fn(() => Promise.resolve(findFirstResult)), findMany: vi.fn(() => Promise.resolve([])) } },
    insert: vi.fn((table: any) => ({ values: vi.fn((v: any) => { inserts.push({ table, v }); return insertError ? Promise.reject(insertError) : Promise.resolve(); }) })),
    update: vi.fn(() => ({ set: vi.fn((v: any) => { updates.push(v); return { where: vi.fn(() => Promise.resolve()) }; }) })),
    delete: vi.fn((table: any) => { deletes.push(table); return { where: vi.fn(() => Promise.resolve()) }; }),
  },
}));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => async (c: any, next: any) => {
    c.set("user", { id: "u1", permissions: new Set(["inventory:configure"]), disabled: false });
    await next();
  },
}));
vi.mock("../lib/org-config.js", async () => ({
  ...(await vi.importActual<typeof import("../lib/org-config.js")>("../lib/org-config.js")),
  loadOrgConfig: vi.fn(() => Promise.resolve({})),
}));

const { inventoryInspectionTemplateRoutes } = await import("../routes/inventory-inspection-templates.js");
const post = (path: string, fields: Record<string, string>) => inventoryInspectionTemplateRoutes.request(path, { method: "POST", body: formBody(fields) });

beforeEach(() => {
  inserts.length = updates.length = deletes.length = 0;
  findFirstResult = undefined;
  insertError = undefined;
});

describe("inspection templates", () => {
  it("creates a template with and without a default interval", async () => {
    expect((await post("/", { name: " HU ", interval: "24" })).status).toBe(302);
    expect((await post("/", { name: "Prüfung", interval: "" })).status).toBe(302);
    expect(inserts.map((i) => i.v)).toEqual([{ name: "HU", defaultIntervalMonths: 24 }, { name: "Prüfung", defaultIntervalMonths: null }]);
    expect(inserts[0].table).toBe(inventoryInspectionTemplates);
  });

  it("rejects empty name, too long name and a bad interval", async () => {
    expect((await post("/", { name: "", interval: "" })).status).toBe(422);
    expect((await post("/", { name: "x".repeat(61), interval: "" })).status).toBe(422);
    expect((await post("/", { name: "A", interval: "121" })).status).toBe(422);
    expect(inserts.length).toBe(0);
  });

  it("reports a duplicate name (case-insensitive unique index) instead of failing", async () => {
    insertError = { code: "23505" };
    expect((await post("/", { name: "hu", interval: "" })).status).toBe(422);
  });

  it("updates an existing template and 404s an unknown one", async () => {
    expect((await post("/t1", { name: "HU", interval: "12" })).status).toBe(404);
    findFirstResult = { id: "t1" };
    expect((await post("/t1", { name: "HU neu", interval: "" })).status).toBe(302);
    expect(updates[0]).toEqual({ name: "HU neu", defaultIntervalMonths: null });
  });

  it("hard-deletes a template", async () => {
    findFirstResult = { id: "t1" };
    expect((await post("/t1/delete", {})).status).toBe(302);
    expect(deletes).toEqual([inventoryInspectionTemplates]);
  });
});
