import { describe, it, expect } from "vitest";
import { mailLabel } from "../lib/mail-label.js";

describe("mailLabel", () => {
  it("falls back to on-duty", () => {
    expect(mailLabel(undefined)).toBe("on-duty");
    expect(mailLabel("  ")).toBe("on-duty");
  });
  it("strips schema-breaking characters", () => {
    expect(mailLabel("FF [Alten|hammer]\n e.V.")).toBe("FF Alten hammer e.V.");
  });
});
