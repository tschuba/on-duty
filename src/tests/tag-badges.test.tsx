import { describe, it, expect } from "vitest";
import { TagBadges, TAG_STYLES } from "../components/tag-badges.js";

const render = (tags: string[]) => String(<TagBadges tags={tags} />);

describe("TagBadges", () => {
  it("styles the shipped template names case-insensitively and keeps every other tag neutral", () => {
    const html = render(["PSA", "psa-ähnlich", "Halle"]);
    expect(html).toContain("badge-accent");
    expect(html.match(/badge-ghost/g)).toHaveLength(2);
  });

  it("puts styled tags first, keeps the order otherwise, and shows the icon on the first one only", () => {
    const html = render(["Halle", "hydrant", "Fahrzeug", "Keller"]);
    const order = ["hydrant", "Fahrzeug", "Halle", "Keller"].map((t) => html.indexOf(`${t}</span>`));
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html.indexOf("<svg")).toBeLessThan(html.indexOf("hydrant</span>"));
    expect(html).toContain("badge-primary"); // Fahrzeug keeps its color, just no icon
  });

  it("reserves success/warning/error for the inspection status", () => {
    for (const { badge } of Object.values(TAG_STYLES)) expect(badge).not.toMatch(/success|warning|error/);
  });
});
