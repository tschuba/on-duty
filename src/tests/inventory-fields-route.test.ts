import { describe, it, expect, vi, beforeEach } from "vitest";
import { inventoryFieldDefs } from "../db/schema/index.js";
import { formBody } from "./test-utils.js";
import { t } from "../i18n/index.js";

process.env.OIDC_APP_URL = "http://localhost:3000";

let defFindFirstResult: any = undefined;
let defsFindManyResult: any[] = [];
let usedValues: { value: string | null }[] = [];
const inserts: any[] = [];
const updates: any[] = [];
const deletes: any[] = [];

vi.mock("../db/index.js", () => ({
  db: {
    query: { inventoryFieldDefs: { findFirst: vi.fn(() => Promise.resolve(defFindFirstResult)), findMany: vi.fn(() => Promise.resolve(defsFindManyResult)) } },
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(usedValues)) })) })),
    insert: vi.fn((table: any) => ({ values: vi.fn((v: any) => { inserts.push({ table, v }); return Promise.resolve(); }) })),
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
const post = (path: string, fields: Record<string, string>) =>
  inventoryFieldRoutes.request(path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formBody(fields) });

beforeEach(() => {
  inserts.length = updates.length = deletes.length = 0;
  defFindFirstResult = undefined;
  defsFindManyResult = [];
  usedValues = [];
});

describe("inventory field definitions", () => {
  it("creates a select with parsed options", async () => {
    const res = await post("/", { name: "Nennweite", type: "select", options: "DN 80\n DN 100 \nDN 80" });
    expect(res.status).toBe(302);
    expect(inserts[0]).toEqual({ table: inventoryFieldDefs, v: { name: "Nennweite", type: "select", options: ["DN 80", "DN 100"] } });
  });

  it("rejects a select without options and an unknown type", async () => {
    expect((await post("/", { name: "X", type: "select", options: "" })).status).toBe(422);
    expect((await post("/", { name: "X", type: "bogus" })).status).toBe(422);
    expect(inserts.length).toBe(0);
  });

  it("blocks removing an option that is in use", async () => {
    defFindFirstResult = { id: "d1", name: "N", type: "select", options: ["A", "B"], archived: false };
    usedValues = [{ value: "A" }];
    const res = await post("/d1", { name: "N", options: "B" });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain(t("inventory.fields.optionInUse", { options: "A" }));
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
    defFindFirstResult = { id: "d1", values: [] };
    expect((await post("/d1/delete", {})).status).toBe(302);
    expect(deletes.length).toBe(1);
  });
});
