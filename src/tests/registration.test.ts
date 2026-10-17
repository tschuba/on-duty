import { describe, it, expect, vi } from "vitest";

vi.mock("../db/index.js", () => ({ db: {} }));
const { registrationRejection } = await import("../lib/registration.js");
const { deleteBlock } = await import("../lib/account.js");

describe("registrationRejection", () => {
  it("rejects when registration is off", () => {
    expect(registrationRejection({ registrationEnabled: "false" }, true)).toBe("registration_disabled");
  });
  it("rejects unverified email even when registration is on", () => {
    expect(registrationRejection({ registrationEnabled: "true" }, false)).toBe("email_unverified");
  });
  it("accepts verified email when registration is on", () => {
    expect(registrationRejection({ registrationEnabled: "true" }, true)).toBeNull();
  });
});

describe("deleteBlock", () => {
  it("never allows deleting the local admin", () => {
    expect(deleteBlock("admin", 5, true)).toBe("localAdmin");
  });
  it("blocks the last admin account", () => {
    expect(deleteBlock("u1", 0, true)).toBe("lastAdmin");
  });
  it("allows an admin when others remain, and any non-admin", () => {
    expect(deleteBlock("u1", 1, true)).toBeNull();
    expect(deleteBlock("u2", 0, false)).toBeNull();
  });
});
