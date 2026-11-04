import { Hono } from "hono";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { auth } from "../auth.js";
import { getTile, validTile, pruneTileCache } from "../lib/tile-cache.js";
import { logger } from "../lib/logger.js";

const MAX_PER_MINUTE = 600; // a full-screen map loads ~30 tiles; this allows heavy panning
const MAX_PER_SECOND = 60;

// shortcut: in-memory per process, counted per instance when running several; upgrade to a shared store then.
const hits = new Map<string, number[]>();
export function tilesRateLimited(userId: string, now = Date.now()): boolean {
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(userId, recent);
  return recent.length > MAX_PER_MINUTE || recent.filter((t) => now - t < 1000).length > MAX_PER_SECOND;
}

export const tilesRoutes = new Hono<{ Variables: Variables }>();

// Images: answer 401 instead of the login redirect (which would also set a returnTo cookie).
tilesRoutes.use("*", async (c, next) => {
  if (!(await auth.api.getSession({ headers: c.req.raw.headers }))) return c.body(null, 401);
  await next();
});
tilesRoutes.use("*", requireAuth("inventory:read"));

tilesRoutes.get("/:z/:x/:y{[0-9]+\\.png}", async (c) => {
  const tile = validTile(c.req.param("z"), c.req.param("x"), c.req.param("y").replace(/\.png$/, ""));
  if (!tile) return c.body(null, 400);
  if (tilesRateLimited(c.get("user").id)) return c.body(null, 429);
  const res = await getTile(tile.z, tile.x, tile.y);
  if (!res) return c.body(null, 502);
  return c.body(new Uint8Array(res.body), 200, {
    "content-type": "image/png",
    "cache-control": `private, max-age=${res.freshFor}`, // private: tiles are behind auth
  });
});

export function startTilePruning(): void {
  const run = () => pruneTileCache().catch((err) => logger.warn({ err: String(err) }, "tile cache prune failed"));
  run();
  setInterval(run, 6 * 3600 * 1000).unref();
}
