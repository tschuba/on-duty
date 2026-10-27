import { describe, expect, it } from "vitest";
import { notificationRecipient } from "../lib/org-config.js";

describe("notificationRecipient", () => {
  it("prefers the separate address", () => {
    expect(notificationRecipient({ notificationEmail: "a@x.de", orgContactEmail: "k@x.de" })).toBe("a@x.de");
  });
  it("falls back to the contact email", () => {
    expect(notificationRecipient({ orgContactEmail: "k@x.de" })).toBe("k@x.de");
  });
  it("is empty when nothing is configured", () => {
    expect(notificationRecipient({})).toBe("");
  });
});
