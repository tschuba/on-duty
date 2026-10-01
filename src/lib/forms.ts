export function trimmed(body: Record<string, any>, key: string): string {
  return String(body[key] ?? "").trim();
}

// Chip-input tags arrive as a comma-joined hidden field (see TagInput in
// routes/inventory.tsx) — split, trim, drop empties/duplicates.
export function parseTags(body: Record<string, any>, key: string): string[] {
  const raw = trimmed(body, key);
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}
