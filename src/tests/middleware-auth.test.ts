import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const getSession = vi.fn();
const dbDeleteWhere = vi.fn().mockResolvedValue(undefined);
const dbDelete = vi.fn(() => ({ where: dbDeleteWhere }));

vi.mock("../auth.js", () => ({
  auth: { api: { getSession } },
}));

vi.mock("../db/index.js", () => ({
  db: { delete: dbDelete },
}));

const { requireAuth } = await import("../middleware/auth.js");
type Variables = { user: { id: string } };

function appWith(minRole?: "read" | "editor" | "admin") {
  const app = new Hono<{ Variables: Variables }>();
  app.get("/protected", requireAuth(minRole), (c) => c.text(`ok:${c.get("user").id}`));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbDeleteWhere.mockResolvedValue(undefined);
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
    getSession.mockResolvedValue({ user: { id: "u1", disabled: true, appRole: "admin" } });
    const res = await appWith().request("/protected");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=disabled");
    expect(dbDelete).toHaveBeenCalled();
    expect(dbDeleteWhere).toHaveBeenCalled();
  });

  it("returns 403 when the user's role is below the minimum", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", disabled: false, appRole: "read" } });
    const res = await appWith("admin").request("/protected");

    expect(res.status).toBe(403);
    expect(dbDelete).not.toHaveBeenCalled();
  });

  it("sets the user and calls next when access is granted", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", disabled: false, appRole: "admin" } });
    const res = await appWith("admin").request("/protected");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok:u1");
  });
});
