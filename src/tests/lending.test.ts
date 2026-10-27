import { describe, it, expect } from "vitest";
import { effectiveRange, rangesOverlap, loanStatus, availableQuantity, itemStatus, validateLoanDates } from "../lib/lending.js";

describe("effectiveRange", () => {
  it("prefers the actual date over the planned date per edge", () => {
    expect(effectiveRange({ plannedFrom: "2026-01-01", plannedTo: "2026-01-10", pickedUpAt: "2026-01-02", returnedAt: null })).toEqual({
      from: "2026-01-02T00:00",
      to: "2026-01-10T23:59",
    });
  });

  it("returns null when neither planned nor actual dates are set", () => {
    expect(effectiveRange({ plannedFrom: null, plannedTo: null, pickedUpAt: null, returnedAt: null })).toBeNull();
  });

  it("uses a min sentinel when only the end date is known", () => {
    expect(effectiveRange({ plannedFrom: null, plannedTo: "2026-01-10", pickedUpAt: null, returnedAt: null })).toEqual({
      from: "0000-01-01T00:00",
      to: "2026-01-10T23:59",
    });
  });

  it("uses returnedAt as the closing edge once set", () => {
    expect(effectiveRange({ plannedFrom: "2026-01-01", plannedTo: "2026-01-10", pickedUpAt: "2026-01-01", returnedAt: "2026-01-05" })).toEqual({
      from: "2026-01-01T00:00",
      to: "2026-01-05T23:59",
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
  const d = (o: Partial<Parameters<typeof validateLoanDates>[0]>) => validateLoanDates({ plannedFrom: "2026-01-01", plannedTo: null, pickedUpAt: null, returnedAt: null, ...o });
  it("accepts no return, or a return on/after pickup", () => {
    expect(d({})).toBeNull();
    expect(d({ pickedUpAt: "2026-01-02" })).toBeNull();
    expect(d({ pickedUpAt: "2026-01-02", returnedAt: "2026-01-02" })).toBeNull();
  });
  it("flags a return without pickup or before pickup", () => {
    expect(d({ returnedAt: "2026-01-02" })).toBe("returnedWithoutPickup");
    expect(d({ pickedUpAt: "2026-01-03", returnedAt: "2026-01-02" })).toBe("returnedBeforePickup");
  });
  it("flags a planned end before the planned start, but allows equal or open ends", () => {
    expect(d({ plannedFrom: "2026-01-05", plannedTo: "2026-01-04" })).toBe("plannedToBeforeFrom");
    expect(d({ plannedFrom: "2026-01-05", plannedTo: "2026-01-05" })).toBeNull();
    expect(d({ plannedFrom: "2026-01-05", plannedTo: null })).toBeNull();
  });
  it("requires at least one date", () => {
    expect(d({ plannedFrom: null })).toBe("noDates");
    expect(d({ plannedFrom: null, plannedTo: "2026-01-05" })).toBeNull();
  });
});


import { blockedDays, freeFromTime } from "../lib/lending.js";

describe("blockedDays / freeFromTime", () => {
  const L = (o: Record<string, unknown>) => ({ plannedFrom: null, plannedTo: null, pickedUpAt: null, returnedAt: null, quantity: 1, ...o }) as any;
  it("blocks only fully covered days for individual tracking", () => {
    const loans = [L({ plannedFrom: "2026-06-02", plannedTo: "2026-06-03", plannedToTime: "12:00", plannedFromTime: "08:00" })];
    expect(blockedDays({ individualTracking: true, stock: 1 }, loans, 1, "2026-06-01", "2026-06-04")).toEqual([]);
    const full = [L({ plannedFrom: "2026-06-02", plannedTo: "2026-06-03" })];
    expect(blockedDays({ individualTracking: true, stock: 1 }, full, 1, "2026-06-01", "2026-06-04")).toEqual(["2026-06-02", "2026-06-03"]);
  });
  it("uses remaining quantity for stock items", () => {
    const loans = [L({ plannedFrom: "2026-06-02", plannedTo: "2026-06-02", quantity: 3 })];
    const item = { individualTracking: false, stock: 5 };
    expect(blockedDays(item, loans, 2, "2026-06-02", "2026-06-02")).toEqual([]);
    expect(blockedDays(item, loans, 3, "2026-06-02", "2026-06-02")).toEqual(["2026-06-02"]);
  });
  it("reports free-from time", () => {
    const loans = [L({ plannedFrom: "2026-06-01", plannedTo: "2026-06-02", plannedFromTime: "08:00", plannedToTime: "14:00" })];
    expect(freeFromTime(loans, "2026-06-02")).toBe("14:00");
    expect(freeFromTime(loans, "2026-06-01")).toBeNull();
  });
});

import { matchCandidates } from "../lib/lending.js";

describe("matchCandidates", () => {
  const pool = [
    { id: "p1", firstName: "Max", lastName: "Muster", email: "max@example.com", phone: null },
    { id: "p2", firstName: "Max", lastName: "Muster", email: "other@example.com", phone: "0928112345" },
    { id: "p3", firstName: "Anna", lastName: "Muster", email: null, phone: null },
  ];
  const request = { firstName: "Max", lastName: "Muster", email: "max@example.com", phone: null };

  it("ranks strong matches (email) before weak name-only matches", () => {
    const result = matchCandidates(request, pool);
    expect(result.map((r) => r.id)).toEqual(["p1", "p2"]);
    expect(result[0].strength).toBe("strong");
    expect(result[1].strength).toBe("weak");
  });

  it("matches by normalized phone", () => {
    const result = matchCandidates({ firstName: "x", lastName: "y", email: null, phone: "0928-112345" }, pool);
    expect(result).toEqual([{ ...pool[1], strength: "strong" }]);
  });

  it("returns nothing for no overlap", () => {
    expect(matchCandidates({ firstName: "Nobody", lastName: "Here", email: null, phone: null }, pool)).toEqual([]);
  });
});
