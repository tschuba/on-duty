import { describe, it, expect, vi } from "vitest";

vi.mock("../env.js", () => ({ env: { SMTP_HOST: "h", SMTP_FROM: "f" } }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: () => Promise.reject(new Error("smtp")) }) } }));

import { logger } from "../lib/logger.js";
import { sendMail } from "../lib/mail.js";

vi.mock("../lib/mail-templates.js", async (orig) => ({ ...(await orig<object>()), resolveTemplate: async () => null }));

describe("sendMail", () => {
  it("logs failures without the recipient and returns sent: false", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    expect(await sendMail({ key: "x", to: "a@b.de", vars: {}, template: { key: "x", locale: "de", category: "lend", audience: "staff", topic: null, prefix: "", subject: "Betreff", body: "x", headersMode: "fixed", extraHeaders: null } })).toEqual({ sent: false });
    expect(JSON.stringify(error.mock.calls)).not.toContain("a@b.de");
  });

  it("returns sent: false when no template resolves", async () => {
    expect(await sendMail({ key: "x", to: "a@b.de", vars: {} })).toEqual({ sent: false });
  });
});
