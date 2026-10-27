import { describe, it, expect, vi } from "vitest";

process.env.ORG_NAME = "Test Feuerwehr";
process.env.ADMIN_PASSWORD = "test-password-123";
process.env.BETTER_AUTH_SECRET = "test-secret";
process.env.DATABASE_URL = "postgres://test";

let rows: { key: string; value: string }[] = [];
vi.mock("../db/index.js", () => ({ db: { select: vi.fn(() => ({ from: vi.fn(async () => rows) })) } }));

const { isOrgConfigCompleteForReceipts, missingReceiptFields, loadOrgConfig } = await import("../lib/org-config.js");

const COMPLETE = {
  orgName: "FF Altenhammer", orgStreet: "Hauptstr.", orgHouseNumber: "1", orgZip: "12345", orgCity: "Altenhammer",
  taxExemptionDate: "2020-01-01", taxExemptionNumber: "123", taxOffice: "FA Musterstadt",
  taxAssessmentPeriodFrom: "2020", taxAssessmentPeriodTo: "2022", charitablePurpose: "Brandschutz",
};

describe("isOrgConfigCompleteForReceipts", () => {
  it("is true when every required field is set", () => {
    expect(isOrgConfigCompleteForReceipts(COMPLETE)).toBe(true);
  });

  it("is false when a required field is missing", () => {
    expect(isOrgConfigCompleteForReceipts({ ...COMPLETE, taxOffice: "" })).toBe(false);
  });
});

describe("missingReceiptFields", () => {
  it("groups missing keys by tab", () => {
    expect(missingReceiptFields({ ...COMPLETE, orgCity: "", taxOffice: "" })).toEqual({ master: ["orgCity"], privacy: [], tax: ["taxOffice"] });
  });

  it("is empty when complete", () => {
    expect(missingReceiptFields(COMPLETE)).toEqual({ master: [], privacy: [], tax: [] });
  });
});

describe("loadOrgConfig", () => {
  it("defaults orgName to ORG_NAME when none or only blank is stored", async () => {
    rows = [];
    expect((await loadOrgConfig()).orgName).toBe("Test Feuerwehr");
    rows = [{ key: "orgName", value: " " }];
    expect((await loadOrgConfig()).orgName).toBe("Test Feuerwehr");
  });

  it("keeps a stored orgName", async () => {
    rows = [{ key: "orgName", value: "FF e.V." }];
    expect((await loadOrgConfig()).orgName).toBe("FF e.V.");
  });
});
