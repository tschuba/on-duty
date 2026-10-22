import { describe, it, expect, vi } from "vitest";

vi.mock("../env.js", () => ({ env: { SMTP_HOST: "h", SMTP_FROM: "f" } }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: () => Promise.reject(new Error("smtp")) }) } }));

import { logger } from "../lib/logger.js";
import { sendMail } from "../lib/mail.js";

describe("sendMail", () => {
  it("logs failures without the recipient and returns sent: false", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    expect(await sendMail("a@b.de", "Betreff", "x")).toEqual({ sent: false });
    expect(JSON.stringify(error.mock.calls)).not.toContain("a@b.de");
  });
});
