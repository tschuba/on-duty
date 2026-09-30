export function trimmed(body: Record<string, any>, key: string): string {
  return String(body[key] ?? "").trim();
}
