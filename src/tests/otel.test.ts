import { describe, it, expect, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import { ignoreRequest, otlpHeaders, sanitizeSql, pgRequestHook, startOtel } from "../lib/otel.js";

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
});
