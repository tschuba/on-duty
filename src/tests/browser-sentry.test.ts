import { describe, it, expect, vi } from "vitest";

const init = vi.fn();
vi.mock("@sentry/browser", () => ({
  init,
  getDefaultIntegrations: () => ["GlobalHandlers", "BrowserSession", "Dedupe", "Breadcrumbs"].map((name) => ({ name })),
}));
vi.stubGlobal("__APP_VERSION__", "1.2.3");
vi.stubGlobal("location", { href: "https://a.de/members/42?x=1" });

await import("../browser/sentry.js");
const opts = init.mock.calls[0][0];

describe("browser sentry init", () => {
  it("tunnels, keeps only error integrations and drops breadcrumbs", () => {
    expect(opts.tunnel).toBe("/sentry-tunnel");
    expect(opts.release).toBe("1.2.3");
    expect(opts.defaultIntegrations.map((i: { name: string }) => i.name)).toEqual(["GlobalHandlers", "Dedupe"]);
    expect(opts.beforeBreadcrumb()).toBeNull();
  });

  it("beforeSend scrubs url, user and device", () => {
    const out = opts.beforeSend({ user: { id: "u" }, contexts: { device: {}, trace: {} }, request: { url: "https://a.de/m/7?q=1", headers: { a: "b" } } });
    expect(out.request).toEqual({ url: "https://a.de/m/:id" });
    expect(out.user).toBeUndefined();
    expect(out.contexts.device).toBeUndefined();
    expect(opts.beforeSend({}).request.url).toBe("https://a.de/members/:id");
  });
});
