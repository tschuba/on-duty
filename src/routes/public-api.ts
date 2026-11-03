import { Hono } from "hono";
import { and, asc, gte } from "drizzle-orm";
import { db } from "../db/index.js";
import { events } from "../db/schema/index.js";
import { env } from "../env.js";
import { visibilityCondition } from "../lib/events.js";
import { deriveMemberStatus } from "../lib/status.js";
type Args = Parameters<typeof deriveMemberStatus>;

const MAX_PER_MINUTE = 60;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// shortcut: in-memory per process, counted per instance when running several; upgrade to a shared store then.
const hits = new Map<string, number[]>();
export function publicApiRateLimited(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_MINUTE;
}

export const publicApiRoutes = new Hono();

// Unauthenticated, aggregates and public events only; no personal data.
publicApiRoutes.use("*", async (c, next) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (publicApiRateLimited(ip)) return c.json({ error: "rate_limited" }, 429);
  await next();
  if (c.res.ok) c.header("Cache-Control", "public, max-age=300");
});

publicApiRoutes.get("/stats", async (c) => {
  const rows = await db.query.members.findMany({ with: { person: true, assignments: { with: { role: true } } } });
  const members = { active: 0, youth: 0, children: 0, supporting: 0 };
  for (const { person, ...m } of rows) {
    const member = { ...person, ...m } as unknown as Args[0];
    const status = deriveMemberStatus(member, m.assignments as unknown as Args[1], env.CHILDREN_AGE_LIMIT, env.YOUTH_AGE_LIMIT, env.ACTIVE_AGE_LIMIT);
    if (status === "active" || status === "youth" || status === "children" || status === "supporting") members[status]++;
  }
  return c.json({ members });
});

publicApiRoutes.get("/events", async (c) => {
  const raw = c.req.query("limit");
  const limit = raw === undefined ? DEFAULT_LIMIT : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return c.json({ error: "invalid_limit" }, 400);
  const rows = await db
    .select({ id: events.id, title: events.title, startsAt: events.startsAt, endsAt: events.endsAt, allDay: events.allDay, location: events.location, description: events.description })
    .from(events)
    .where(and(visibilityCondition(undefined), gte(events.endsAt, new Date())))
    .orderBy(asc(events.startsAt))
    .limit(limit);
  // Date → ISO-8601 (UTC "Z") via JSON serialization.
  return c.json({ events: rows });
});

publicApiRoutes.all("*", (c) => c.json({ error: "not_found" }, 404));
