import { t } from "../i18n/index.js";

// Reihenfolge = Sortierung und Vorrang für die Kalenderfarbe. Klassen ausgeschrieben, damit Tailwind sie findet.
export const EVENT_TAGS = [
  { key: "mandatory", color: "error", badge: "badge-error", dot: "bg-error" },
  { key: "drill", color: "info", badge: "badge-info", dot: "bg-info" },
  { key: "training", color: "success", badge: "badge-success", dot: "bg-success" },
  { key: "party", color: "warning", badge: "badge-warning", dot: "bg-warning" },
  { key: "meeting", color: "neutral", badge: "badge-neutral", dot: "bg-neutral" },
] as const;

export type EventTagDef = (typeof EVENT_TAGS)[number];

export const eventTagDef = (tag: string): EventTagDef | undefined => EVENT_TAGS.find((d) => d.key === tag);

export const eventTagLabel = (tag: string): string => (eventTagDef(tag) ? t(`events.tag.${tag}` as any) : tag);

const norm = (s: string) => s.trim().toLowerCase();

// Label oder Schlüssel (ohne Groß-/Kleinschreibung) -> Schlüssel; Duplikate entfernt.
export function normalizeEventTags(tags: string[]): string[] {
  const out = tags.map((tag) => EVENT_TAGS.find((d) => d.key === norm(tag) || norm(t(`events.tag.${d.key}` as any)) === norm(tag))?.key ?? tag);
  return [...new Set(out)];
}

// Vordefinierte zuerst (Tabellenreihenfolge), dann freie in Eingabereihenfolge.
export function sortEventTags(tags: string[]): string[] {
  const idx = (tag: string) => EVENT_TAGS.findIndex((d) => d.key === tag);
  return [...tags].sort((a, b) => (idx(a) < 0 ? 99 : idx(a)) - (idx(b) < 0 ? 99 : idx(b)));
}

export const firstEventTagDef = (tags: string[]): EventTagDef | undefined => EVENT_TAGS.find((d) => tags.includes(d.key));
