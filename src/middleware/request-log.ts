import { randomUUID } from "node:crypto";
import { createMiddleware } from "hono/factory";
import type { Logger } from "pino";
import { logger } from "../lib/logger.js";

export type LogVariables = { requestId: string; log: Logger };

// Accept proxy-supplied IDs only if they look harmless (they end up in logs and the 500 page).
const SAFE_ID = /^[\w.-]{1,64}$/;

export function requestLog(base: Logger = logger) {
  return createMiddleware<{ Variables: LogVariables }>(async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
    const log = base.child({ requestId });
    c.set("requestId", requestId);
    c.set("log", log);
    c.header("X-Request-Id", requestId);
    const start = Date.now();
    await next();
    // user is set by requireAuth on routes that need it; absent on public routes
    const userId = (c.get as (k: string) => { id?: string } | undefined)("user")?.id;
    log.info({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - start, userId }, "request");
  });
}
