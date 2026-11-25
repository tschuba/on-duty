import { describe, it, expect, vi } from "vitest";

const mockSend = vi.hoisted(() => vi.fn(() => Promise.reject(new Error("smtp"))));
vi.mock("../env.js", () => ({ env: { SMTP_HOST: "h", SMTP_FROM: "f", ORG_NAME: "Wehr|[A]" } }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: mockSend }) } }));

import { logger } from "../lib/logger.js";
import { mailLabel } from "../lib/mail-label.js";
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

  it("sets a sanitized X-On-Duty-Org header", async () => {
    mockSend.mockResolvedValueOnce(undefined as never);
    await sendMail({ key: "x", to: "a@b.de", vars: {}, template: { key: "x", locale: "de", category: "lend", audience: "staff", topic: null, prefix: "", subject: "B", body: "x", headersMode: "fixed", extraHeaders: null } });
    const h = (mockSend.mock.calls.at(-1) as unknown as [{ headers: Record<string, string> }])[0].headers;
    expect(h["X-On-Duty-Org"]).toBe(mailLabel("Wehr|[A]"));
    expect(h["X-On-Duty-Org"]).not.toMatch(/[|[\]]/);
  });
});
