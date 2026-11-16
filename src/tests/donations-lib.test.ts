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
  const mk = (amount: string, date: string, donorId: string, type: string | null = "cash", receiptStatus = "open") => ({ amount, date, donorId, type, receiptStatus });
  it("handles an empty list", () => {
    const s = summarizeDonations([]);
    expect(s).toMatchObject({ count: 0, cents: 0, averageCents: 0, donors: 0, years: [] });
  });
  it("sums in cents without float drift", () => expect(summarizeDonations([mk("0.10", "2026-01-01", "a"), mk("0.20", "2026-01-02", "a")]).cents).toBe(30));
  it("counts distinct donors, averages, and groups by year", () => {
    const s = summarizeDonations([mk("10", "2025-05-01", "a"), mk("20", "2026-01-01", "a", "transfer", "issued"), mk("30", "2026-02-01", "b", null)]);
    expect(s.donors).toBe(2);
    expect(s.averageCents).toBe(2000);
    expect(s.open).toEqual({ count: 2, cents: 4000 });
    expect(s.years.map((y) => [y.year, y.count, y.cents, y.cashCents, y.transferCents])).toEqual([["2026", 2, 5000, 0, 2000], ["2025", 1, 1000, 1000, 0]]);
  });
});
