import { describe, it, expect, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { initSentry, captureServerError, closeSentry, isDbUnavailable, isAuthSessionError } from "../lib/sentry.js";

// Envelope shape: [header, [[itemHeader, event]]].
function eventOf(envelope: string) {
  return JSON.parse(envelope)[1][0][1];
}

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

  it("regroups and retitles db outages, tagged via ctx.dbDown", async () => {
    process.env.SENTRY_DSN = "https://key@sentry.example/1";
    vi.spyOn(process, "on").mockImplementation(() => process);
    const { envelopes, transport } = setup();
    initSentry({ transport });

    captureServerError(new Error("Failed to get session"), { dbDown: true, requestId: "req-2" });
    await closeSentry();

    expect(envelopes).toHaveLength(1);
    const event = eventOf(envelopes[0]);
    expect(event.fingerprint).toEqual(["db_unavailable"]);
    expect(event.tags.error_kind).toBe("db_unavailable");
    expect(event.exception.values[0].value).toBe("Database unavailable (Failed to get session)");
  });

  it("regroups db outages detected via the pg error code in the cause chain", async () => {
    process.env.SENTRY_DSN = "https://key@sentry.example/1";
    vi.spyOn(process, "on").mockImplementation(() => process);
    const { envelopes, transport } = setup();
    initSentry({ transport });

    const pgError = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    captureServerError(new Error("wrapped", { cause: pgError }), {});
    await closeSentry();

    expect(eventOf(envelopes[0]).tags.error_kind).toBe("db_unavailable");
  });

  it("leaves unrelated errors ungrouped", async () => {
    process.env.SENTRY_DSN = "https://key@sentry.example/1";
    vi.spyOn(process, "on").mockImplementation(() => process);
    const { envelopes, transport } = setup();
    initSentry({ transport });

    captureServerError(new Error("boom"), { dbDown: false });
    await closeSentry();

    const event = eventOf(envelopes[0]);
    expect(event.tags.error_kind).toBeUndefined();
    expect(event.exception.values[0].value).toBe("boom");
  });
});

describe("isDbUnavailable", () => {
  it.each(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "57P01", "57P03", "08006"])(
    "detects %s on the error itself",
    (code) => {
      expect(isDbUnavailable(Object.assign(new Error("x"), { code }))).toBe(true);
    }
  );

  it("walks the cause chain", () => {
    const inner = Object.assign(new Error("x"), { code: "57P01" });
    expect(isDbUnavailable(new Error("outer", { cause: new Error("mid", { cause: inner }) }))).toBe(true);
  });

  it("walks aggregate errors via .errors[0]", () => {
    const inner = Object.assign(new Error("x"), { code: "ECONNREFUSED" });
    expect(isDbUnavailable({ errors: [inner] })).toBe(true);
  });

  it("returns false for unrelated errors and non-matching codes", () => {
    expect(isDbUnavailable(new Error("boom"))).toBe(false);
    expect(isDbUnavailable(Object.assign(new Error("x"), { code: "42P01" }))).toBe(false);
    expect(isDbUnavailable(null)).toBe(false);
  });
});

describe("isAuthSessionError", () => {
  it("detects Better Auth's FAILED_TO_GET_SESSION", () => {
    expect(isAuthSessionError({ body: { code: "FAILED_TO_GET_SESSION" } })).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isAuthSessionError(new Error("boom"))).toBe(false);
    expect(isAuthSessionError({ body: { code: "OTHER" } })).toBe(false);
    expect(isAuthSessionError(null)).toBe(false);
  });
});
