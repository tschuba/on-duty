import { describe, it, expect } from "vitest";
import { isFormCurrentlyActive } from "../lib/application-forms.js";

const today = "2026-06-15";

describe("isFormCurrentlyActive", () => {
  it("is undefined-safe (no row yet = inactive)", () => {
    expect(isFormCurrentlyActive(undefined, today)).toBe(false);
  });

  it("applies isActive unconditionally when no dates are set", () => {
    expect(isFormCurrentlyActive({ isActive: true, startDate: null, endDate: null }, today)).toBe(true);
    expect(isFormCurrentlyActive({ isActive: false, startDate: null, endDate: null }, today)).toBe(false);
  });

  it("start date only: opposite before it, isActive from it onward (inclusive)", () => {
    const form = { isActive: true, startDate: "2026-06-15", endDate: null };
    expect(isFormCurrentlyActive(form, "2026-06-14")).toBe(false);
    expect(isFormCurrentlyActive(form, "2026-06-15")).toBe(true);
    expect(isFormCurrentlyActive(form, "2026-06-16")).toBe(true);
  });

  it("end date only: isActive up to and including it, opposite after", () => {
    const form = { isActive: true, startDate: null, endDate: "2026-06-15" };
    expect(isFormCurrentlyActive(form, "2026-06-14")).toBe(true);
    expect(isFormCurrentlyActive(form, "2026-06-15")).toBe(true);
    expect(isFormCurrentlyActive(form, "2026-06-16")).toBe(false);
  });

  it("both dates: isActive only inside the inclusive range, opposite outside", () => {
    const form = { isActive: true, startDate: "2026-06-10", endDate: "2026-06-20" };
    expect(isFormCurrentlyActive(form, "2026-06-09")).toBe(false);
    expect(isFormCurrentlyActive(form, "2026-06-10")).toBe(true);
    expect(isFormCurrentlyActive(form, "2026-06-20")).toBe(true);
    expect(isFormCurrentlyActive(form, "2026-06-21")).toBe(false);
  });

  it("a base-inactive status with a range means active outside the range", () => {
    const form = { isActive: false, startDate: "2026-06-10", endDate: "2026-06-20" };
    expect(isFormCurrentlyActive(form, "2026-06-09")).toBe(true);
    expect(isFormCurrentlyActive(form, "2026-06-15")).toBe(false);
    expect(isFormCurrentlyActive(form, "2026-06-21")).toBe(true);
  });
});
