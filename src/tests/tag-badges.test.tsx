import { describe, it, expect } from "vitest";
import { TagBadges, TAG_STYLES } from "../components/tag-badges.js";

const render = (tags: string[]) => String(<TagBadges tags={tags} />);

describe("TagBadges", () => {
  it("styles the shipped template names case-insensitively and keeps every other tag neutral", () => {
    const html = render(["PSA", "psa-ähnlich", "Halle"]);
    expect(html).toContain("badge-accent");
    expect(html.match(/badge-ghost/g)).toHaveLength(2);
  });

  it("shows the icon of the first styled tag only", () => {
    const html = render(["Halle", "hydrant", "Fahrzeug"]);
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html.indexOf("<svg")).toBeGreaterThan(html.indexOf("Halle"));
    expect(html.indexOf("<svg")).toBeLessThan(html.indexOf("hydrant"));
    expect(html).toContain("badge-primary"); // Fahrzeug keeps its color, just no icon
  });

  it("reserves success/warning/error for the inspection status", () => {
    for (const { badge } of Object.values(TAG_STYLES)) expect(badge).not.toMatch(/success|warning|error/);
  });
});
