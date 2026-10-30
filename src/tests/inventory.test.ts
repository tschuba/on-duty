import { describe, it, expect } from "vitest";
import { generateInspectionDueItems } from "../lib/inventory.js";

describe("generateInspectionDueItems", () => {
  const base = {
    id: "i1", name: "Atemschutzgerät 1", category: "scba" as const,
    retiredAt: null, vehicleInspectionDue: null, nextInspectionDue: "2026-06-15",
  };

  it("includes an item whose nextInspectionDue falls in range", () => {
    const result = generateInspectionDueItems([base], "2026-01-01", "2026-12-31");
    expect(result).toEqual([{ id: "i1", name: "Atemschutzgerät 1", category: "scba", dueDate: "2026-06-15" }]);
  });

  it("excludes an item whose due date falls outside the range", () => {
    const result = generateInspectionDueItems([base], "2027-01-01", "2027-12-31");
    expect(result).toEqual([]);
  });

  it("uses vehicleInspectionDue (not nextInspectionDue) for vehicles", () => {
    const vehicle = { ...base, category: "vehicle" as const, nextInspectionDue: null, vehicleInspectionDue: "2026-03-01" };
    const result = generateInspectionDueItems([vehicle], "2026-01-01", "2026-12-31");
    expect(result).toEqual([{ id: "i1", name: "Atemschutzgerät 1", category: "vehicle", dueDate: "2026-03-01" }]);
  });

  it("skips items without a due date set", () => {
    const result = generateInspectionDueItems([{ ...base, nextInspectionDue: null }], "2026-01-01", "2026-12-31");
    expect(result).toEqual([]);
  });

  it("skips retired items even when a due date is in range", () => {
    const result = generateInspectionDueItems([{ ...base, retiredAt: "2026-02-01" }], "2026-01-01", "2026-12-31");
    expect(result).toEqual([]);
  });

  it("sorts by due date, then name", () => {
    const result = generateInspectionDueItems(
      [
        { ...base, id: "i2", name: "B-Gerät", nextInspectionDue: "2026-02-01" },
        { ...base, id: "i1", name: "A-Gerät", nextInspectionDue: "2026-02-01" },
        { ...base, id: "i3", name: "C-Gerät", nextInspectionDue: "2026-01-01" },
      ],
      "2026-01-01", "2026-12-31",
    );
    expect(result.map((r) => r.id)).toEqual(["i3", "i1", "i2"]);
  });
});

import { blockedOptionRemovals, isFieldEmpty, normalizeFieldValue, parseOptions, validateLocation } from "../lib/inventory.js";

const empty = { quantity: 1, retiredQuantity: 0, numbers: 0, serials: 0, assignments: 0, locationText: null, latitude: null, longitude: null, vehicleInspectionDue: null, nextInspectionDue: null, lastInspectionDate: null, activeLoans: 0 };

describe("isFieldEmpty", () => {
  it("allows deselecting empty fields", () => {
    for (const f of ["quantity", "numbers", "serials", "location", "inspection", "assignments"] as const) expect(isFieldEmpty(f, empty)).toBe(true);
  });
  it("locks fields that hold data", () => {
    expect(isFieldEmpty("quantity", { ...empty, quantity: 3 })).toBe(false);
    expect(isFieldEmpty("quantity", { ...empty, retiredQuantity: 1 })).toBe(false);
    expect(isFieldEmpty("quantity", { ...empty, activeLoans: 1 })).toBe(false);
    expect(isFieldEmpty("numbers", { ...empty, numbers: 1 })).toBe(false);
    expect(isFieldEmpty("serials", { ...empty, serials: 1 })).toBe(false);
    expect(isFieldEmpty("assignments", { ...empty, assignments: 1 })).toBe(false);
    expect(isFieldEmpty("location", { ...empty, locationText: "Halle" })).toBe(false);
    expect(isFieldEmpty("location", { ...empty, latitude: "48.1", longitude: "11.5" })).toBe(false);
    expect(isFieldEmpty("inspection", { ...empty, lastInspectionDate: "2026-01-01" })).toBe(false);
  });
});

describe("validateLocation", () => {
  it("accepts none or both coordinates in range", () => {
    expect(validateLocation("", "")).toEqual({});
    expect(validateLocation("48,13", "-11.5")).toEqual({});
  });
  it("rejects out-of-range, non-numeric and single coordinates", () => {
    expect(validateLocation("91", "0").latitude).toBe("invalid");
    expect(validateLocation("0", "181").longitude).toBe("invalid");
    expect(validateLocation("x", "0").latitude).toBe("invalid");
    expect(validateLocation("48", "").longitude).toBe("pair");
    expect(validateLocation("", "11").latitude).toBe("pair");
  });
});

describe("normalizeFieldValue", () => {
  it("treats empty as null for every type", () => expect(normalizeFieldValue("number", null, "  ")).toEqual({ value: null }));
  it("validates per type", () => {
    expect(normalizeFieldValue("number", null, "1,5").value).toBe("1.5");
    expect(normalizeFieldValue("number", null, "abc").error).toBe(true);
    expect(normalizeFieldValue("date", null, "2026-02-30x").error).toBe(true);
    expect(normalizeFieldValue("date", null, "2026-02-03").value).toBe("2026-02-03");
    expect(normalizeFieldValue("boolean", null, "2").error).toBe(true);
    expect(normalizeFieldValue("select", ["DN 80"], "DN 100").error).toBe(true);
    expect(normalizeFieldValue("select", ["DN 80"], "DN 80").value).toBe("DN 80");
    expect(normalizeFieldValue("text", null, " x ").value).toBe("x");
  });
});

describe("parseOptions / blockedOptionRemovals", () => {
  it("trims, drops blanks and duplicates", () => {
    expect(parseOptions(" A \r\n\nB\nA")).toEqual(["A", "B"]);
  });
  it("blocks only removed options that are used", () => {
    expect(blockedOptionRemovals(["A", "B", "C"], ["C"], ["A", null])).toEqual(["A"]);
  });
});
