import { describe, it, expect } from "vitest";

process.env.BETTER_AUTH_SECRET = "test-secret";
process.env.OIDC_APP_URL = "http://localhost:3000";
process.env.ORG_NAME = "Test";

const { signLinkToken, verifyLinkToken } = await import("../lib/links.js");

describe("link tokens", () => {
  it("round-trips a valid token", () => {
    const p = verifyLinkToken(signLinkToken({ p: "event.rsvp-yes", m: "m1", e: "e1" }));
    expect(p).toMatchObject({ v: 1, p: "event.rsvp-yes", m: "m1", e: "e1" });
  });
  it("rejects tampered payload or signature", () => {
    const [body, sig] = signLinkToken({ p: "mail.optout", m: "m1", t: "events" }).split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, p: "mail.optout", m: "m2", t: "events" })).toString("base64url");
    expect(verifyLinkToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyLinkToken(`${body}.x${sig}`)).toBeNull();
    expect(verifyLinkToken("garbage")).toBeNull();
  });
  it("member.settings requires exp", () => {
    expect(verifyLinkToken(signLinkToken({ p: "member.settings", m: "m1" }))).toBeNull();
    expect(verifyLinkToken(signLinkToken({ p: "member.settings", m: "m1", exp: Date.now() + 1000 }))).not.toBeNull();
  });
  it("rejects unknown purpose and missing required fields", () => {
    expect(verifyLinkToken(signLinkToken({ p: "nope", m: "m1" }))).toBeNull();
    expect(verifyLinkToken(signLinkToken({ p: "event.rsvp-no", m: "m1" }))).toBeNull();
  });
});
