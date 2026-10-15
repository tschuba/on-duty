import { describe, expect, it } from "vitest";
import { rangePresets } from "../lib/quick-range.js";

describe("rangePresets", () => {
  it("future: 3 Monate ab heute, nächstes Jahr", () => {
    const p = rangePresets("2026-10-14", "future");
    expect(p[0]).toMatchObject({ start: "2026-10-14", end: "2027-01-14" });
    expect(p[4]).toMatchObject({ start: "2027-01-01", end: "2027-12-31" });
  });
  it("past: letzte 3 Monate, letztes Jahr", () => {
    const p = rangePresets("2026-10-14", "past");
    expect(p[0]).toMatchObject({ start: "2026-07-14", end: "2026-10-14" });
    expect(p[4]).toMatchObject({ start: "2025-01-01", end: "2025-12-31" });
  });
});
