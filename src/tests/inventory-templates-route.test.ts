import { describe, it, expect, vi, beforeEach } from "vitest";
import { inventoryTemplates, inventoryTemplateFieldDefs, inventoryTemplateInspections } from "../db/schema/index.js";
import { formBody } from "./test-utils.js";

process.env.OIDC_APP_URL = "http://localhost:3000";

let findFirstResult: any = undefined;
let insertError: unknown;
const inserts: { table: any; v: any }[] = [];
const updates: any[] = [];
const deletes: any[] = [];

const insert = vi.fn((table: any) => ({
  values: vi.fn((v: any) => {
    inserts.push({ table, v });
    if (insertError) return Object.assign(Promise.resolve(), { returning: () => Promise.reject(insertError) });
    return Object.assign(Promise.resolve(), { returning: () => Promise.resolve([{ id: "new-id" }]) });
  }),
}));
const update = vi.fn(() => ({ set: vi.fn((v: any) => { updates.push(v); return { where: vi.fn(() => Promise.resolve()) }; }) }));
const del = vi.fn((table: any) => { deletes.push(table); return { where: vi.fn(() => Promise.resolve()) }; });

vi.mock("../db/index.js", () => ({
  db: {
    query: {
      inventoryTemplates: { findFirst: vi.fn(() => Promise.resolve(findFirstResult)), findMany: vi.fn(() => Promise.resolve([{ id: "t1", name: "Hydrant", enabledFields: ["location"], fieldDefs: [{ fieldDefId: "f1" }], inspections: [] }])) },
      inventoryFieldDefs: { findMany: vi.fn(() => Promise.resolve([{ id: "f1", name: "Nennweite", archived: false }, { id: "f2", name: "Altfeld", archived: true }])) },
      inventoryInspectionTemplates: { findMany: vi.fn(() => Promise.resolve([{ id: "i1", name: "Jahresprüfung" }])) },
    },
    insert, update, delete: del,
    transaction: vi.fn(async (cb: any) => cb({ insert, update, delete: del })),
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

const { inventoryTemplateRoutes } = await import("../routes/inventory-templates.js");
const get = (path: string) => inventoryTemplateRoutes.request(path);
const post = (path: string, fields: Record<string, string | string[]>) => inventoryTemplateRoutes.request(path, { method: "POST", body: formBody(fields) });

beforeEach(() => {
  inserts.length = updates.length = deletes.length = 0;
  findFirstResult = undefined;
  insertError = undefined;
});

describe("item templates", () => {
  it("lists templates with counts, rows linking to the detail page", async () => {
    const html = await (await get("/")).text();
    expect(html).toContain("Hydrant");
    expect(html).toContain("/inventory/templates/t1");
  });

  it("offers fixed fields, active free fields and inspection templates on /new, but not archived free fields", async () => {
    const html = await (await get("/new")).text();
    expect(html).toContain('name="enabledFields" value="location"');
    expect(html).toContain('name="freeFields" value="f1"');
    expect(html).not.toContain('value="f2"');
    expect(html).toContain('name="inspections" value="i1"');
    expect(html).toContain('name="description"');
  });

  it("shows a read-only detail and keeps an archived, already chosen field checked in the edit form", async () => {
    findFirstResult = { id: "t1", name: "Hydrant", description: "Unterflur", enabledFields: ["location"], fieldDefs: [{ fieldDefId: "f2" }], inspections: [{ inspectionTemplateId: "i1" }] };
    const view = await (await get("/t1")).text();
    expect(view).toContain("Unterflur");
    expect(view).toContain("Altfeld (archiviert)");
    expect(view).toContain("Jahresprüfung");
    expect(view).not.toContain("<form id=");
    const edit = await (await get("/t1/edit")).text();
    expect(edit).toMatch(/name="freeFields" value="f2" checked/);
    expect(edit).toContain("Altfeld (archiviert)");
  });

  it("re-renders a 422 with the submitted input, including archived fields", async () => {
    const res = await post("/", { name: "", description: "Rest", freeFields: ["f2"], inspections: ["i1"] });
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain('value="Rest"');
    expect(html).toMatch(/name="freeFields" value="f2" checked/);
    expect(html).toMatch(/name="inspections" value="i1" checked/);
  });

  it("keeps an archived free field when saving a template that has it checked", async () => {
    findFirstResult = { id: "t1" };
    expect((await post("/t1", { name: "Hydrant", freeFields: ["f2"] })).status).toBe(302);
    expect(inserts.find((i) => i.table === inventoryTemplateFieldDefs)?.v).toEqual([{ templateId: "t1", fieldDefId: "f2" }]);
  });

  it("creates a template with its links, dropping unknown fixed fields", async () => {
    const res = await post("/", { name: " Hydrant ", description: " Unterflur ", enabledFields: ["location", "bogus"], freeFields: ["f1"], inspections: ["i1"] });
    expect(res.status).toBe(302);
    expect(inserts.map((i) => [i.table, i.v])).toEqual([
      [inventoryTemplates, { name: "Hydrant", description: "Unterflur", enabledFields: ["location"] }],
      [inventoryTemplateFieldDefs, [{ templateId: "new-id", fieldDefId: "f1" }]],
      [inventoryTemplateInspections, [{ templateId: "new-id", inspectionTemplateId: "i1" }]],
    ]);
  });

  it("rejects an empty or too long name and reports a duplicate (case-insensitive unique index)", async () => {
    expect((await post("/", { name: "" })).status).toBe(422);
    expect((await post("/", { name: "x".repeat(61) })).status).toBe(422);
    expect((await post("/", { name: "A", description: "x".repeat(121) })).status).toBe(422);
    expect(inserts.length).toBe(0);
    insertError = { code: "23505" };
    expect((await post("/", { name: "hydrant" })).status).toBe(422);
  });

  it("replaces the links when updating and 404s an unknown template", async () => {
    expect((await post("/t1", { name: "Hydrant" })).status).toBe(404);
    findFirstResult = { id: "t1" };
    expect((await post("/t1", { name: "Hydrant neu", enabledFields: "quantity" })).status).toBe(302);
    expect(updates[0]).toEqual({ name: "Hydrant neu", description: null, enabledFields: ["quantity"] });
    expect(deletes).toEqual([inventoryTemplateFieldDefs, inventoryTemplateInspections]);
    expect(inserts.length).toBe(0);
  });

  it("hard-deletes a template", async () => {
    findFirstResult = { id: "t1" };
    expect((await post("/t1/delete", {})).status).toBe(302);
    expect(deletes).toEqual([inventoryTemplates]);
  });
});
