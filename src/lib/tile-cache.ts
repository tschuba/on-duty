import { mkdir, readFile, writeFile, readdir, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "./logger.js";

const DEFAULT_TTL_S = 24 * 3600;
const MAX_TTL_S = 30 * 24 * 3600;
const NEGATIVE_TTL_MS = 60_000;
const MAX_TILE_BYTES = 512 * 1024;
const MAX_CACHE_BYTES = 500 * 1024 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

export type Tile = { body: Buffer; freshFor: number };

export function validTile(z: string, x: string, y: string): { z: number; x: number; y: number } | null {
  if (![z, x, y].every((s) => /^\d{1,8}$/.test(s))) return null;
  const [Z, X, Y] = [Number(z), Number(x), Number(y)];
  if (Z > 19 || X >= 2 ** Z || Y >= 2 ** Z) return null;
  return { z: Z, x: X, y: Y };
}

const dir = () => process.env.TILE_CACHE_DIR || "./tile-cache";
const upstream = () => process.env.TILE_UPSTREAM_HOST || "tile.openstreetmap.org";

type Meta = { etag?: string; expires: number };
const inflight = new Map<string, Promise<Tile | null>>();
const failedUntil = new Map<string, number>();

/** Seconds the upstream allows caching, clamped to [0, 30 d]; 24 h if no usable header. */
export function ttlSeconds(cacheControl: string | null, expires: string | null, now = Date.now()): number {
  const m = /max-age=(\d+)/i.exec(cacheControl ?? "");
  let s = m ? Number(m[1]) : NaN;
  if (Number.isNaN(s) && expires) {
    const t = Date.parse(expires);
    if (!Number.isNaN(t)) s = Math.round((t - now) / 1000);
  }
  if (Number.isNaN(s)) s = DEFAULT_TTL_S;
  return Math.min(Math.max(s, 0), MAX_TTL_S);
}

async function readCached(base: string): Promise<{ body: Buffer; meta: Meta } | null> {
  try {
    const [body, meta] = await Promise.all([readFile(`${base}.png`), readFile(`${base}.json`, "utf8")]);
    return { body, meta: JSON.parse(meta) };
  } catch {
    return null;
  }
}

async function fetchTile(z: number, x: number, y: number): Promise<Tile | null> {
  const base = join(dir(), String(z), String(x), String(y));
  const key = `${z}/${x}/${y}`;
  const cached = await readCached(base);
  const now = Date.now();
  if (cached && cached.meta.expires > now) return { body: cached.body, freshFor: Math.floor((cached.meta.expires - now) / 1000) };
  if ((failedUntil.get(key) ?? 0) > now) return cached ? { body: cached.body, freshFor: 0 } : null;

  try {
    const res = await fetch(`https://${upstream()}/${z}/${x}/${y}.png`, {
      headers: {
        "user-agent": `on-duty (${process.env.OIDC_APP_URL ?? "unknown instance"})`,
        ...(cached?.meta.etag ? { "if-none-match": cached.meta.etag } : {}),
      },
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(5000),
    });
    let body: Buffer;
    if (res.status === 304 && cached) body = cached.body;
    else if (res.ok && res.headers.get("content-type")?.startsWith("image/png")) {
      body = Buffer.from(await res.arrayBuffer());
      if (body.length > MAX_TILE_BYTES || !PNG_MAGIC.every((b, i) => body[i] === b)) throw new Error("invalid tile body");
    } else throw new Error(`upstream status ${res.status}`);

    const ttl = ttlSeconds(res.headers.get("cache-control"), res.headers.get("expires"));
    await mkdir(join(dir(), String(z), String(x)), { recursive: true });
    const meta: Meta = { etag: res.headers.get("etag") ?? cached?.meta.etag, expires: Date.now() + ttl * 1000 };
    await Promise.all([writeFile(`${base}.png`, body), writeFile(`${base}.json`, JSON.stringify(meta))]);
    return { body, freshFor: ttl };
  } catch (err) {
    logger.warn({ err: String(err), z, x, y }, "tile fetch failed");
    failedUntil.set(key, now + NEGATIVE_TTL_MS);
    return null;
  }
}

/** Cached tile or upstream fetch; concurrent requests for one tile share a single fetch. */
export function getTile(z: number, x: number, y: number): Promise<Tile | null> {
  const key = `${z}/${x}/${y}`;
  let p = inflight.get(key);
  if (!p) {
    p = fetchTile(z, x, y).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** Deletes oldest tiles until the cache is under the size limit. */
export async function pruneTileCache(maxBytes = MAX_CACHE_BYTES): Promise<void> {
  const files: { path: string; size: number; mtime: number }[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else { const s = await stat(p); files.push({ path: p, size: s.size, mtime: s.mtimeMs }); }
    }
  };
  await walk(dir());
  let total = files.reduce((n, f) => n + f.size, 0);
  for (const f of files.sort((a, b) => a.mtime - b.mtime)) {
    if (total <= maxBytes) break;
    await rm(f.path, { force: true });
    total -= f.size;
  }
}
