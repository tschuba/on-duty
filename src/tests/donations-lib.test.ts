import { sortDonations } from "../routes/donations.js";
import { describe, it, expect } from "vitest";
import { nextReceiptStatus, recipientName, summarizeDonations } from "../lib/donations.js";

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

describe("summarizeDonations", () => {
  const mk = (amount: string, donorId: string, receiptStatus = "open") => ({ amount, donorId, receiptStatus });
  it("handles an empty list", () => {
    expect(summarizeDonations([])).toMatchObject({ count: 0, cents: 0, averageCents: 0, donors: 0, open: { count: 0, cents: 0 } });
  });
  it("sums in cents without float drift", () => expect(summarizeDonations([mk("0.10", "a"), mk("0.20", "a")]).cents).toBe(30));
  it("counts distinct donors, averages, and open receipts", () => {
    const s = summarizeDonations([mk("10", "a"), mk("20", "a", "issued"), mk("30", "b")]);
    expect(s).toMatchObject({ count: 3, cents: 6000, averageCents: 2000, donors: 2, open: { count: 2, cents: 4000 } });
  });
});
