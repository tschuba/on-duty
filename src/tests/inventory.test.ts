import { describe, it, expect } from "vitest";
import { diffInspections, generateInspectionDueItems, nextDueDate, parseInspectionRows } from "../lib/inventory.js";

describe("generateInspectionDueItems", () => {
  const item = (id: string, name: string, inspections: { id: string; name: string; dueDate: string | null }[], retiredAt: string | null = null) => ({ id, name, retiredAt, inspections });
  const range = ["2026-01-01", "2026-12-31"] as const;

  it("emits one row per due inspection of an item", () => {
    const r = generateInspectionDueItems([item("i1", "LF", [{ id: "a", name: "HU", dueDate: "2026-06-01" }, { id: "b", name: "UVV-Prüfung", dueDate: "2026-03-01" }])], ...range);
    expect(r.map((x) => [x.id, x.inspectionName])).toEqual([["i1", "UVV-Prüfung"], ["i1", "HU"]]);
  });

  it("skips done (no due date), out-of-range and retired", () => {
    const r = generateInspectionDueItems(
      [
        item("i1", "A", [{ id: "a", name: "HU", dueDate: null }, { id: "b", name: "X", dueDate: "2027-01-01" }]),
        item("i2", "B", [{ id: "c", name: "HU", dueDate: "2026-02-01" }], "2026-01-05"),
      ],
      ...range,
    );
    expect(r).toEqual([]);
  });

  it("filters by name case-insensitively and sorts by date, then item name", () => {
    const r = generateInspectionDueItems(
      [
        item("i1", "B", [{ id: "a", name: "HU", dueDate: "2026-02-01" }]),
        item("i2", "A", [{ id: "b", name: "hu", dueDate: "2026-02-01" }, { id: "c", name: "Druckprüfung", dueDate: "2026-01-01" }]),
      ],
      ...range, ["HU"],
    );
    expect(r.map((x) => x.id)).toEqual(["i2", "i1"]);
  });
});

describe("nextDueDate", () => {
  it("anchors on the old due date so the schedule does not drift", () => expect(nextDueDate("2026-06-01", 12, "2026-06-20")).toBe("2027-06-01"));
  it("falls back to inspection date + interval when too late by more than an interval", () => expect(nextDueDate("2024-01-01", 12, "2026-03-10")).toBe("2027-03-10"));
  it("uses inspection date + interval without an old due date", () => expect(nextDueDate(null, 6, "2026-03-31")).toBe("2026-09-30"));
  it("clears the due date without an interval", () => expect(nextDueDate("2026-06-01", null, "2026-06-20")).toBeNull());
});

import { blockedOptionRemovals, isFieldEmpty, normalizeFieldValue, parseOptions, validateLocation } from "../lib/inventory.js";

const empty = { quantity: 1, retiredQuantity: 0, numbers: 0, serials: 0, assignments: 0, locationText: null, latitude: null, longitude: null, inspections: 0, activeLoans: 0 };

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
    expect(isFieldEmpty("inspection", { ...empty, inspections: 1 })).toBe(false);
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

describe("parseInspectionRows", () => {
  const today = "2026-06-01";
  const post = (rows: Partial<Record<"id" | "name" | "interval" | "last" | "due", string>>[]) => ({
    insp_id: rows.map((r) => r.id ?? ""), insp_name: rows.map((r) => r.name ?? ""), insp_interval: rows.map((r) => r.interval ?? ""),
    insp_last: rows.map((r) => r.last ?? ""), insp_due: rows.map((r) => r.due ?? ""),
  });

  it("ignores blank rows and accepts a valid one (single row arrives as a plain string)", () => {
    expect(parseInspectionRows(post([{}, { name: " HU ", interval: "24", due: "2026-12-01" }]), today)).toEqual({
      rows: [{ id: "", name: "HU", interval: "24", last: "", due: "2026-12-01" }], errors: {},
    });
    expect(parseInspectionRows({ insp_name: "HU", insp_id: "", insp_interval: "", insp_last: "", insp_due: "" }, today).errors).toEqual({});
  });

  it("flags the first problem per row", () => {
    const { errors } = parseInspectionRows(post([
      { due: "2026-12-01" }, { name: "x".repeat(61) }, { name: "A", interval: "0" }, { name: "B", interval: "121" }, { name: "C", interval: "1.5" },
      { name: "D", due: "2026-02-30" }, { name: "E", last: "2026-06-02" }, { name: "F", last: "2026-06-01", due: "2026-01-01" }, { name: "f" },
    ]), today);
    expect(errors).toEqual({ 0: "name", 1: "nameLength", 2: "interval", 3: "interval", 4: "interval", 5: "date", 6: "future", 8: "duplicate" });
  });
});

describe("diffInspections", () => {
  it("inserts unknown ids, updates known ones and deletes the rest", () => {
    const rows = [{ id: "a" }, { id: "" }, { id: "zzz" }];
    expect(diffInspections(["a", "b"], rows)).toEqual({ insert: [{ id: "" }, { id: "zzz" }], update: [{ id: "a" }], deleteIds: ["b"] });
  });
});
