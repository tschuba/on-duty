import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";

vi.mock("../db/index.js", () => ({ db: { execute: vi.fn() } }));

import { db } from "../db/index.js";
import { createLogger } from "../lib/logger.js";
import { requestLog, type LogVariables } from "../middleware/request-log.js";
import { healthRoutes } from "../routes/health.js";

function capture() {
  const lines: string[] = [];
  const log = createLogger({ write: (s: string) => void lines.push(s) });
  return { lines, log };
}

describe("request log", () => {
  it("sets X-Request-Id and logs it", async () => {
    const { lines, log } = capture();
    const app = new Hono<{ Variables: LogVariables }>();
    app.use("*", requestLog(log));
    app.get("/x", (c) => c.text("hi"));
    const res = await app.request("/x?secret=1", { headers: { "x-request-id": "abc-123" } });
    expect(res.headers.get("X-Request-Id")).toBe("abc-123");
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({ requestId: "abc-123", path: "/x", status: 200 });
    expect(lines[0]).not.toContain("secret");
  });

  it("generates an ID when the header is missing or unsafe", async () => {
    const { log } = capture();
    const app = new Hono<{ Variables: LogVariables }>();
    app.use("*", requestLog(log));
    app.get("/x", (c) => c.text("hi"));
    const res = await app.request("/x", { headers: { "x-request-id": "bad id" } });
    expect(res.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("redaction", () => {
  it("removes sensitive fields", () => {
    const { lines, log } = capture();
    log.info({ email: "a@b.de", iban: "DE00", authorization: "Bearer x", user: { email: "c@d.de" } }, "m");
    expect(lines[0]).not.toMatch(/a@b\.de|DE00|Bearer|c@d\.de/);
  });

  it("respects LOG_LEVEL", () => {
    vi.stubEnv("LOG_LEVEL", "warn");
    const { lines, log } = capture();
    log.info("hidden");
    log.warn("shown");
    vi.unstubAllEnvs();
    expect(lines).toHaveLength(1);
  });
});

describe("/health", () => {
  const app = new Hono<{ Variables: LogVariables }>();
  app.use("*", requestLog(createLogger({ write: () => {} })));
  app.route("/", healthRoutes);

  it("200 when DB reachable", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([] as never);
    expect((await app.request("/health")).status).toBe(200);
  });

  it("503 without details when DB fails", async () => {
    vi.mocked(db.execute).mockRejectedValueOnce(new Error("secret host"));
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("secret");
  });
});
