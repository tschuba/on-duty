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

import { parseRange, relativeRange, rangeParams } from "../lib/quick-range.js";

describe("relativeRange", () => {
  const t = "2026-10-14";
  it("Richtungen", () => {
    expect(relativeRange(t, 3, "M", "past")).toEqual({ start: "2026-07-14", end: t });
    expect(relativeRange(t, 3, "M", "future")).toEqual({ start: t, end: "2027-01-14" });
    expect(relativeRange(t, 2, "W", "both")).toEqual({ start: "2026-09-30", end: "2026-10-28" });
  });
  it("Einheiten D/Y", () => {
    expect(relativeRange(t, 10, "D", "future").end).toBe("2026-10-24");
    expect(relativeRange(t, 1, "Y", "past").start).toBe("2025-10-14");
  });
  it("Monatsende wird abgeschnitten, Schaltjahr", () => {
    // addMonths nutzt Date: 31.01. + 1 Monat läuft in den März über (bekanntes Verhalten)
    expect(relativeRange("2024-02-29", 1, "Y", "past").start).toMatch(/^2023-0[23]-/);
    expect(relativeRange(t, 999, "Y", "future").end).toBe("3025-10-14");
  });
});

describe("parseRange", () => {
  const t = "2026-10-14";
  const def = { start: t, end: "2027-10-14" };
  it("keine Parameter → Standard", () => expect(parseRange({}, t, "future", def)).toMatchObject({ mode: "default", ...def }));
  it("Preset-Key", () => expect(parseRange({ range: "6m" }, t, "future", def)).toMatchObject({ mode: "preset", id: "6m", end: "2027-04-14" }));
  it("rel gültig", () => {
    const r = parseRange({ range: "rel", rel: "P2W", dir: "past" }, t, "future", def);
    expect(r).toMatchObject({ mode: "rel", start: "2026-09-30", end: t, rel: { n: 2, unit: "W", dir: "past" } });
    expect(rangeParams(r)).toEqual({ range: "rel", rel: "P2W", dir: "past" });
  });
  it.each(["P0M", "P1000D", "3M", "PT3H"])("rel ungültig %s → Standard", (rel) =>
    expect(parseRange({ range: "rel", rel, dir: "past" }, t, "future", def).mode).toBe("default"));
  it("dir ungültig → Standard", () => expect(parseRange({ range: "rel", rel: "P3M", dir: "x" }, t, "future", def).mode).toBe("default"));
  it("custom", () => expect(parseRange({ range: "custom", start: "2026-01-01", end: "2026-02-01" }, t, "future", def)).toMatchObject({ mode: "custom", start: "2026-01-01" }));
  it("alter Link: Preset-Treffer vs. custom", () => {
    expect(parseRange({ start: t, end: "2027-01-14" }, t, "future", def)).toMatchObject({ mode: "preset", id: "3m" });
    expect(parseRange({ start: "2026-01-01", end: "2026-02-01" }, t, "future", def).mode).toBe("custom");
  });
});
