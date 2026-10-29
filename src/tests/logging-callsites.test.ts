import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { logger } from "../lib/logger.js";
import { validateEnv } from "../env.js";
import { sendMail } from "../lib/mail.js";

const BASE = {
  DATABASE_URL: "x", ORG_NAME: "x", ADMIN_PASSWORD: "a-long-enough-password", BETTER_AUTH_SECRET: "x",
  OIDC_PROVIDER: "x", OIDC_CLIENT_ID: "x", OIDC_CLIENT_SECRET: "x", OIDC_APP_URL: "x",
};

describe("validateEnv logging", () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(BASE)) vi.stubEnv(k, v);
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("logs fatal and exits on missing vars", () => {
    vi.stubEnv("DATABASE_URL", "");
    const fatal = vi.spyOn(logger, "fatal").mockImplementation(() => {});
    validateEnv();
    expect(fatal).toHaveBeenCalledWith({ missing: ["DATABASE_URL"] }, expect.any(String));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("warns on short admin password", () => {
    vi.stubEnv("ADMIN_PASSWORD", "short");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    validateEnv();
    expect(warn).toHaveBeenCalledWith({ minLen: 12 }, expect.any(String));
  });

  it("logs fatal on inverted age limits", () => {
    vi.stubEnv("CHILDREN_AGE_LIMIT", "20");
    const fatal = vi.spyOn(logger, "fatal").mockImplementation(() => {});
    validateEnv();
    expect(fatal).toHaveBeenCalledWith({ childrenLimit: 20, youthLimit: 18 }, expect.any(String));
  });

});

describe("sendMail logging", () => {
  afterEach(() => vi.restoreAllMocks());

  it("warns without logging the recipient when SMTP is not configured", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    expect(await sendMail("a@b.de", "Betreff", "x")).toEqual({ sent: false });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("a@b.de");
  });
});
