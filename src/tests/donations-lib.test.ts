import { describe, it, expect } from "vitest";
import { nextReceiptStatus, recipientName } from "../lib/donations.js";

describe("nextReceiptStatus", () => {
  it("allows the specified transitions only", () => {
    expect(nextReceiptStatus("open", "issue")).toBe("issued");
    expect(nextReceiptStatus("not_required", "issue")).toBe("issued");
    expect(nextReceiptStatus("issued", "issue")).toBeNull();
    expect(nextReceiptStatus("open", "markNotRequired")).toBe("not_required");
    expect(nextReceiptStatus("issued", "markNotRequired")).toBeNull();
    expect(nextReceiptStatus("not_required", "reopen")).toBe("open");
    expect(nextReceiptStatus("open", "reopen")).toBeNull();
    expect(nextReceiptStatus("issued", "revoke")).toBe("open");
    expect(nextReceiptStatus("open", "revoke")).toBeNull();
  });
});

describe("recipientName", () => {
  it("prefers the company name", () => {
    expect(recipientName({ firstName: "A", lastName: "B", companyName: "X GmbH" })).toBe("X GmbH");
    expect(recipientName({ firstName: "A", lastName: "B", companyName: null })).toBe("A B");
  });
});
