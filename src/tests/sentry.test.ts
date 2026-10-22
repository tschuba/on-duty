import { describe, it, expect, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { initSentry, captureServerError, closeSentry } from "../lib/sentry.js";

function setup() {
  const envelopes: string[] = [];
  const transport = () => ({
    send: async (env: unknown) => {
      envelopes.push(JSON.stringify(env));
      return {};
    },
    flush: async () => true,
  });
  return { envelopes, transport: transport as never };
}

afterEach(async () => {
  await closeSentry();
  delete process.env.SENTRY_DSN;
  delete process.env.SENTRY_DSN_FILE;
  vi.restoreAllMocks();
});

describe("sentry", () => {
  it("stays off without DSN", () => {
    const on = vi.spyOn(process, "on");
    const { envelopes, transport } = setup();
    expect(initSentry({ transport })).toBe(false);
    captureServerError(new Error("x"), {});
    expect(envelopes).toHaveLength(0);
    expect(on).not.toHaveBeenCalled();
  });

  it("sends only allowlisted data for 5xx errors, not for 4xx", async () => {
    process.env.SENTRY_DSN = "https://key@sentry.example/1";
    vi.spyOn(process, "on").mockImplementation(() => process);
    const { envelopes, transport } = setup();
    expect(initSentry({ transport })).toBe(true);

    const app = new Hono();
    app.onError((err, c) => {
      if (!(err instanceof HTTPException && err.status < 500)) {
        captureServerError(err, { requestId: "req-1", userId: "u-1", route: c.req.routePath });
      }
      return c.text("err", 500);
    });
    app.post("/members/:id", () => {
      throw new Error("boom");
    });
    app.get("/forbidden", () => {
      throw new HTTPException(403);
    });

    await app.request("/forbidden");
    await app.request("/members/42?email=a@b.de", {
      method: "POST",
      body: "iban=DE123",
      headers: { cookie: "session=s3cret", "x-forwarded-for": "1.2.3.4" },
    });
    await closeSentry();

    expect(envelopes).toHaveLength(1);
    const e = envelopes[0];
    expect(e).toContain("boom");
    expect(e).toContain("u-1");
    expect(e).toContain("req-1");
    expect(e).toContain("/members/:id");
    expect(e).toMatch(/"release"/);
    for (const leak of ["DE123", "a@b.de", "s3cret", "1.2.3.4", "ip_address"]) expect(e).not.toContain(leak);
  });
});
