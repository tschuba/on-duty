import { describe, it, expect } from "vitest";
import { flagAllowed, isPermutation, moveId } from "../lib/role-types.js";
import { ROLE_SEED, ROLE_TYPES } from "../db/role-seed-data.js";

describe("flagAllowed", () => {
  it("allows the flag only on types that permit it", () => {
    expect(flagAllowed(true, { allowsActiveStatus: true })).toBe(true);
    expect(flagAllowed(true, { allowsActiveStatus: false })).toBe(false);
    expect(flagAllowed(false, { allowsActiveStatus: false })).toBe(true);
  });
});

describe("moveId / isPermutation", () => {
  it("swaps neighbours and keeps edges stable", () => {
    expect(moveId(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveId(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
    expect(moveId(["a", "b", "c"], "a", "up")).toEqual(["a", "b", "c"]);
    expect(moveId(["a", "b", "c"], "x", "down")).toEqual(["a", "b", "c"]);
  });
  it("accepts only permutations of the current ids", () => {
    expect(isPermutation(["b", "a"], ["a", "b"])).toBe(true);
    expect(isPermutation(["a"], ["a", "b"])).toBe(false);
    expect(isPermutation(["a", "a"], ["a", "b"])).toBe(false);
    expect(isPermutation(["a", "x"], ["a", "b"])).toBe(false);
  });
});

describe("role seed data", () => {
  it("only grants active status on types that allow it, with dense unique order per type", () => {
    for (const ty of ROLE_TYPES) {
      const roles = ROLE_SEED.filter((r) => r.type === ty.key);
      expect(roles.map((r) => r.sortOrder)).toEqual(roles.map((_, i) => i + 1));
      if (!ty.allowsActiveStatus) expect(roles.every((r) => !r.grantsActiveStatus)).toBe(true);
    }
    expect(new Set(ROLE_SEED.map((r) => r.id)).size).toBe(ROLE_SEED.length);
  });
});
