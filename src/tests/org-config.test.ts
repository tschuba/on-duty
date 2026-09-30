import { describe, it, expect } from "vitest";
import { isOrgConfigCompleteForReceipts } from "../lib/org-config.js";

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
