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
vi.mock("../lib/org-config.js", () => ({ REQUIRED_RECEIPT_FIELDS: ["orgName", "orgStreet", "orgHouseNumber", "orgZip", "orgCity", "taxExemptionDate", "taxExemptionNumber", "taxOffice", "taxAssessmentPeriodFrom", "taxAssessmentPeriodTo", "charitablePurpose"], loadOrgConfig: vi.fn(() => Promise.resolve(config)) }));
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

describe("organisation", () => {
  it("marks receipt fields as required and warns about missing ones, but stays saveable", async () => {
    config = { orgName: "FF" };
    const html = await (await organisationRoutes.request("/stammdaten")).text();
    expect(html).toContain("alert-warning");
    expect(html).toContain("text-error");
    expect(html).not.toContain(" required");
  });

  it("shows no warning when the tab's required fields are filled", async () => {
    config = { orgName: "a", orgStreet: "b", orgHouseNumber: "1", orgZip: "2", orgCity: "c" };
    const html = await (await organisationRoutes.request("/stammdaten")).text();
    expect(html).not.toContain("alert-warning");
  });

  it("redirects / to the first readable tab", async () => {
    currentUser.permissions = new Set(["org:tax-data:read"]);
    const res = await organisationRoutes.request("/");
    expect(res.headers.get("location")).toBe("/organisation/steuerdaten");
  });

  it("renders stammdaten values, editable with org:write", async () => {
    config = { orgName: "FF Altenhammer" };
    const html = await (await organisationRoutes.request("/stammdaten")).text();
    expect(html).toContain("FF Altenhammer");
    expect(html).not.toContain("disabled");
  });

  it("renders steuerdaten read-only with only org:tax-data:read", async () => {
    const html = await (await organisationRoutes.request("/steuerdaten")).text();
    expect(html).toContain("disabled");
  });

  it("403s a tab without its read permission", async () => {
    currentUser.permissions = new Set(["org:read"]);
    expect((await organisationRoutes.request("/steuerdaten")).status).toBe(403);
  });

  it("upserts submitted and deletes empty fields, only for the tab's own keys", async () => {
    await organisationRoutes.request("/stammdaten", { method: "POST", body: formBody({ orgName: "FF", orgCity: "" }) });
    expect(insertCalls.some((c) => c.table === orgConfig && c.values.key === "orgName")).toBe(true);
    expect(deleteCalls.length).toBeGreaterThan(0);
    expect(insertCalls.some((c) => c.values.key === "taxOffice")).toBe(false);
  });

  it("rejects an inverted assessment period", async () => {
    await organisationRoutes.request("/steuerdaten", {
      method: "POST",
      body: formBody({ taxAssessmentPeriodFrom: "2024", taxAssessmentPeriodTo: "2020" }),
    });
    expect(insertCalls).toHaveLength(0);
  });
});
