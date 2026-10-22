import { scrubUrl } from "./scrub-url.js";
import { init, getDefaultIntegrations } from "@sentry/browser";

// Der Server (/sentry-tunnel) ersetzt diesen Platzhalter durch die echte DSN.
export const PLACEHOLDER_DSN = "https://public@tunnel.invalid/1";

// Nur Fehler-Erfassung: kein Breadcrumb-/Replay-/Tracing-Kontext, keine Browser-Metadaten (PII).
const keep = new Set(["GlobalHandlers", "FunctionToString", "InboundFilters", "Dedupe"]);

declare const __APP_VERSION__: string;

init({
  release: __APP_VERSION__,
  environment: "production",
  dsn: PLACEHOLDER_DSN,
  tunnel: "/sentry-tunnel",
  defaultIntegrations: getDefaultIntegrations({}).filter((i) => keep.has(i.name)),
  beforeBreadcrumb: () => null,
  beforeSend(event) {
    const url = event.request?.url ?? location.href;
    event.request = { url: scrubUrl(url) };
    delete event.user;
    delete event.contexts?.device;
    return event;
  },
});
