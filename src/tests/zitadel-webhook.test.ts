import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("../db/index.js", () => ({ db: {} }));
const { verifySignature } = await import("../lib/zitadel-webhook.js");

const sign = (body: string, key: string, t: number) =>
  `t=${t},v1=${createHmac("sha256", key).update(`${t}.${body}`).digest("hex")}`;

describe("verifySignature", () => {
  const now = 1_700_000_000;
  const body = '{"event_type":"user.human.selfregistered"}';
  it("accepts a valid signature", () => expect(verifySignature(body, sign(body, "k", now), "k", now)).toBe(true));
  it("rejects a wrong key, tampered body, missing header", () => {
    expect(verifySignature(body, sign(body, "x", now), "k", now)).toBe(false);
    expect(verifySignature(body + " ", sign(body, "k", now), "k", now)).toBe(false);
    expect(verifySignature(body, undefined, "k", now)).toBe(false);
  });
  it("rejects timestamps outside the 300s tolerance", () => {
    expect(verifySignature(body, sign(body, "k", now - 301), "k", now)).toBe(false);
    expect(verifySignature(body, sign(body, "k", now - 299), "k", now)).toBe(true);
  });
  it("rejects malformed headers", () => {
    expect(verifySignature(body, "garbage", "k", now)).toBe(false);
    expect(verifySignature(body, `t=${now}`, "k", now)).toBe(false);
  });
});
