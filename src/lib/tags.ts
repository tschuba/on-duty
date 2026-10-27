import { count } from "drizzle-orm";
import { db } from "../db/index.js";
import { inventoryItemTags } from "../db/schema/index.js";

type TagSource = Pick<typeof db, "select">;

// Pro Schreibweise (ohne Beachtung der Groß-/Kleinschreibung) gewinnt die häufigste, bei Gleichstand die alphabetisch erste.
export async function tagVocabulary(source: TagSource = db): Promise<string[]> {
  const rows = await source.select({ tag: inventoryItemTags.tag, n: count() }).from(inventoryItemTags).groupBy(inventoryItemTags.tag);
  const best = new Map<string, { tag: string; n: number }>();
  for (const r of rows) {
    const k = r.tag.toLowerCase(), cur = best.get(k);
    if (!cur || r.n > cur.n || (r.n === cur.n && r.tag < cur.tag)) best.set(k, r);
  }
  return [...best.values()].map((r) => r.tag).sort((a, b) => a.localeCompare(b, "de"));
}

// Gleicht Tags mit vorhandenen Schreibweisen ab und entfernt Duplikate (erstes Vorkommen bleibt).
// `existing` wird um neu gesehene Tags ergänzt, sodass sich auch Tags innerhalb eines Stapels angleichen.
export function canonicalizeTags(tags: string[], existing: string[]): string[] {
  const out = new Map<string, string>();
  for (const tag of tags) {
    const k = tag.toLowerCase();
    if (out.has(k)) continue;
    const known = existing.find((e) => e.toLowerCase() === k);
    if (!known) existing.push(tag);
    out.set(k, known ?? tag);
  }
  return [...out.values()];
}

export const TAG_SUGGESTIONS_ID = "tag-suggestions";
export function tagSuggestionsJson(vocab: string[]): string {
  return JSON.stringify(vocab).replace(/</g, "\\u003c");
}
