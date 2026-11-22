import { describe, it, expect } from "vitest";

process.env.ORG_NAME = "Test";
process.env.OIDC_APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret";
const { csvCell, hasCash, cashPerms, validCutoff, yearEnd } = await import("../lib/cash.js");
const { ChipInput } = await import("../components/chip-input.js");

describe("csvCell", () => {
  it("neutralises formula starts in text", () => {
    for (const v of ["=1+1", "+49 170", "-x", "@SUM(A1)", "\tx"]) expect(csvCell(v).replace(/^"/, "")).toMatch(/^'/);
  });
  it("keeps amounts, including negative ones", () => {
    expect(csvCell("-5,00")).toBe("-5,00");
    expect(csvCell("25,50")).toBe("25,50");
    expect(csvCell(-3)).toBe("-3");
  });
  it("quotes separators, quotes and newlines", () => {
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("plain")).toBe("plain");
  });
});

describe("cash permissions", () => {
  const has = (level: Parameters<typeof hasCash>[1], ...p: string[]) => hasCash(new Set(p), level);
  it("manage implies report, read, cancel and lending", () => {
    for (const l of ["report", "read", "manage", "cancel", "lending"] as const) expect(has(l, "cash:manage")).toBe(true);
  });
  it("manage does not imply reopen (four-eyes)", () => {
    expect(has("reopen", "cash:manage")).toBe(false);
    expect(has("reopen", "cash:reopen")).toBe(true);
  });
  it("read implies report but not manage", () => {
    expect(has("report", "cash:read")).toBe(true);
    expect(has("manage", "cash:read")).toBe(false);
  });
  it("report alone sees only the report", () => {
    expect(has("report", "cash:report")).toBe(true);
    for (const l of ["read", "manage", "cancel", "lending"] as const) expect(has(l, "cash:report")).toBe(false);
  });
  it("lending alone grants no cash access", () => {
    expect(has("lending", "cash:lending")).toBe(true);
    for (const l of ["report", "read", "manage"] as const) expect(has(l, "cash:lending")).toBe(false);
  });
  it("exposes the permission lists for the route guards", () => {
    expect(cashPerms("report")).toEqual(["cash:report", "cash:read", "cash:manage"]);
  });
});

describe("fiscal year dates", () => {
  it("validates cutoffs without 29 Feb", () => {
    expect(validCutoff("02-29")).toBe(false);
    expect(validCutoff("12-31")).toBe(true);
  });
  it("ends on the next cutoff", () => {
    expect(yearEnd("2026-01-07", "01-06")).toBe("2027-01-06");
    expect(yearEnd("2026-01-06", "01-06")).toBe("2026-01-06");
  });
});

describe("ChipInput new-tag chips", () => {
  it("shows the name of a pending new tag, keeps the full value", () => {
    const html = String(<ChipInput name="tags_0" label="Kategorien" values={["new:income:Flohmarkt: Süd", "abc"]} presets={[{ key: "abc", label: "Fest", badge: "badge-ghost" }]} createDirectionFrom="#dir" />);
    expect(html).toContain('value="new:income:Flohmarkt: Süd"');
    expect(html).toContain('data-label="Flohmarkt: Süd"');
    expect(html).toContain("border-dashed");
    expect(html).toContain('data-create-from="#dir"');
    expect(html).toContain(">Fest<");
  });
});
