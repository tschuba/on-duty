import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

process.env.ORG_NAME = "Test Feuerwehr";
process.env.BETTER_AUTH_SECRET = "test-secret";
process.env.OIDC_PROVIDER = "https://idp.example.invalid";
process.env.OIDC_CLIENT_ID = "c";
process.env.OIDC_CLIENT_SECRET = "s";
process.env.OIDC_APP_URL = "http://localhost:3000";
process.env.DATABASE_URL = "postgres://test";
process.env.ADMIN_PASSWORD = "test-password-123";

let user: any;
let roleRows: any[] = [];
let block: string | null = null;
const deleteOwnAccount = vi.fn(async () => block);
const signOut = vi.fn(async () => undefined);

vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => async (c: any, next: any) => {
    c.set("user", user);
    await next();
  },
}));
vi.mock("../lib/account.js", () => ({ deleteOwnAccount: (...a: unknown[]) => (deleteOwnAccount as any)(...a) }));
vi.mock("../lib/flash.js", () => ({ setFlash: vi.fn() }));
vi.mock("../auth.js", () => ({ auth: { api: { signOut: (...a: unknown[]) => (signOut as any)(...a) } } }));
vi.mock("../db/index.js", () => {
  const c: any = { from: () => c, innerJoin: () => c, where: () => Promise.resolve(roleRows) };
  return { db: { select: () => c } };
});

const { accountRoutes, pendingRoutes } = await import("../routes/account.js");
const app = new Hono().route("/account", accountRoutes).route("/pending", pendingRoutes);

beforeEach(() => {
  user = { id: "u1", name: "Max", email: "max@x.de", emailVerified: true, permissions: new Set<string>() };
  roleRows = [];
  block = null;
  deleteOwnAccount.mockClear();
  signOut.mockClear();
});

describe("/pending", () => {
  it("redirects active users", async () => {
    user.permissions = new Set(["x"]);
    const res = await app.request("/pending");
    expect(res.status).toBe(302);
  });
  it("shows the unverified text", async () => {
    user.emailVerified = false;
    const res = await app.request("/pending");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("/account/delete");
  });
  it("shows pending for verified users without role", async () => {
    expect((await app.request("/pending")).status).toBe(200);
  });
});

const post = (email: string, back = "/account") =>
  app.request("/account/delete", { method: "POST", body: new URLSearchParams({ email, back }) });

describe("/account", () => {
  it("hides the danger zone for the local admin", async () => {
    const { LOCAL_ADMIN_ACCOUNT_ID } = await import("../lib/constants.js");
    user.id = LOCAL_ADMIN_ACCOUNT_ID;
    expect(await (await app.request("/account")).text()).not.toContain("Gefahrenbereich");
  });
  it("shows the danger zone otherwise", async () => {
    expect(await (await app.request("/account")).text()).toContain("Gefahrenbereich");
  });
  it("delete: wrong email is rejected, pending goes back to /pending", async () => {
    const res = await post("other@x.de", "/pending");
    expect(res.headers.get("location")).toBe("/pending");
    expect(deleteOwnAccount).not.toHaveBeenCalled();
  });
  it("renders profile and roles", async () => {
    roleRows = [{ name: "Wehrführer" }];
    const html = await (await app.request("/account")).text();
    expect(html).toContain("max@x.de");
    expect(html).toContain("Wehrführer");
  });
  it("renders a dash without roles", async () => {
    expect(await (await app.request("/account")).text()).toContain("—");
  });
  it("shows permission labels", async () => {
    user.permissions = new Set(["members:read"]);
    expect(await (await app.request("/account")).text()).toContain("Mitglieder ansehen");
  });
  it("shows the full badge for all permissions", async () => {
    const { PERMISSIONS } = await import("../lib/roles.js");
    const { PermissionBadges } = await import("../components/permission-badges.js");
    expect(String(<PermissionBadges permissions={[...PERMISSIONS]} />)).toContain("Unbeschränkter Vollzugriff");
  });
  it("renders two dashes without roles and permissions", async () => {
    expect(((await (await app.request("/account")).text()).match(/—/g) ?? []).length).toBe(2);
  });
  it("delete: blocked redirects back to /account", async () => {
    block = "lastAdmin";
    const res = await post("max@x.de");
    expect(res.headers.get("location")).toBe("/account");
    expect(signOut).not.toHaveBeenCalled();
  });
  it("delete: signs out and goes to /login", async () => {
    const res = await post(" MAX@x.de ");
    expect(res.headers.get("location")).toBe("/login");
    expect(signOut).toHaveBeenCalled();
  });
});
