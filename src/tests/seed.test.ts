import { describe, it, expect, vi, beforeEach } from "vitest";

function insertChain() {
  return Object.assign(Promise.resolve(undefined), {
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  });
}

const insert = vi.fn(() => ({ values: vi.fn(insertChain) }));
let existingAccounts: unknown[] = [];
const where = vi.fn(() => Promise.resolve(existingAccounts));
const select = vi.fn(() => ({ from: vi.fn(() => ({ where })) }));

vi.mock("pg", () => ({
  Pool: vi.fn(function () { return { end: vi.fn().mockResolvedValue(undefined) }; }),
}));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn(() => ({ insert, select })),
}));

const { runSeed } = await import("../db/seed.js");

beforeEach(() => {
  vi.clearAllMocks();
  existingAccounts = [];
  process.env.ADMIN_PASSWORD = "test-password";
  process.env.DATABASE_URL = "postgres://test";
});

describe("runSeed", () => {
  it("throws when ADMIN_PASSWORD is not set", async () => {
    delete process.env.ADMIN_PASSWORD;
    await expect(runSeed()).rejects.toThrow("ADMIN_PASSWORD is not set");
  });

  it("throws when DATABASE_URL is not set", async () => {
    delete process.env.DATABASE_URL;
    await expect(runSeed()).rejects.toThrow("DATABASE_URL is not set");
  });

  it("creates the admin credential account when none exists", async () => {
    existingAccounts = [];
    await runSeed();

    // memberRoleTypes, memberRoles, anniversaryYears, appRoles, appRolePermissions, users, userAppRoles, accounts
    expect(insert).toHaveBeenCalledTimes(8);
  });

  it("skips creating the admin credential account when one already exists", async () => {
    existingAccounts = [{ id: "existing" }];
    await runSeed();

    // memberRoleTypes, memberRoles, anniversaryYears, appRoles, appRolePermissions, users, userAppRoles (no accounts insert)
    expect(insert).toHaveBeenCalledTimes(7);
  });
});
