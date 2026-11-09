// Loaded via `node --import` BEFORE any instrumented module (pg, http). No-op without OTEL_EXPORTER_OTLP_ENDPOINT.
import { register } from "node:module";
// @ts-expect-error -- package ships register-hooks.d.ts but no "types" mapping for this subpath
import { register as registerSync, supportsSyncHooks } from "import-in-the-middle/register-hooks.mjs";
import type { IncomingMessage } from "node:http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { metrics, type Meter, type Span } from "@opentelemetry/api";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";

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

// Event-loop delay (seconds, reset per export interval) and heap size (bytes), named after OTel semconv.
export function registerRuntimeMetrics(meter: Meter): void {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const sec = (ns: number) => (Number.isFinite(ns) ? ns / 1e9 : 0);
  const p99 = meter.createObservableGauge("nodejs.eventloop.delay.p99", { unit: "s" });
  const max = meter.createObservableGauge("nodejs.eventloop.delay.max", { unit: "s" });
  const mean = meter.createObservableGauge("nodejs.eventloop.delay.mean", { unit: "s" });
  // batch callback: one read + reset serves all three gauges
  meter.addBatchObservableCallback((r) => {
    r.observe(p99, sec(histogram.percentile(99)));
    r.observe(max, sec(histogram.max));
    r.observe(mean, sec(histogram.mean));
    histogram.reset();
  }, [p99, max, mean]);
  meter
    .createObservableGauge("v8js.memory.heap.used", { unit: "By" })
    .addCallback((r) => r.observe(getHeapStatistics().used_heap_size));
  meter
    .createObservableGauge("v8js.memory.heap.limit", { unit: "By" })
    .addCallback((r) => r.observe(getHeapStatistics().heap_size_limit));
  meter.createObservableGauge("process.memory.usage", { unit: "By" }).addCallback((r) => r.observe(process.memoryUsage().rss));
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
  // ESM imports of node:http only get patched through the import-in-the-middle loader hook. The sync in-thread
  // variant limited to http does not clash with tsx's resolver in dev; the async fallback (older Node) intercepts all modules.
  if (supportsSyncHooks()) registerSync({ include: ["node:http", "http"] });
  else register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);
  sdk.start();
  registerRuntimeMetrics(metrics.getMeter("on-duty"));
  return sdk;
}

startOtel();
