import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const getSession = vi.fn();
const dbDeleteWhere = vi.fn().mockResolvedValue(undefined);
const dbDelete = vi.fn(() => ({ where: dbDeleteWhere }));

let permissionRows: { roleId: string; permission: string | null }[] = [];
const selectWhere = vi.fn(() => Promise.resolve(permissionRows));
const selectLeftJoin = vi.fn(() => ({ where: selectWhere }));
const selectFrom = vi.fn(() => ({ leftJoin: selectLeftJoin }));
const dbSelect = vi.fn(() => ({ from: selectFrom }));

vi.mock("../auth.js", () => ({
  auth: { api: { getSession } },
}));

vi.mock("../db/index.js", () => ({
  db: { delete: dbDelete, select: dbSelect },
}));

const { requireAuth } = await import("../middleware/auth.js");
type Variables = { user: { id: string; permissions: Set<string> } };

function appWith(required?: string) {
  const app = new Hono<{ Variables: Variables }>();
  app.get("/protected", requireAuth(required as any), (c) => {
    const user = c.get("user");
    return c.json({ id: user.id, permissions: [...user.permissions] });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbDeleteWhere.mockResolvedValue(undefined);
  permissionRows = [];
});

describe("requireAuth", () => {
  it("redirects to /login and sets returnTo cookie when there is no session", async () => {
    getSession.mockResolvedValue(null);
    const res = await appWith().request("/protected");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
    expect(res.headers.get("set-cookie")).toMatch(/returnTo=%2Fprotected/);
  });

  it("deletes the session and redirects when the user is disabled", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", disabled: true } });
    const res = await appWith().request("/protected");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=disabled");
    expect(dbDelete).toHaveBeenCalled();
    expect(dbDeleteWhere).toHaveBeenCalled();
  });

  it("returns 403 when the user lacks the required permission", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", disabled: false, emailVerified: true } });
    permissionRows = [{ roleId: "r1", permission: "members:read" }];
    const res = await appWith("system:admin").request("/protected");

    expect(res.status).toBe(403);
    expect(dbDelete).not.toHaveBeenCalled();
  });

  it("sets the user's permission set and calls next when access is granted", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", disabled: false, emailVerified: true } });
    permissionRows = [{ roleId: "r1", permission: "system:admin" }, { roleId: "r1", permission: "members:read" }];
    const res = await appWith("system:admin").request("/protected");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "u1", permissions: ["system:admin", "members:read"] });
  });

  it("bare requireAuth() only requires authentication, no specific permission", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", disabled: false, emailVerified: true } });
    permissionRows = [{ roleId: "r1", permission: null }];
    const res = await appWith().request("/protected");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "u1", permissions: [] });
  });

  it("redirects users with zero roles to /pending", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", disabled: false, emailVerified: true } });
    permissionRows = [];
    const res = await appWith().request("/protected");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/pending");
  });

  it("lets zero-role users through when allowPending is set", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", disabled: false, emailVerified: true } });
    permissionRows = [];
    const app = new Hono();
    app.get("/p", requireAuth(undefined, { allowPending: true }), (c) => c.text("ok"));
    expect((await app.request("/p")).status).toBe(200);
  });

  it("keeps 403 (not /pending) for a user with a role lacking the permission", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", disabled: false, emailVerified: true } });
    permissionRows = [{ roleId: "r1", permission: "members:read" }];
    const res = await appWith("system:admin").request("/protected");
    expect(res.status).toBe(403);
  });

  it("redirects users with an unverified email to /pending even when they have a role", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", disabled: false, emailVerified: false } });
    permissionRows = [{ roleId: "r1", permission: "members:read" }];
    const res = await appWith().request("/protected");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/pending");
  });
});
