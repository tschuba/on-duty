import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";

vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../auth.js", () => ({ auth: { api: { getSession: async () => null } } }));

const { helpRoutes } = await import("../routes/help.js");
const app = new Hono().route("/help", helpRoutes);

describe("Hilfe ohne Login", () => {
  it.each(["/help", "/help/members", "/help/tips"])("%s leitet auf /login", async (p) => {
    const res = await app.request(p);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });
});
