import { describe, it, expect, vi, beforeEach } from "vitest";
import { inventoryFieldDefs } from "../db/schema/index.js";
import { formBody } from "./test-utils.js";
import { t } from "../i18n/index.js";
import { fieldActions } from "../lib/inventory.js";

process.env.OIDC_APP_URL = "http://localhost:3000";

let defFindFirstResult: any = undefined;
let defsFindManyResult: any[] = [];
let templateLinks: any[] = [];
let usedValues: { value: string | null }[] = [];
const inserts: any[] = [];
const updates: any[] = [];
const deletes: any[] = [];

vi.mock("../db/index.js", () => ({
  db: {
    query: {
      inventoryFieldDefs: { findFirst: vi.fn(() => Promise.resolve(defFindFirstResult)), findMany: vi.fn(() => Promise.resolve(defsFindManyResult)) },
      inventoryTemplateFieldDefs: { findMany: vi.fn(() => Promise.resolve(templateLinks)) },
    },
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(usedValues)) })) })),
    insert: vi.fn((table: any) => ({ values: vi.fn((v: any) => { inserts.push({ table, v }); return { returning: () => Promise.resolve([{ id: "new-id" }]) }; }) })),
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

const { inventoryFieldRoutes } = await import("../routes/inventory-fields.js");
const get = (path: string) => inventoryFieldRoutes.request(path);
const post = (path: string, fields: Record<string, string>) =>
  inventoryFieldRoutes.request(path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formBody(fields) });

beforeEach(() => {
  inserts.length = updates.length = deletes.length = 0;
  defFindFirstResult = undefined;
  defsFindManyResult = [];
  usedValues = [];
  templateLinks = [];
});

describe("inventory field definitions", () => {
  it("creates a select with parsed options", async () => {
    const res = await post("/", { name: "Nennweite", type: "select", options: "DN 80\n DN 100 \nDN 80" });
    expect(res.status).toBe(302);
    expect(inserts[0]).toEqual({ table: inventoryFieldDefs, v: { name: "Nennweite", type: "select", options: ["DN 80", "DN 100"] } });
  });

  it("rejects a select without options and an unknown type", async () => {
    expect((await post("/", { name: "X", type: "select", options: "" })).status).toBe(422);
    const bad = await post("/", { name: "Mein Feld", type: "bogus" });
    expect(bad.status).toBe(422);
    expect(await bad.text()).toContain('value="Mein Feld"');
    expect(inserts.length).toBe(0);
  });

  it("blocks removing an option that is in use", async () => {
    defFindFirstResult = { id: "d1", name: "N", type: "select", options: ["A", "B"], archived: false };
    usedValues = [{ value: "A" }];
    const res = await post("/d1", { name: "N", options: "B" });
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain(t("inventory.fields.optionInUse", { options: "A" }));
    expect(html).toContain("B"); // Eingaben bleiben erhalten
    expect(updates.length).toBe(0);
  });

  it("allows adding options and renaming", async () => {
    defFindFirstResult = { id: "d1", name: "N", type: "select", options: ["A"], archived: false };
    expect((await post("/d1", { name: "Neu", options: "A\nB" })).status).toBe(302);
    expect(updates[0]).toEqual({ name: "Neu", options: ["A", "B"] });
  });

  it("toggles archived", async () => {
    defFindFirstResult = { id: "d1", archived: false };
    await post("/d1/archive", {});
    expect(updates[0]).toEqual({ archived: true });
  });

  it("blocks deleting a field that has values, deletes an unused one", async () => {
    defFindFirstResult = { id: "d1", name: "N", type: "text", archived: false, values: [{ id: "v" }] };
    expect((await post("/d1/delete", {})).status).toBe(422);
    expect(deletes.length).toBe(0);
    defFindFirstResult = { id: "d1", name: "N", type: "text", archived: false, values: [] };
    expect((await post("/d1/delete", {})).status).toBe(302);
    expect(deletes.length).toBe(1);
  });

  it("lists fields with type, usage and status, rows linking to the detail page", async () => {
    defsFindManyResult = [{ id: "d1", name: "Nennweite", type: "select", archived: true, values: [{ id: "v" }] }];
    const html = await (await get("/")).text();
    expect(html).toContain("/inventory/fields/d1");
    expect(html).toContain(t("inventory.fields.archived"));
  });

  it("shows a read-only detail with options and the item templates using the field", async () => {
    defFindFirstResult = { id: "d1", name: "Nennweite", type: "select", options: ["DN 80", "DN 100"], archived: false, values: [{ id: "v" }] };
    templateLinks = [{ template: { id: "p1", name: "Hydrant" } }];
    const html = await (await get("/d1")).text();
    expect(html).toContain("DN 80, DN 100");
    expect(html).toContain('href="/inventory/templates/p1"');
    expect(html).toContain('action="/inventory/fields/d1/archive"');
    expect(html).not.toContain("/inventory/fields/d1/delete"); // verwendet → nur archivieren
    expect((await get("/new")).status).toBe(200);
    expect(await (await get("/d1/edit")).text()).toContain("DN 80\nDN 100");
  });
});

describe("fieldActions", () => {
  it("offers archive/delete by state and usage", () => {
    expect(fieldActions({ archived: false, usage: 2 })).toEqual(["archive"]);
    expect(fieldActions({ archived: false, usage: 0 })).toEqual(["delete"]);
    expect(fieldActions({ archived: true, usage: 2 })).toEqual(["unarchive"]);
    expect(fieldActions({ archived: true, usage: 0 })).toEqual(["unarchive", "delete"]);
  });
});
