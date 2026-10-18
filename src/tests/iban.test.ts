import { describe, it, expect } from "vitest";
import { normalizeIban, isValidIban, formatIban } from "../lib/iban.js";

describe("iban", () => {
  it("normalizes whitespace and case", () => {
    expect(normalizeIban(" de89 3704 0044 0532 0130 00 ")).toBe("DE89370400440532013000");
  });
  it("accepts valid IBANs", () => {
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("gb82west12345698765432")).toBe(true);
  });
  it("rejects bad checksum, format and empty", () => {
    expect(isValidIban("DE89 3704 0044 0532 0130 01")).toBe(false);
    expect(isValidIban("1234")).toBe(false);
    expect(isValidIban("")).toBe(false);
  });
  it("groups in blocks of four", () => {
    expect(formatIban("de89370400440532013000")).toBe("DE89 3704 0044 0532 0130 00");
  });
});
