import { describe, it, expect, vi } from "vitest";

process.env.ORG_NAME = "Test Feuerwehr";
process.env.ADMIN_PASSWORD = "test-password-123";
process.env.BETTER_AUTH_SECRET = "test-secret";
process.env.OIDC_PROVIDER = "https://idp.example.invalid";
process.env.OIDC_CLIENT_ID = "test-client";
process.env.OIDC_CLIENT_SECRET = "test-client-secret";
process.env.OIDC_APP_URL = "http://localhost:3000";
process.env.DATABASE_URL = "postgres://test";

// ── DB stub ──────────────────────────────────────────────────────────────────
// /admin/login never reaches the DB for a bad username, and Better Auth's
// drizzle adapter just needs something to hold a reference to at construction.

function chain(): any {
  const c: any = { from: vi.fn(() => c), where: vi.fn(() => c), limit: vi.fn(() => c) };
  return c;
}

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => chain()),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve(undefined)) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })) })),
    delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })),
  },
}));

let orgConfigFixture: Record<string, string> = {};
vi.mock("../lib/org-config.js", () => ({ loadOrgConfig: vi.fn(async () => orgConfigFixture) }));

const { loginRoutes } = await import("../routes/login.js");

describe("GET /login", () => {
  it("shows the org name in the heading", async () => {
    orgConfigFixture = { orgName: "FF Altenhammer" };
    const html = await (await loginRoutes.request("/login")).text();
    expect(html).toMatch(/<h1[^>]*>FF Altenhammer<\/h1>/);
    expect(html).not.toContain("OIDC");
  });

  it("falls back to plain on-duty when the org name is empty", async () => {
    orgConfigFixture = { orgName: " " };
    const html = await (await loginRoutes.request("/login")).text();
    expect(html).toMatch(/<h1[^>]*>on-duty<\/h1>/);
  });
});

describe("GET /admin/login", () => {
  it("autofocuses the username field", async () => {
    const html = await (await loginRoutes.request("/admin/login")).text();
    expect(html).toMatch(/name="username"[^>]*autofocus/);
  });
});

describe("POST /admin/login", () => {
  it("keeps the username field autofocused after a failed attempt", async () => {
    const body = new URLSearchParams({ username: "not-admin", password: "wrong" });
    const res = await loginRoutes.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toMatch(/name="username"[^>]*autofocus/);
  });
});
