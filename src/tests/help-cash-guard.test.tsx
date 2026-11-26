import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";

vi.mock("../db/index.js", () => ({ db: {} }));
let perms = new Set<string>();
// Wie die echte requireAuth: es genügt eines der verlangten Rechte.
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (required?: string[]) => async (c: any, next: any) => {
    if (required?.length && !required.some((p) => perms.has(p))) return c.text("forbidden", 403);
    c.set("user", { id: "u1", name: "T", permissions: perms, roleIds: new Set(), disabled: false });
    await next();
  },
}));

const { helpRoutes } = await import("../routes/help.js");
const app = new Hono().route("/help", helpRoutes);

describe("/help/cash Guard", () => {
  it.each([[[], 403], [["members:read"], 403], [["cash:report"], 200], [["cash:manage"], 200]] as const)("%j → %i", async (p, status) => {
    perms = new Set(p);
    expect((await app.request("/help/cash")).status).toBe(status);
  });
});
