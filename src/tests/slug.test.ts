import { describe, it, expect } from "vitest";
import { generateRoleSlug } from "../lib/slug.js";

describe("generateRoleSlug", () => {
  it("basic lowercase", () => expect(generateRoleSlug("Kassier")).toBe("kassier"));
  it("umlauts", () => expect(generateRoleSlug("Schriftführer")).toBe("schriftfuehrer"));
  it("ü → ue", () => expect(generateRoleSlug("Gruppenführer")).toBe("gruppenfuehrer"));
  it("ß → ss", () => expect(generateRoleSlug("Straße")).toBe("strasse"));
  it("spaces to underscore", () => expect(generateRoleSlug("Stellv. Jugendfeuerwehrwart")).toBe("stellv_jugendfeuerwehrwart"));
  it("hyphens to underscore", () => expect(generateRoleSlug("Erste-Hilfe-Wart")).toBe("erste_hilfe_wart"));
  it("leading digit stripped", () => expect(generateRoleSlug("1. Vorstand")).toBe("vorstand"));
  it("uppercase umlauts", () => expect(generateRoleSlug("Öffentlichkeitsarbeit")).toBe("oeffentlichkeitsarbeit"));
  it("no double underscores", () => expect(generateRoleSlug("foo  --  bar")).toBe("foo_bar"));
  it("strips special chars", () => expect(generateRoleSlug("Test@Work!")).toBe("testwork"));
  it("matches seed: erster_kommandant", () => expect(generateRoleSlug("Erster Kommandant")).toBe("erster_kommandant"));
  it("matches seed: jugendfeuerwehrwart", () => expect(generateRoleSlug("Jugendfeuerwehrwart")).toBe("jugendfeuerwehrwart"));
});
