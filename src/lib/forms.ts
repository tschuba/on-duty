export function trimmed(body: Record<string, any>, key: string): string {
  return String(body[key] ?? "").trim();
}

// Repeated hidden fields (one per chip, see ChipInput) arrive as string | string[] —
// normalise, trim, drop empties/duplicates (case-sensitive).
export function parseList(body: Record<string, any>, key: string): string[] {
  const raw = body[key];
  const arr = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))];
}

// Tags: chips may still carry commas from older clients — split, then dedupe.
export function parseTags(body: Record<string, any>, key: string): string[] {
  return [...new Set(parseList(body, key).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean))];
}
