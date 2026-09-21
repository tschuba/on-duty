const UMLAUT_MAP: Record<string, string> = {
  ä: "ae", ö: "oe", ü: "ue", ß: "ss",
  Ä: "ae", Ö: "oe", Ü: "ue",
};

export function generateRoleSlug(title: string): string {
  return title
    .replace(/[äöüßÄÖÜ]/g, (c) => UMLAUT_MAP[c] ?? c)
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^[^a-z]+/, "") // strip leading non-alpha
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}
