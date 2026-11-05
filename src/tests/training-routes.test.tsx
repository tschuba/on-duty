import { describe, it, expect, vi, beforeEach } from "vitest";
import { formBody } from "./test-utils.js";

process.env.ORG_NAME = "Test Feuerwehr";
process.env.APP_TIMEZONE = "Europe/Berlin";

let selectResults: any[][] = [];
const inserts: any[] = [];
const updates: any[] = [];
const deletes: any[] = [];

function chain(result: any) {
  const c: any = Object.assign(Promise.resolve(result), {});
  for (const k of ["from", "where", "innerJoin", "orderBy"]) c[k] = vi.fn(() => c);
  return c;
}
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => chain(selectResults.shift() ?? [])),
    insert: vi.fn(() => ({ values: vi.fn((v: any) => { inserts.push(v); return Promise.resolve(); }) })),
    update: vi.fn(() => ({ set: vi.fn((v: any) => ({ where: vi.fn(() => { updates.push(v); return Promise.resolve(); }) })) })),
    delete: vi.fn(() => ({ where: vi.fn(() => { deletes.push(1); return Promise.resolve(); }) })),
  },
}));

let perms = new Set<string>();
vi.mock("../middleware/auth.js", async () => {
  const actual = await vi.importActual<any>("../middleware/auth.js");
  return {
    ...actual,
    requireAuth: (required?: any) => async (c: any, next: any) => {
      const req = Array.isArray(required) ? required : required ? [required] : [];
      if (!req.every((p: string) => perms.has(p))) return c.text("forbidden", 403);
      c.set("user", { id: "u1", name: "T", permissions: perms, disabled: false });
      await next();
    },
  };
});

const { trainingRoutes } = await import("../routes/training.js");
const post = (path: string, fields: Record<string, string>) =>
  trainingRoutes.request(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: formBody(fields) });

beforeEach(() => {
  selectResults = [];
  inserts.length = 0; updates.length = 0; deletes.length = 0;
  perms = new Set(["training:read", "training:write", "training:delete"]);
});

describe("permissions", () => {
  it("403 without training:read (list and fragment)", async () => {
    perms = new Set(["members:read"]);
    expect((await trainingRoutes.request("/training")).status).toBe(403);
    expect((await trainingRoutes.request("/members/m1/training")).status).toBe(403);
  });
  it("write-only user may not delete", async () => {
    perms = new Set(["training:read", "training:write"]);
    expect((await post("/members/m1/training/t1/delete", {})).status).toBe(403);
    expect(deletes).toHaveLength(0);
  });
  it("read-only user may not create", async () => {
    perms = new Set(["training:read"]);
    expect((await post("/members/m1/training", { title: "x", completedAt: "2020-01-01" })).status).toBe(403);
  });
});

describe("create / update / delete", () => {
  it("creates a record", async () => {
    selectResults = [[{ id: "m1" }], [] /* reload */];
    const res = await post("/members/m1/training", { title: " Truppmann ", completedAt: "2020-01-01" });
    expect(res.status).toBe(200);
    expect(inserts[0]).toMatchObject({ memberId: "m1", title: "Truppmann", completedAt: "2020-01-01" });
  });
  it("422 on invalid input, nothing written", async () => {
    selectResults = [[{ id: "m1" }]];
    const res = await post("/members/m1/training", { title: "", completedAt: "2020-01-01" });
    expect(res.status).toBe(422);
    expect(inserts).toHaveLength(0);
  });
  it("404 when tid belongs to another member (IDOR)", async () => {
    selectResults = [[{ id: "m1" }], []];
    expect((await post("/members/m1/training/other", { title: "x", completedAt: "2020-01-01" })).status).toBe(404);
    selectResults = [[]];
    expect((await post("/members/m1/training/other/delete", {})).status).toBe(404);
    expect(updates).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });
  it("deletes an owned record", async () => {
    selectResults = [[{ id: "t1" }], []];
    expect((await post("/members/m1/training/t1/delete", {})).status).toBe(200);
    expect(deletes).toHaveLength(1);
  });
});

describe("GET /training", () => {
  it("lists records with status badge and hides former members by default", async () => {
    selectResults = [[
      { r: { id: "a", memberId: "m1", title: "Atemschutz", completedAt: "2000-01-01", expiresAt: "2001-01-01", organizer: null }, firstName: "Max", lastName: "Muster", exitDate: null },
      { r: { id: "b", memberId: "m2", title: "Alt", completedAt: "2000-01-01", expiresAt: null, organizer: null }, firstName: "Ex", lastName: "Mitglied", exitDate: "2010-01-01" },
    ]];
    const html = await (await trainingRoutes.request("/training")).text();
    expect(html).toContain("Muster, Max");
    expect(html).toContain("abgelaufen");
    expect(html).not.toContain("Mitglied, Ex");
  });
});
