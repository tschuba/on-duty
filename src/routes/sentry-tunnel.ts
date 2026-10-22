import { Hono } from "hono";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { readDsn } from "../lib/sentry.js";

// Muss zu PLACEHOLDER_DSN in src/browser/sentry.ts passen; die echte DSN verlässt den Server nie.
const CLIENT_DSN = "https://public@tunnel.invalid/1";
const MAX_BYTES = 100 * 1024;
const MAX_PER_MINUTE = 20;

// shortcut: In-Memory pro Prozess, bei mehreren Instanzen pro Instanz gezählt.
const hits = new Map<string, number[]>();
export function tunnelRateLimited(userId: string, now = Date.now()): boolean {
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(userId, recent);
  return recent.length > MAX_PER_MINUTE;
}

export const sentryTunnelRoutes = new Hono<{ Variables: Variables }>();

sentryTunnelRoutes.post("/sentry-tunnel", requireAuth(undefined, { allowPending: true }), async (c) => {
  const dsn = readDsn();
  if (!dsn) return c.body(null, 404);
  if (tunnelRateLimited(c.get("user").id)) return c.body(null, 429);

  const body = await c.req.text();
  if (Buffer.byteLength(body) > MAX_BYTES) return c.body(null, 413);

  // Envelope: erste Zeile = JSON-Header, danach Items.
  const nl = body.indexOf("\n");
  if (nl < 1) return c.body(null, 400);
  let header: { dsn?: string };
  try {
    header = JSON.parse(body.slice(0, nl));
  } catch {
    return c.body(null, 400);
  }
  if (header.dsn !== CLIENT_DSN) return c.body(null, 400);

  const u = new URL(dsn);
  const projectId = u.pathname.replace(/^\/|\/$/g, "");
  const forwarded = JSON.stringify({ ...header, dsn }) + body.slice(nl);
  try {
    const res = await fetch(`${u.protocol}//${u.host}/api/${projectId}/envelope/`, {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope", "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${u.username}` },
      body: forwarded,
      signal: AbortSignal.timeout(5000),
    });
    return c.body(null, res.ok ? 200 : 502);
  } catch {
    return c.body(null, 502);
  }
});
