import { sortDonations } from "../routes/donations.js";
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

describe("sortDonations", () => {
  const mk = (id: string, date: string, amount: string, last: string, first = "A") =>
    ({ id, date, amount, donor: { person: { firstName: first, lastName: last, companyName: null } } });
  const list = [mk("1", "2026-01-01", "10", "Zeh"), mk("2", "2026-02-01", "5", "Abt"), mk("3", "2026-02-01", "5", "Aaa")];
  const ids = (l: { id: string }[]) => l.map((x) => x.id).join();
  it("defaults to date desc, then name", () => expect(ids(sortDonations(list))).toBe("3,2,1"));
  it("sorts by amount numerically with tiebreaker", () => {
    expect(ids(sortDonations(list, "amount", "desc"))).toBe("1,3,2");
    expect(ids(sortDonations(list, "amount", "asc"))).toBe("3,2,1");
  });
  it("sorts by donor", () => expect(ids(sortDonations(list, "donor", "asc"))).toBe("3,2,1"));
});
