// Loaded via `node --import` BEFORE any instrumented module (pg, http). No-op without OTEL_EXPORTER_OTLP_ENDPOINT.
import { register } from "node:module";
import type { IncomingMessage } from "node:http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import type { Span } from "@opentelemetry/api";

const ASSET = /^\/(css|fonts|js)\/|^\/(health|favicon\.svg|apple-touch-icon\.png|manifest\.webmanifest|offline\.html|icon-[\w-]+\.png)(\?|$)/;

// true = do not trace (assets, health check)
export function ignoreRequest(req: IncomingMessage): boolean {
  return ASSET.test(req.url ?? "");
}

// Explicit OTEL_EXPORTER_OTLP_HEADERS wins; otherwise Basic auth from OpenObserve credentials.
export function otlpHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> | undefined {
  if (env.OTEL_EXPORTER_OTLP_HEADERS) return undefined; // exporters read the env var themselves
  const { OPENOBSERVE_USER: user, OPENOBSERVE_PASSWORD: pass } = env;
  if (!user || !pass) return undefined;
  return { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` };
}

// db.query.text arrives in clear text: keep statement kind + table, drop all literals/parameters.
export function sanitizeSql(text: string): string {
  const stripped = text.replace(/'(?:[^']|'')*'/g, "?").replace(/\b\d+(?:\.\d+)?\b/g, "?").replace(/\s+/g, " ").trim();
  return stripped.length > 120 ? `${stripped.slice(0, 120)}…` : stripped;
}

export function pgRequestHook(span: Span, { query }: { query: { text: string } }): void {
  const text = query.text ?? "";
  const op = /^\s*(\w+)/.exec(text)?.[1]?.toUpperCase();
  const table = /\b(?:from|into|update|join)\s+"?(\w+)"?/i.exec(text)?.[1];
  if (op) span.setAttribute("db.operation.name", op);
  if (table) span.setAttribute("db.collection.name", table);
  span.setAttribute("db.query.text", sanitizeSql(text));
}

export function startOtel(env: NodeJS.ProcessEnv = process.env): NodeSDK | undefined {
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) return undefined;
  env.OTEL_SERVICE_NAME ??= "on-duty";
  env.OTEL_TRACES_SAMPLER ??= "parentbased_traceidratio";
  env.OTEL_TRACES_SAMPLER_ARG ??= "1";
  const headers = otlpHeaders(env);
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ headers }),
    metricReaders: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter({ headers }) })],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: ignoreRequest,
        // outgoing calls (OIDC, SMTP-free) are not needed; keeps span volume low
        ignoreOutgoingRequestHook: () => true,
      }),
      // requireParentSpan: migration/seed at startup and ignored requests produce no DB spans
      new PgInstrumentation({ requireParentSpan: true, ignoreConnectSpans: true, requestHook: pgRequestHook }),
    ],
  });
  // ESM imports of node:http only get patched through the import-in-the-middle loader hook
  register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);
  sdk.start();
  return sdk;
}

startOtel();
