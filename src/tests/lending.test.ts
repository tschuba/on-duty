import { describe, it, expect } from "vitest";
import { effectiveRange, rangesOverlap } from "../lib/lending.js";

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
