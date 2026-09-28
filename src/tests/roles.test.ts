import { describe, it, expect } from "vitest";
import { hasRequiredRole } from "../lib/roles.js";

describe("hasRequiredRole", () => {
  it("allows when role meets minimum", () => {
    expect(hasRequiredRole("editor", "read")).toBe(true);
    expect(hasRequiredRole("admin", "admin")).toBe(true);
  });

  it("denies when role is below minimum", () => {
    expect(hasRequiredRole("read", "editor")).toBe(false);
    expect(hasRequiredRole("editor", "admin")).toBe(false);
  });

  it("denies unknown roles", () => {
    expect(hasRequiredRole("bogus", "read")).toBe(false);
  });
});
