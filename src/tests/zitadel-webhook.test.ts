import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { appSettings, users } from "../db/schema/index.js";

const inserts: { table: unknown; values: any }[] = [];
let existing: unknown[] = [];
let acc: unknown[] = [];
let settings = [{ key: "registrationEnabled", value: "true" }];
const updates: any[] = [];
vi.mock("../db/index.js", () => {
  // The table passed to .from() decides which fixture a select returns.
  const select = (_cols?: unknown) => {
    let rows: unknown[] = [];
    const c: any = {
      from: (t: any) => { rows = t === appSettings ? settings : t === users ? existing : acc; return c; },
      where: () => c,
      then: (r: any, j: any) => Promise.resolve(rows).then(r, j),
    };
    return c;
  };
  const ins = (table: unknown) => ({ values: (values: any) => { inserts.push({ table, values }); return Promise.resolve(); } });
  return {
    db: {
      select,
      insert: ins,
      update: () => ({ set: (v: any) => ({ where: () => { updates.push(v); return Promise.resolve(); } }) }),
      transaction: async (fn: any) => fn({ insert: ins }),
    },
  };
});
vi.mock("../lib/registration.js", () => ({ onUserRegistered: vi.fn() }));
const { verifySignature, handleZitadelEvent } = await import("../lib/zitadel-webhook.js");

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

describe("handleZitadelEvent", () => {
  // Real payload captured from Zitadel v4.19.2: aggregateID = the new user, userID = the actor (login-client).
  const added = {
    aggregateID: "USER-NEW", aggregateType: "user", event_type: "user.human.added", userID: "ACTOR-LOGIN-CLIENT",
    event_payload: { email: "Neu@Example.com", displayName: "Neu Nutzer" },
  };
  it("binds the account to the affected user (aggregateID), not the acting service user", async () => {
    inserts.length = 0; existing = []; settings = [{ key: "registrationEnabled", value: "true" }];
    expect(await handleZitadelEvent(added)).toBe("created");
    const account = inserts.find((i) => i.values.providerId === "oidc")!.values;
    expect(account.accountId).toBe("USER-NEW");
    expect(inserts.find((i) => i.values.email)!.values).toMatchObject({ email: "neu@example.com", emailVerified: false });
  });
  it("ignores events when registration is off or the email already belongs to a user", async () => {
    inserts.length = 0; settings = [{ key: "registrationEnabled", value: "false" }];
    expect(await handleZitadelEvent(added)).toBe("ignored");
    settings = [{ key: "registrationEnabled", value: "true" }]; existing = [{ id: "u1" }];
    expect(await handleZitadelEvent(added)).toBe("ignored");
    expect(inserts).toHaveLength(0);
  });
  it("ignores events that are not about a user aggregate", async () => {
    expect(await handleZitadelEvent({ ...added, aggregateType: "org" })).toBe("ignored");
  });
});
