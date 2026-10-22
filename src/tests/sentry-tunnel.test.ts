import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let authed = true;
vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => async (c: any, next: any) => {
    if (!authed) return c.redirect("/login");
    c.set("user", { id: `u${Math.random()}`, permissions: new Set(), disabled: false });
    await next();
  },
}));

const { sentryTunnelRoutes, tunnelRateLimited } = await import("../routes/sentry-tunnel.js");
const { scrubUrl } = await import("../browser/scrub-url.js");

const CLIENT = "https://public@tunnel.invalid/1";
const envelope = (dsn = CLIENT) => `${JSON.stringify({ dsn })}\n{"type":"event"}\n{"message":"x"}`;
const post = (body: string) => sentryTunnelRoutes.request("/sentry-tunnel", { method: "POST", body });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  authed = true;
  process.env.SENTRY_DSN = "https://secretkey@bugs.example/42";
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  delete process.env.SENTRY_DSN;
  vi.unstubAllGlobals();
});

describe("sentry tunnel", () => {
  it("redirects when not logged in", async () => {
    authed = false;
    expect((await post(envelope())).status).toBe(302);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies", async () => {
    expect((await post(envelope() + "x".repeat(101 * 1024))).status).toBe(413);
  });

  it("rejects a foreign DSN and malformed envelopes", async () => {
    expect((await post(envelope("https://k@evil.example/1"))).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a valid envelope to the fixed server DSN", async () => {
    expect((await post(envelope())).status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://bugs.example/api/42/envelope/");
    expect(init.body.split("\n")[0]).toContain("https://secretkey@bugs.example/42");
  });

  it("rate-limits per user", () => {
    const results = Array.from({ length: 21 }, () => tunnelRateLimited("same", 1000));
    expect(results.slice(0, 20).every((r) => !r)).toBe(true);
    expect(results[20]).toBe(true);
  });

  it("scrubs ids and query from URLs", () => {
    expect(scrubUrl("https://a.de/members/123/edit?x=1#h")).toBe("https://a.de/members/:id/edit");
    expect(scrubUrl("https://a.de/members/3f2b8c1e-1111-4222-8333-444455556666")).toBe("https://a.de/members/:id");
  });
});
