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
