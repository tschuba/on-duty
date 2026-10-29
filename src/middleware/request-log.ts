import { randomUUID } from "node:crypto";
import { createMiddleware } from "hono/factory";
import type { Logger } from "pino";
import { trace } from "@opentelemetry/api";
import { routePath } from "hono/route";
import { logger } from "../lib/logger.js";
import { userPseudonym } from "../lib/user-pseudonym.js";

export type LogVariables = { requestId: string; log: Logger };

// Accept proxy-supplied IDs only if they look harmless (they end up in logs and the 500 page).
const SAFE_ID = /^[\w.-]{1,64}$/;

export function requestLog(base: Logger = logger) {
  return createMiddleware<{ Variables: LogVariables }>(async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
    const span = trace.getActiveSpan();
    // Assets/health are not traced (see lib/otel.ts), so no active span there
    const traceId = span?.spanContext().traceId;
    const log = base.child(traceId ? { requestId, traceId } : { requestId });
    span?.setAttribute("request_id", requestId);
    c.set("requestId", requestId);
    c.set("log", log);
    c.header("X-Request-Id", requestId);
    const start = Date.now();
    await next();
    // user is set by requireAuth on routes that need it; absent on public routes
    const userId = (c.get as (k: string) => { id?: string } | undefined)("user")?.id;
    if (span && userId) span.setAttribute("user_id", userPseudonym(userId));
    span?.setAttribute("http.route", routePath(c));
    log.info({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - start, userId }, "request");
  });
}
