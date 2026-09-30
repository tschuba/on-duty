import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, recordFailedAttempt, resetRateLimit } from "../lib/ratelimit.js";

describe("checkRateLimit / recordFailedAttempt", () => {
  beforeEach(() => resetRateLimit("1.2.3.4"));

  it("allows attempts below the lockout threshold", () => {
    for (let i = 0; i < 4; i++) recordFailedAttempt("1.2.3.4");
    expect(checkRateLimit("1.2.3.4").allowed).toBe(true);
  });

  it("locks out after 5 recorded attempts", () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt("1.2.3.4");
    expect(checkRateLimit("1.2.3.4").allowed).toBe(false);
  });

  it("keeps other IPs unaffected", () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt("1.2.3.4");
    expect(checkRateLimit("5.6.7.8").allowed).toBe(true);
  });

  it("resetRateLimit clears the lockout", () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt("1.2.3.4");
    resetRateLimit("1.2.3.4");
    expect(checkRateLimit("1.2.3.4").allowed).toBe(true);
  });
});
