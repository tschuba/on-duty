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

describe("migration 0044 keeps member status stable", () => {
  it("leaves the active flag of every pre-existing role unchanged", async () => {
    const { readFileSync } = await import("node:fs");
    const legacy = readFileSync("drizzle/0001_seed.sql", "utf8");
    for (const m of legacy.matchAll(/\('([0-9a-f-]{36})',\s*'[^']*',\s*(true|false)\)/g)) {
      const seeded = ROLE_SEED.find((r) => r.id === m[1]);
      if (seeded) expect(seeded.grantsActiveStatus, m[1]).toBe(m[2] === "true");
    }
  });

  it("derives the same status for a legacy member (Kommandant, active)", async () => {
    const { deriveMemberStatus } = await import("../lib/status.js");
    const role: any = { grantsActiveStatus: ROLE_SEED.find((r) => r.title === "Kommandant")!.grantsActiveStatus };
    const a: any = { role, from: "2010-01-01", to: null };
    expect(deriveMemberStatus({ birthDate: "1980-01-01", exitDate: null, deathDate: null }, [a], 12, 18, 65, new Date("2026-01-01"))).toBe("aktiv");
  });
});
