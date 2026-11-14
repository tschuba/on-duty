// Kleinbuchstaben-Slug (Ziffern, Bindestriche; Umlaute umgeschrieben), höchstens 60 Zeichen. Ohne Abhängigkeiten: läuft auch im Browser-Bundle.
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const slugify = (s: string): string =>
  s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 60).replace(/-+$/, "");
