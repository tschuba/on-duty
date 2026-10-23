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

describe("relativeRange (whole units)", () => {
  const t = "2026-10-14"; // Wednesday
  it("months", () => {
    expect(relativeRange(t, 2, "M", "future")).toEqual({ start: "2026-10-01", end: "2026-11-30" });
    expect(relativeRange(t, 2, "M", "past")).toEqual({ start: "2026-09-01", end: "2026-10-31" });
    expect(relativeRange(t, 1, "M", "both")).toEqual({ start: "2026-09-01", end: "2026-11-30" });
  });
  it("weeks start on Monday", () => {
    expect(relativeRange(t, 2, "W", "future")).toEqual({ start: "2026-10-12", end: "2026-10-25" });
  });
  it("days", () => {
    expect(relativeRange(t, 7, "D", "future")).toEqual({ start: t, end: "2026-10-20" });
    expect(relativeRange(t, 7, "D", "past")).toEqual({ start: "2026-10-08", end: t });
  });
  it("calendar years", () => {
    expect(relativeRange(t, 2, "Y", "past")).toEqual({ start: "2025-01-01", end: "2026-12-31" });
  });
  it("ceremony years (cutoff 01-06)", () => {
    expect(relativeRange(t, 2, "Y", "future", "01-06")).toEqual({ start: "2026-01-07", end: "2028-01-06" });
    expect(relativeRange("2026-01-06", 1, "Y", "future", "01-06")).toEqual({ start: "2025-01-07", end: "2026-01-06" });
  });
  it("yr=ceremony only with cutoff and unit Y", () => {
    const q = { range: "rel", rel: "P2Y", dir: "future", yr: "ceremony" };
    const def = { start: t, end: t };
    expect(parseRange(q, t, "future", def, "01-06").start).toBe("2026-01-07");
    expect(parseRange(q, t, "future", def).start).toBe("2026-01-01");
    expect(parseRange({ ...q, rel: "P2M" }, t, "future", def, "01-06").rel!.ceremony).toBe(false);
    expect(rangeParams(parseRange(q, t, "future", def, "01-06")).yr).toBe("ceremony");
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

import { formatRange, relLabel } from "../lib/quick-range.js";

describe("formatRange", () => {
  const today = "2026-10-23";
  it.each([
    ["2026-03-01", "2026-03-31", "März 2026"],
    ["2026-02-01", "2026-02-28", "Februar 2026"],
    ["2028-02-01", "2028-02-29", "Februar 2028"],
    ["2026-01-01", "2026-03-31", "Jan – März 2026"],
    ["2026-11-01", "2027-02-28", "Nov 2026 – Feb 2027"],
    ["2026-01-01", "2026-12-31", "2026"],
    ["2026-10-23", "2027-01-23", "heute bis 23.01.2027"],
    ["2026-07-23", "2026-10-23", "23.07.2026 bis heute"],
    ["2026-01-23", "2026-06-23", "23.01. – 23.06.2026"],
    ["2026-10-23", "2027-10-23", "heute bis 23.10.2027"],
    ["2026-10-14", "2027-01-14", "14.10.2026 – 14.01.2027"],
    ["2026-01-01", "", "ab 01.01.2026"],
    ["", "2027-01-23", "bis 23.01.2027"],
  ])("%s … %s → %s", (s, e, out) => expect(formatRange(s, e, today)).toBe(out));
  it("Monatsregel hat Vorrang vor heute", () => expect(formatRange("2026-03-01", "2026-03-31", "2026-03-01")).toBe("März 2026"));
});

describe("relLabel", () => {
  it("Vorzeichen und Singular", () => {
    expect(relLabel(3, "M", "future")).toBe("+3 Monate");
    expect(relLabel(1, "W", "past")).toBe("−1 Woche");
    expect(relLabel(10, "D", "both")).toBe("±10 Tage");
    expect(relLabel(1, "Y", "future")).toBe("+1 Jahr");
  });
});
