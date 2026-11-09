import { describe, it, expect, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import { ignoreRequest, otlpHeaders, sanitizeSql, pgRequestHook, startOtel, registerRuntimeMetrics } from "../lib/otel.js";

describe("otel", () => {
  it("does not start without endpoint", () => {
    expect(startOtel({})).toBeUndefined();
  });
  it("ignores assets and health only", () => {
    const r = (url: string) => ignoreRequest({ url } as IncomingMessage);
    expect(r("/css/app.css")).toBe(true);
    expect(r("/health")).toBe(true);
    expect(r("/members/1")).toBe(false);
    expect(r("/healthy-people")).toBe(false);
  });
  it("builds basic auth header; OTEL_EXPORTER_OTLP_HEADERS overrides", () => {
    expect(otlpHeaders({ OPENOBSERVE_USER: "u", OPENOBSERVE_PASSWORD: "p" })).toEqual({ Authorization: `Basic ${Buffer.from("u:p").toString("base64")}` });
    expect(otlpHeaders({ OPENOBSERVE_USER: "u", OPENOBSERVE_PASSWORD: "p", OTEL_EXPORTER_OTLP_HEADERS: "a=b" })).toBeUndefined();
    expect(otlpHeaders({})).toBeUndefined();
  });
  it("strips literals from SQL", () => {
    expect(sanitizeSql("select * from members where name = 'O''Brien' and id = 42")).toBe("select * from members where name = ? and id = ?");
  });
  it("sets operation/table and sanitized text on pg spans", () => {
    const setAttribute = vi.fn();
    pgRequestHook({ setAttribute } as never, { query: { text: 'select "id" from "members" where email = \'a@b.de\'' } });
    expect(setAttribute).toHaveBeenCalledWith("db.operation.name", "SELECT");
    expect(setAttribute).toHaveBeenCalledWith("db.collection.name", "members");
    expect(setAttribute).toHaveBeenCalledWith("db.query.text", expect.not.stringContaining("a@b.de"));
  });
  it("registers runtime gauges in seconds/bytes and resets event-loop delay after reading", async () => {
    const gauges: Record<string, ((r: { observe: (v: number) => void }) => void)[]> = {};
    let batch!: (r: { observe: (g: unknown, v: number) => void }) => void;
    const meter = {
      createObservableGauge: (name: string) => ({ name, addCallback: (cb: never) => (gauges[name] ??= []).push(cb) }),
      addBatchObservableCallback: (cb: typeof batch) => (batch = cb),
    };
    registerRuntimeMetrics(meter as never);
    await new Promise((r) => setTimeout(r, 50)); // let the sampler timer start
    const end = Date.now() + 150;
    while (Date.now() < end); // block the loop
    await new Promise((r) => setTimeout(r, 100));
    const read = () => {
      const o: Record<string, number> = {};
      batch({ observe: (g, v) => (o[(g as { name: string }).name] = v) });
      return o;
    };
    const first = read();
    for (const v of Object.values(first)) expect(Number.isFinite(v) && v >= 0).toBe(true);
    expect(first["nodejs.eventloop.delay.max"]).toBeGreaterThan(0.05);
    expect(first["nodejs.eventloop.delay.max"]).toBeLessThan(10); // seconds, not ns
    expect(read()["nodejs.eventloop.delay.max"]).toBeLessThanOrEqual(first["nodejs.eventloop.delay.max"]);
    for (const n of ["v8js.memory.heap.used", "v8js.memory.heap.limit", "process.memory.usage"]) {
      let v = -1;
      gauges[n][0]({ observe: (x) => (v = x) });
      expect(v).toBeGreaterThan(0);
    }
  });
});
