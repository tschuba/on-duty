// One-shot (compose profile `observability`): imports the dashboard once. Idempotent: an existing dashboard with the
// same title is left alone, so edits made in the UI survive redeploys. Failing here must not block anything else.
import { readFileSync } from "node:fs";

const BASE = process.env.OPENOBSERVE_URL ?? "http://openobserve:5080";
const { OPENOBSERVE_USER: user, OPENOBSERVE_PASSWORD: pass } = process.env;
const FILE = process.argv[2] ?? "docs/observability/dashboard.json";
const headers = { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`, "Content-Type": "application/json" };

// The export blanks id/owner/created; OpenObserve rejects an empty `created`.
const dashboard = { ...JSON.parse(readFileSync(FILE, "utf8")), created: new Date().toISOString() };
const api = async (method, path, body) => {
  const res = await fetch(`${BASE}/api/default/dashboards${path}`, { method, headers, body: body && JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path || "/"} -> ${res.status} ${await res.text()}`);
  return res.json();
};

try {
  const { dashboards } = await api("GET", "");
  const exists = (dashboards ?? []).some((d) => (d.v5 ?? d).title === dashboard.title);
  if (exists) console.log(`[openobserve-init] dashboard "${dashboard.title}" exists — nothing to do.`);
  else {
    await api("POST", "", dashboard);
    console.log(`[openobserve-init] dashboard "${dashboard.title}" imported.`);
  }
} catch (e) {
  console.error("[openobserve-init] failed (import manually via Dashboards → Import):", e.message);
  process.exit(1);
}
