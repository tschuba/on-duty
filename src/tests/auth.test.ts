import { describe, it, expect, vi, beforeEach } from "vitest";
import { users } from "../db/schema/index.js";

process.env.ORG_NAME = "Test Feuerwehr";
process.env.ADMIN_PASSWORD = "test-password-123";
process.env.BETTER_AUTH_SECRET = "test-secret";
process.env.OIDC_PROVIDER = "https://idp.example.invalid";
process.env.OIDC_CLIENT_ID = "test-client";
process.env.OIDC_CLIENT_SECRET = "test-client-secret";
process.env.OIDC_APP_URL = "http://localhost:3000";
process.env.DATABASE_URL = "postgres://test";

// ── DB stub ──────────────────────────────────────────────────────────────────
// Only `update` is exercised by recordSuccessfulLogin — the rest are inert
// stubs so Better Auth's drizzle adapter can construct without throwing.

function chain(): any {
  const c: any = { from: vi.fn(() => c), where: vi.fn(() => c), limit: vi.fn(() => c) };
  return c;
}

const updateCalls: { table: unknown; set: unknown; whereArg: unknown }[] = [];

const select = vi.fn(() => chain());
const insert = vi.fn(() => ({ values: vi.fn(() => Promise.resolve(undefined)) }));
const del = vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) }));
const update = vi.fn((table: unknown) => ({
  set: vi.fn((vals: unknown) => ({
    where: vi.fn((whereArg: unknown) => {
      updateCalls.push({ table, set: vals, whereArg });
      return Promise.resolve(undefined);
    }),
  })),
}));

vi.mock("../db/index.js", () => ({
  db: { select, insert, update, delete: del },
}));

const { recordSuccessfulLogin } = await import("../auth.js");

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls.length = 0;
});

describe("recordSuccessfulLogin", () => {
  it("sets lastLoginAt to now for the given user", async () => {
    await recordSuccessfulLogin("u1");

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe(users);
    expect((updateCalls[0].set as { lastLoginAt: Date }).lastLoginAt).toBeInstanceOf(Date);
  });
});
