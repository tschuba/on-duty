import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import type { LogVariables } from "../middleware/request-log.js";

export const healthRoutes = new Hono<{ Variables: LogVariables }>();

// Unauthenticated, so no details in the response.
healthRoutes.get("/health", async (c) => {
  try {
    await db.execute(sql`select 1`);
    return c.text("ok");
  } catch (err) {
    c.get("log").error({ err }, "health check: DB nicht erreichbar");
    return c.text("unavailable", 503);
  }
});
