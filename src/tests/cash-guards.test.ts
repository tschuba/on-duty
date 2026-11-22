import { describe, it, expect, vi } from "vitest";

process.env.ORG_NAME = "Test";
process.env.OIDC_APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret";

// Nur die Guards zählen: ohne DB scheitert ein durchgelassener Handler mit 500, ein abgewiesener liefert 403.
vi.mock("../db/index.js", () => ({ db: {} }));

let perms = new Set<string>();
// Wie die echte requireAuth: es genügt eines der verlangten Rechte.
vi.mock("../middleware/auth.js", async () => {
  const actual = await vi.importActual<any>("../middleware/auth.js");
  return {
    ...actual,
    requireAuth: (required?: any) => async (c: any, next: any) => {
      const req: string[] = Array.isArray(required) ? required : required ? [required] : [];
      if (req.length && !req.some((p) => perms.has(p))) return c.text("forbidden", 403);
      c.set("user", { id: "u1", name: "T", permissions: perms, disabled: false });
      await next();
    },
  };
});

const { cashRoutes } = await import("../routes/cash.js");

const ROUTES: [method: string, path: string, allowedBy: string[]][] = [
  ["GET", "/", ["cash:report", "cash:read", "cash:manage"]],
  ["GET", "/report.csv", ["cash:read", "cash:manage"]],
  ["GET", "/new", ["cash:manage"]],
  ["POST", "/new", ["cash:manage"]],
  ["GET", "/item-row", ["cash:manage"]],
  ["GET", "/x/edit", ["cash:manage"]],
  ["POST", "/x/edit", ["cash:manage"]],
  ["POST", "/x/pay", ["cash:manage"]],
  ["POST", "/x/cancel", ["cash:cancel", "cash:manage"]],
  ["POST", "/settings", ["cash:manage"]],
  ["POST", "/open", ["cash:manage"]],
  ["POST", "/open-zero", ["cash:manage"]],
  ["POST", "/tags/x", ["cash:manage"]],
  ["POST", "/year/x/close", ["cash:manage"]],
  ["POST", "/year/x/reopen", ["cash:reopen"]],
  ["POST", "/donation/x", ["cash:manage"]],
];

const ALL = ["cash:report", "cash:read", "cash:manage", "cash:cancel", "cash:lending", "cash:reopen"];
const status = async (method: string, path: string, p: string[]) => {
  perms = new Set(p);
  return (await cashRoutes.request(path, { method, ...(method === "POST" ? { headers: { "content-type": "application/x-www-form-urlencoded" }, body: "" } : {}) })).status;
};

describe("cash route guards", () => {
  it("rejects users without any cash permission everywhere", async () => {
    for (const [m, path] of ROUTES) expect(await status(m, path, ["members:read", "lending:manage"]), `${m} ${path}`).toBe(403);
  });

  it("lets each route through exactly for its permissions", async () => {
    for (const [m, path, allowed] of ROUTES) {
      for (const p of ALL) {
        const passes = await status(m, path, [p]).then((s) => s !== 403);
        expect(passes, `${m} ${path} with ${p}`).toBe(allowed.includes(p));
      }
    }
  });

  it("keeps lending-only users out of the cash book", async () => {
    for (const [m, path] of ROUTES) expect(await status(m, path, ["cash:lending"]), `${m} ${path}`).toBe(403);
  });

  it("does not let manage reopen a year (four-eyes)", async () => {
    expect(await status("POST", "/year/x/reopen", ["cash:manage"])).toBe(403);
    expect(await status("POST", "/year/x/reopen", ["cash:reopen"])).not.toBe(403);
  });
});
