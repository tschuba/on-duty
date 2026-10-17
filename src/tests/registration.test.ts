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

const { isPendingUser } = await import("../lib/registration.js");
describe("isPendingUser", () => {
  const base = { email: "a@b.de", disabled: false, emailVerified: true, lastLoginAt: new Date() as Date | null };
  it("is pending with a login but no role", () => expect(isPendingUser(base, false)).toBe(true));
  it("is pending with unverified email and no role, even before any login", () =>
    expect(isPendingUser({ ...base, emailVerified: false, lastLoginAt: null }, false)).toBe(true));
  it("is not pending with a role", () => expect(isPendingUser(base, true)).toBe(false));
  it("keeps admin-created never-logged-in users as unconfirmed, not pending", () =>
    expect(isPendingUser({ ...base, lastLoginAt: null }, false)).toBe(false));
  it("ignores disabled users and the local admin", () => {
    expect(isPendingUser({ ...base, disabled: true }, false)).toBe(false);
    expect(isPendingUser({ ...base, email: "admin@localhost.invalid" }, false)).toBe(false);
  });
});
