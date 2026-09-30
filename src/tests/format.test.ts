import { describe, it, expect } from "vitest";
import { formatDate } from "../lib/format.js";

describe("formatDate", () => {
  it("formats an ISO date as DD.MM.YYYY", () => {
    expect(formatDate("2026-01-15")).toBe("15.01.2026");
  });

  it("returns an em-dash for null/undefined", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });
});
