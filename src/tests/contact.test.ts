import { describe, it, expect } from "vitest";
import { isValidEmail, isValidPhone, normalizePhone } from "../lib/contact.js";

describe("contact", () => {
  it("validates email", () => {
    expect(isValidEmail("a@b.de")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a b@c.de")).toBe(false);
  });
  it("normalizes and validates phone", () => {
    expect(normalizePhone("+49 (9281) 12-34/5")).toBe("+49928112345");
    expect(isValidPhone("+49 9281 12345")).toBe(true);
    expect(isValidPhone("12345")).toBe(false);
    expect(isValidPhone("abc123456")).toBe(false);
    expect(isValidPhone("1234567890123456")).toBe(false);
  });
});
