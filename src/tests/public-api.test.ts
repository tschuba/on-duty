import { describe, it, expect, vi } from "vitest";

const findMany = vi.fn();
const limit = vi.fn(async () => []);
vi.mock("../db/index.js", () => ({
  db: {
    query: { members: { findMany } },
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit }) }) }) }),
  },
}));

const { publicApiRoutes, publicApiRateLimited } = await import("../routes/public-api.js");

describe("public api", () => {
  it("counts only active/youth/children and sets cache header", async () => {
    const role = { grantsActiveStatus: true };
    const m = (birthDate: string) => ({ birthDate, exitDate: null, deathDate: null, person: { birthDate }, assignments: [{ role, to: null }] });
    const year = new Date().getFullYear();
    findMany.mockResolvedValue([m(`${year - 30}-01-01`), m(`${year - 14}-01-01`), m(`${year - 5}-01-01`)]);
    const res = await publicApiRoutes.request("/stats", { headers: { "x-forwarded-for": "1.1.1.1" } });
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    const { members } = await res.json();
    expect(members.active + members.youth + members.children).toBe(3);
  });

  it("rejects invalid limit", async () => {
    const res = await publicApiRoutes.request("/events?limit=0", { headers: { "x-forwarded-for": "2.2.2.2" } });
    expect(res.status).toBe(400);
  });

  it("returns events", async () => {
    const res = await publicApiRoutes.request("/events?limit=5", { headers: { "x-forwarded-for": "3.3.3.3" } });
    expect(await res.json()).toEqual({ events: [] });
  });

  it("rate limits", () => {
    for (let i = 0; i < 60; i++) expect(publicApiRateLimited("9.9.9.9")).toBe(false);
    expect(publicApiRateLimited("9.9.9.9")).toBe(true);
  });
});
