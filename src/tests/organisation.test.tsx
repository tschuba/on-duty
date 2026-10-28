import { describe, it, expect, vi, beforeEach } from "vitest";
import { orgConfig } from "../db/schema/index.js";
import { formBody } from "./test-utils.js";

const insertCalls: { table: any; values: any }[] = [];
const deleteCalls: { table: any }[] = [];
let config: Record<string, string> = {};

vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn((table: any) => ({
      values: vi.fn((values: any) => {
        insertCalls.push({ table, values });
        return { onConflictDoUpdate: vi.fn(() => Promise.resolve()) };
      }),
    })),
    delete: vi.fn((table: any) => ({
      where: vi.fn(() => {
        deleteCalls.push({ table });
        return Promise.resolve();
      }),
    })),
  },
}));
vi.mock("../lib/org-config.js", async () => ({
  ...(await vi.importActual<typeof import("../lib/org-config.js")>("../lib/org-config.js")),
  loadOrgConfig: vi.fn(() => Promise.resolve(config)),
}));
vi.mock("../components/layout.js", () => ({ Layout: ({ children }: any) => <div>{children}</div> }));
let currentUser: any;
vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => async (c: any, next: any) => {
    c.set("user", currentUser);
    await next();
  },
}));

const { organisationRoutes } = await import("../routes/organisation.js");

beforeEach(() => {
  insertCalls.length = 0;
  deleteCalls.length = 0;
  config = {};
  currentUser = { id: "u1", permissions: new Set(["org:write", "org:tax-data:read"]) };
});

const get = async (path = "/") => await (await organisationRoutes.request(path)).text();
const post = (body: Record<string, string>) => organisationRoutes.request("/", { method: "POST", body: formBody(body) });
const savedKeys = () => insertCalls.map((c) => c.values.key);

describe("organisation", () => {
  it("marks receipt fields as required and warns about missing ones, but stays saveable", async () => {
    config = { orgName: "FF" };
    const html = await get();
    expect(html).toContain("alert-warning");
    expect(html).toContain("text-error");
    expect(html).not.toContain(" required");
  });

  it("shows no warning in a section whose required fields are filled", async () => {
    currentUser.permissions = new Set(["org:read"]);
    config = { orgName: "a", orgStreet: "b", orgHouseNumber: "1", orgZip: "2", orgCity: "c", orgRepresentative: "r", orgContactEmail: "a@b.de" };
    expect(await get()).not.toContain("alert-warning");
  });

  it("renders both sections with ids on one page", async () => {
    currentUser.permissions = new Set(["org:write", "org:tax-data:write"]);
    config = { orgName: "FF Altenhammer" };
    const html = await get();
    expect(html).toContain('id="master-data"');
    expect(html).toContain('id="tax-data"');
    expect(html).toContain("FF Altenhammer");
    expect(html).not.toContain("disabled");
  });

  it("renders a section read-only without its write permission", async () => {
    expect(await get()).toContain("disabled"); // tax: read only
  });

  it("omits the tax section with only org:read", async () => {
    currentUser.permissions = new Set(["org:read"]);
    const html = await get();
    expect(html).toContain('id="master-data"');
    expect(html).not.toContain('id="tax-data"');
  });

  it("omits the master section with only org:tax-data:read, and shows no save without write", async () => {
    currentUser.permissions = new Set(["org:tax-data:read"]);
    const html = await get();
    expect(html).not.toContain('id="master-data"');
    expect(html).toContain('id="tax-data"');
    expect(html).not.toContain("data-discard");
  });

  it("403s without any read permission", async () => {
    currentUser.permissions = new Set();
    expect((await organisationRoutes.request("/")).status).toBe(403);
  });

  it("redirects old tab URLs to anchors", async () => {
    const m = await organisationRoutes.request("/master-data");
    const t = await organisationRoutes.request("/tax-data");
    expect(m.headers.get("location")).toBe("/organisation#master-data");
    expect(t.headers.get("location")).toBe("/organisation#tax-data");
  });

  it("with only org:write: upserts/deletes master keys and never touches tax keys", async () => {
    await post({ orgName: "FF", orgCity: "", taxOffice: "X" });
    expect(savedKeys()).toContain("orgName");
    expect(deleteCalls.length).toBeGreaterThan(0);
    expect(savedKeys()).not.toContain("taxOffice");
  });

  it("with both write permissions: saves both sections", async () => {
    currentUser.permissions = new Set(["org:write", "org:tax-data:write"]);
    await post({ orgName: "FF", taxOffice: "FA" });
    expect(savedKeys()).toEqual(expect.arrayContaining(["orgName", "taxOffice"]));
  });

  it("rejects an inverted assessment period and saves nothing", async () => {
    currentUser.permissions = new Set(["org:write", "org:tax-data:write"]);
    const res = await post({ orgName: "FF", taxAssessmentPeriodFrom: "2024", taxAssessmentPeriodTo: "2020" });
    expect(insertCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
    expect(res.headers.get("location")).toBe("/organisation#tax-data");
  });

  it("ignores the period check without tax write permission", async () => {
    await post({ orgName: "FF", taxAssessmentPeriodFrom: "2024", taxAssessmentPeriodTo: "2020" });
    expect(savedKeys()).toContain("orgName");
  });
});
