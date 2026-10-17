import { describe, it, expect, vi, beforeEach } from "vitest";

// Generic thenable chain: every select resolves to the next queued result.
const results: unknown[] = [];
const calls: { op: string; arg?: unknown }[] = [];
vi.mock("../db/index.js", () => {
  const chain = (op: string): any => {
    const c: any = new Proxy(() => {}, {
      get: (_t, p) => {
        if (p === "then") return (r: any, j: any) => Promise.resolve(results.shift() ?? []).then(r, j);
        return (...args: unknown[]) => {
          if (p === "values" || p === "set") calls.push({ op: `${op}.${String(p)}`, arg: args[0] });
          return c;
        };
      },
    });
    return c;
  };
  return { db: { select: () => chain("select"), selectDistinct: () => chain("select"), insert: () => chain("insert"), delete: () => chain("delete") } };
});
const sendMail = vi.fn();
vi.mock("../lib/mail.js", () => ({ sendMail: (...a: unknown[]) => sendMail(...a) }));

import { deleteBlock, deleteOwnAccount, countOtherAdmins } from "../lib/account.js";
import { onUserRegistered, countPendingUsers } from "../lib/registration.js";
import { checkRole, clearDefaultRoleIfDeleted, setSetting, roleHasPermissions } from "../lib/settings.js";
import { LOCAL_ADMIN_ACCOUNT_ID } from "../lib/constants.js";

beforeEach(() => {
  results.length = 0;
  calls.length = 0;
  sendMail.mockReset();
});

describe("account", () => {
  it("deleteBlock", () => {
    expect(deleteBlock(LOCAL_ADMIN_ACCOUNT_ID, 5, false)).toBe("localAdmin");
    expect(deleteBlock("u", 0, true)).toBe("lastAdmin");
    expect(deleteBlock("u", 1, true)).toBeNull();
    expect(deleteBlock("u", 0, false)).toBeNull();
  });
  it("countOtherAdmins counts rows", async () => {
    results.push([{ id: "a" }, { id: "b" }]);
    expect(await countOtherAdmins("u")).toBe(2);
  });
  it("deleteOwnAccount blocks last admin, deletes otherwise", async () => {
    results.push([]);
    expect(await deleteOwnAccount("u", true)).toBe("lastAdmin");
    results.push([{ id: "a" }]);
    expect(await deleteOwnAccount("u", true)).toBeNull();
    expect(await deleteOwnAccount("u", false)).toBeNull();
  });
});

describe("registration", () => {
  it("auto-approve grants the default role", async () => {
    results.push([
      { key: "registrationAutoApprove", value: "true" },
      { key: "registrationDefaultRoleId", value: "r1" },
    ]);
    await onUserRegistered({ id: "u", name: "N", email: "n@x.de" });
    expect(calls).toContainEqual({ op: "insert.values", arg: { userId: "u", roleId: "r1" } });
    expect(sendMail).not.toHaveBeenCalled();
  });
  it("otherwise mails admins, skipping .invalid", async () => {
    results.push([], [{ email: "a@x.de" }, { email: "local@admin.invalid" }]);
    await onUserRegistered({ id: "u", name: "N", email: "n@x.de" });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toBe("a@x.de");
  });
  it("countPendingUsers", async () => {
    results.push([{ email: "a@x.de", disabled: false, emailVerified: true, lastLoginAt: new Date(), roleId: null }]);
    expect(typeof (await countPendingUsers())).toBe("number");
  });
});

describe("settings", () => {
  it("roleHasPermissions", async () => {
    results.push([{ cnt: 2 }]);
    expect(await roleHasPermissions("r")).toBe(true);
  });
  it("checkRole", async () => {
    results.push([]);
    expect(await checkRole("r")).toBe("unknownRole");
    results.push([{ id: "r" }], [{ cnt: 0 }]);
    expect(await checkRole("r")).toBe("roleWithoutPermissions");
    results.push([{ id: "r" }], [{ cnt: 1 }]);
    expect(await checkRole("r")).toBe("ok");
  });
  it("setSetting upserts", async () => {
    await setSetting("registrationEnabled", "true");
    expect(calls[0].arg).toEqual({ key: "registrationEnabled", value: "true" });
  });
  it("clearDefaultRoleIfDeleted resets only for the matching role", async () => {
    results.push([{ key: "registrationDefaultRoleId", value: "other" }]);
    await clearDefaultRoleIfDeleted("r1");
    expect(calls).toHaveLength(0);
    results.push([{ key: "registrationDefaultRoleId", value: "r1" }]);
    await clearDefaultRoleIfDeleted("r1");
    expect(calls).toHaveLength(2);
  });
});
