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

  it("warns on an invalid ORG_NAME without SMTP configured", () => {
    vi.stubEnv("ORG_NAME", "FF [Alten|hammer]");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    validateEnv();
    expect(warn).toHaveBeenCalledWith({ orgName: "FF [Alten|hammer]" }, expect.any(String));
  });

  it("logs fatal on an invalid ORG_NAME with SMTP configured", () => {
    vi.stubEnv("ORG_NAME", "FF [Alten|hammer]");
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_FROM", "noreply@example.com");
    const fatal = vi.spyOn(logger, "fatal").mockImplementation(() => {});
    validateEnv();
    expect(fatal).toHaveBeenCalledWith({ orgName: "FF [Alten|hammer]" }, expect.any(String));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

});

describe("sendMail logging", () => {
  afterEach(() => vi.restoreAllMocks());

  it("warns without logging the recipient when SMTP is not configured", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    expect(await sendMail({ key: "x", to: "a@b.de", vars: {}, template: { key: "x", locale: "de", category: "lend", audience: "staff", topic: null, prefix: "", subject: "Betreff", body: "x", headersMode: "fixed", extraHeaders: null } })).toEqual({ sent: false });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("a@b.de");
  });
});
