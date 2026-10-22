import { readFileSync } from "node:fs";
import * as Sentry from "@sentry/node";
import type { ErrorEvent } from "@sentry/node";
import { logger } from "./logger.js";

let enabled = false;

function readDsn(): string | undefined {
  const direct = process.env.SENTRY_DSN?.trim();
  if (direct) return direct;
  const file = process.env.SENTRY_DSN_FILE;
  if (!file) return undefined;
  try {
    return readFileSync(file, "utf8").trim() || undefined;
  } catch {
    return undefined; // missing file = off
  }
}

function appVersion(): string | undefined {
  try {
    return JSON.parse(readFileSync("package.json", "utf8")).version;
  } catch {
    return undefined;
  }
}

// Allowlist: member data is sensitive, so build the event anew instead of stripping fields.
export function sanitizeEvent(event: ErrorEvent): ErrorEvent {
  const { event_id, timestamp, platform, level, exception, release, environment, sdk } = event;
  const out: ErrorEvent = { type: undefined, event_id, timestamp, platform, level, exception, release, environment, sdk };
  const tags: Record<string, string> = {};
  for (const k of ["request_id", "route"]) {
    const v = event.tags?.[k];
    if (typeof v === "string") tags[k] = v;
  }
  out.tags = tags;
  if (event.user?.id) out.user = { id: String(event.user.id) };
  return out;
}

export function initSentry(opts: { transport?: Sentry.NodeOptions["transport"] } = {}): boolean {
  const dsn = readDsn();
  if (!dsn) return false;
  Sentry.init({
    dsn,
    release: appVersion(),
    environment: process.env.NODE_ENV ?? "production",
    tracesSampleRate: 0,
    defaultIntegrations: false,
    skipOpenTelemetrySetup: true,
    beforeBreadcrumb: () => null,
    beforeSend: sanitizeEvent,
    transport: opts.transport,
  });
  enabled = true;

  const fatal = (kind: string) => (err: unknown) => {
    logger.fatal({ err }, kind);
    Sentry.captureException(err);
    Sentry.flush(2000).finally(() => process.exit(1));
  };
  process.on("uncaughtException", fatal("uncaughtException"));
  process.on("unhandledRejection", fatal("unhandledRejection"));
  return true;
}

export function captureServerError(err: unknown, ctx: { requestId?: string; userId?: string; route?: string }): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (ctx.requestId) scope.setTag("request_id", ctx.requestId);
    if (ctx.route) scope.setTag("route", ctx.route);
    if (ctx.userId) scope.setUser({ id: ctx.userId });
    Sentry.captureException(err);
  });
}

export async function closeSentry(): Promise<void> {
  if (enabled) {
    await Sentry.close(2000);
    enabled = false;
  }
}
