import { describe, it, expect } from "vitest";
import { missingImpressumFields, isImpressumComplete } from "../lib/org-config.js";

const full = { orgName: "FF", orgStreet: "S", orgHouseNumber: "1", orgZip: "1", orgCity: "C", orgRepresentative: "X", orgContactEmail: "a@b.de" };

describe("missingImpressumFields", () => {
  it("lists all required fields when empty", () => expect(missingImpressumFields({})).toHaveLength(7));
  it("is complete without phone and register", () => expect(isImpressumComplete(full)).toBe(true));
  it("treats blanks as missing", () => expect(missingImpressumFields({ ...full, orgRepresentative: "  " })).toEqual(["orgRepresentative"]));
});
