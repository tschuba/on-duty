// Rücksprungziel für Formulare (?returnTo=… / Hidden-Feld). Nur same-origin-Pfade, sonst Open Redirect.
export function safeReturnTo(raw: unknown): string | undefined {
  const s = typeof raw === "string" ? raw.trim() : "";
  return /^\/(?![/\\])/.test(s) ? s : undefined;
}

// Ersetzt Query-Parameter mit dem Wert "{id}" durch die neue ID; ohne ID entfällt der Parameter.
export function fillReturnTo(returnTo: string, id?: string): string {
  const url = new URL(returnTo, "http://x");
  for (const [k, v] of [...url.searchParams]) {
    if (v !== "{id}") continue;
    if (id) url.searchParams.set(k, id);
    else url.searchParams.delete(k);
  }
  return url.pathname + url.search;
}
