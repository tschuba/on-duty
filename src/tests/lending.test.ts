import { describe, it, expect } from "vitest";
import { effectiveRange, rangesOverlap, loanStatus, availableQuantity, itemStatus, validateLoanDates, safeReturnTo } from "../lib/lending.js";

describe("effectiveRange", () => {
  it("prefers the actual date over the planned date per edge", () => {
    expect(effectiveRange({ plannedFrom: "2026-01-01", plannedTo: "2026-01-10", pickedUpAt: "2026-01-02", returnedAt: null })).toEqual({
      from: "2026-01-02",
      to: "2026-01-10",
    });
  });

  it("returns null when neither planned nor actual dates are set", () => {
    expect(effectiveRange({ plannedFrom: null, plannedTo: null, pickedUpAt: null, returnedAt: null })).toBeNull();
  });

  it("uses a min sentinel when only the end date is known", () => {
    expect(effectiveRange({ plannedFrom: null, plannedTo: "2026-01-10", pickedUpAt: null, returnedAt: null })).toEqual({
      from: "0000-01-01",
      to: "2026-01-10",
    });
  });

  it("uses returnedAt as the closing edge once set", () => {
    expect(effectiveRange({ plannedFrom: "2026-01-01", plannedTo: "2026-01-10", pickedUpAt: "2026-01-01", returnedAt: "2026-01-05" })).toEqual({
      from: "2026-01-01",
      to: "2026-01-05",
    });
  });
});

describe("rangesOverlap", () => {
  it("detects overlapping ranges", () => {
    expect(rangesOverlap({ from: "2026-01-01", to: "2026-01-10" }, { from: "2026-01-05", to: "2026-01-15" })).toBe(true);
  });

  it("detects non-overlapping ranges", () => {
    expect(rangesOverlap({ from: "2026-01-01", to: "2026-01-05" }, { from: "2026-01-06", to: "2026-01-10" })).toBe(false);
  });
});

describe("loanStatus", () => {
  const today = "2026-06-15";

  it("is returned once returnedAt is set", () => {
    expect(loanStatus({ plannedFrom: "2026-06-01", plannedTo: "2026-06-10", pickedUpAt: "2026-06-01", returnedAt: "2026-06-05" }, today)).toBe("returned");
  });

  it("is overdue when plannedTo is past and not returned", () => {
    expect(loanStatus({ plannedFrom: "2026-06-01", plannedTo: "2026-06-10", pickedUpAt: "2026-06-01", returnedAt: null }, today)).toBe("overdue");
  });

  it("is active once picked up and not yet overdue", () => {
    expect(loanStatus({ plannedFrom: "2026-06-10", plannedTo: "2026-06-20", pickedUpAt: "2026-06-10", returnedAt: null }, today)).toBe("active");
  });

  it("is planned when not yet picked up", () => {
    expect(loanStatus({ plannedFrom: "2026-06-20", plannedTo: "2026-06-25", pickedUpAt: null, returnedAt: null }, today)).toBe("planned");
  });
});

describe("availableQuantity", () => {
  const today = "2026-06-15";
  const item = { quantity: 5, retiredQuantity: 1 };
  const loan = (o: Record<string, unknown>) => ({ quantity: 1, plannedFrom: null, plannedTo: null, pickedUpAt: null, returnedAt: null, ...o }) as any;

  it("subtracts retired and currently running loan quantities", () => {
    expect(availableQuantity(item, [loan({ quantity: 2, plannedFrom: "2026-06-10", plannedTo: "2026-06-20" })], today)).toBe(2);
  });

  it("ignores returned and future loans and loans without dates", () => {
    expect(availableQuantity(item, [
      loan({ plannedFrom: "2026-06-01", plannedTo: "2026-06-10", returnedAt: "2026-06-05" }),
      loan({ plannedFrom: "2026-07-01", plannedTo: "2026-07-05" }),
      loan({}),
    ], today)).toBe(4);
  });
});

describe("itemStatus", () => {
  it("retired beats lendable, lendable beats active", () => {
    expect(itemStatus({ retiredAt: new Date() }, true)).toBe("retired");
    expect(itemStatus({ retiredAt: null }, true)).toBe("lendable");
    expect(itemStatus({ retiredAt: null }, false)).toBe("active");
  });
});

describe("validateLoanDates", () => {
  it("accepts no return, or a return on/after pickup", () => {
    expect(validateLoanDates({ pickedUpAt: null, returnedAt: null })).toBeNull();
    expect(validateLoanDates({ pickedUpAt: "2026-01-02", returnedAt: null })).toBeNull();
    expect(validateLoanDates({ pickedUpAt: "2026-01-02", returnedAt: "2026-01-02" })).toBeNull();
  });
  it("flags a return without pickup or before pickup", () => {
    expect(validateLoanDates({ pickedUpAt: null, returnedAt: "2026-01-02" })).toBe("returnedWithoutPickup");
    expect(validateLoanDates({ pickedUpAt: "2026-01-03", returnedAt: "2026-01-02" })).toBe("returnedBeforePickup");
  });
});

describe("safeReturnTo", () => {
  const fb = "/inventory/lending/x/loans";
  it("keeps paths under /inventory/lending", () => {
    expect(safeReturnTo("/inventory/lending", fb)).toBe("/inventory/lending");
    expect(safeReturnTo("/inventory/lending?status=active", fb)).toBe("/inventory/lending?status=active");
    expect(safeReturnTo("/inventory/lending/abc/loans", fb)).toBe("/inventory/lending/abc/loans");
  });
  it("falls back for everything else", () => {
    for (const bad of [undefined, "", "https://evil.example", "//evil.example", "/inventory/lendingx", "/admin", "/inventory/lending\r\nX: y"]) {
      expect(safeReturnTo(bad, fb)).toBe(fb);
    }
  });
});
