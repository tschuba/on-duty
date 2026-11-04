import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let session: unknown = { user: { id: "u1" } };
vi.mock("../auth.js", () => ({ auth: { api: { getSession: async () => session } } }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => async (c: any, next: any) => {
    c.set("user", { id: `u${Math.random()}` });
    await next();
  },
}));

const { tilesRoutes, tilesRateLimited } = await import("../routes/tiles.js");
const { ttlSeconds, pruneTileCache } = await import("../lib/tile-cache.js");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const get = (path: string) => tilesRoutes.request(path);
let fetchMock: ReturnType<typeof vi.fn>;
let dir: string;
let n = 0;
const tile = () => `/3/${n % 8}/${Math.floor(n / 8) % 8}.png`; // unique per test: in-flight/negative state is module-global

beforeEach(() => {
  n++;
  session = { user: { id: "u1" } };
  dir = mkdtempSync(join(tmpdir(), "tiles-"));
  process.env.TILE_CACHE_DIR = dir;
  fetchMock = vi.fn(async () => new Response(PNG, { headers: { "content-type": "image/png", "cache-control": "max-age=3600", etag: '"a"' } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("tile proxy", () => {
  it("401 without session", async () => {
    session = null;
    expect((await get(tile())).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["/20/0/0.png", "/3/8/0.png", "/3/0/8.png", "/3/-1/0.png", "/3/a/0.png", "/3/1.5/0.png", "/3/0/0.jpg"])("rejects %s", async (p) => {
    expect((await get(p)).status).toBeGreaterThanOrEqual(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("miss fetches upstream, hit does not", async () => {
    const p = tile();
    const r1 = await get(p);
    expect(r1.status).toBe(200);
    expect(r1.headers.get("content-type")).toBe("image/png");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/^https:\/\/tile\.openstreetmap\.org\/3\/\d\/\d\.png$/);
    const r2 = await get(p);
    expect(r2.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Number(/max-age=(\d+)/.exec(r2.headers.get("cache-control")!)![1])).toBeGreaterThan(3000);
  });

  it("upstream error → 502 and not cached", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 500 }));
    const p = tile();
    expect((await get(p)).status).toBe(502);
    expect((await get(p)).status).toBe(502); // negative-cached briefly, no hammering
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("non-PNG body → 502", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>", { headers: { "content-type": "image/png" } }));
    expect((await get(tile())).status).toBe(502);
  });

  it("rate limit", () => {
    const now = Date.now();
    const results = Array.from({ length: 61 }, () => tilesRateLimited("rl", now));
    expect(results.slice(0, 60).every((r) => !r)).toBe(true);
    expect(results[60]).toBe(true);
  });
});

describe("ttlSeconds", () => {
  it("uses max-age, Expires, fallback and caps", () => {
    expect(ttlSeconds("public, max-age=60", null)).toBe(60);
    expect(ttlSeconds(null, new Date(Date.now() + 120_000).toUTCString())).toBeGreaterThan(100);
    expect(ttlSeconds(null, null)).toBe(86400);
    expect(ttlSeconds("max-age=99999999", null)).toBe(30 * 86400);
  });
});

describe("pruneTileCache", () => {
  it("keeps the cache under the limit", async () => {
    await get(tile());
    await pruneTileCache(0);
    fetchMock.mockClear();
    // after pruning, the same tile must be fetched again
    await get(tile());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
