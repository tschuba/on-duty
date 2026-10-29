import { describe, it, expect } from "vitest";

process.env.BETTER_AUTH_SECRET = "test-secret";
const { userPseudonym } = await import("../lib/user-pseudonym.js");

describe("userPseudonym", () => {
  it("is stable for the same id", () => {
    expect(userPseudonym("user-1")).toBe(userPseudonym("user-1"));
  });
  it("differs for different ids", () => {
    expect(userPseudonym("user-1")).not.toBe(userPseudonym("user-2"));
  });
  it("is 16 hex chars without the plain id", () => {
    const p = userPseudonym("abcdef0123456789");
    expect(p).toMatch(/^[0-9a-f]{16}$/);
    expect(p).not.toContain("abcdef0123456789");
  });
});
