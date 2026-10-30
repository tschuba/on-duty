import { t } from "../i18n/index.js";
import { formatDate } from "./format.js";

type TranslationKey = Parameters<typeof t>[0];

// group + short: consecutive presets with the same group render as one row of short-labelled buttons.
export type RangePreset = { id: string; key: TranslationKey; start: string; end: string; group?: "this" | "next"; short?: TranslationKey };

export function todayStr(): string {
  return fmt(new Date());
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  // Tag auf das Monatsende des Zielmonats kappen (31.01. + 1 Monat = 28./29.02.).
  const last = new Date(y, m + months, 0).getDate();
  return fmt(new Date(y, m - 1 + months, Math.min(d, last)));
}

// "future": ab heute nach vorn (Prüfungen, Jubiläen, Verleih); "past": bis heute zurück (Spenden, Anträge).
// yearStart ("MM-DD", anniversary cutoff) adds ceremony-year presets next to the calendar-year ones.
export function rangePresets(today: string, dir: "future" | "past", yearStart?: string): RangePreset[] {
  const y = Number(today.slice(0, 4));
  const year = (n: number) => ({ start: `${n}-01-01`, end: `${n}-12-31` });
  if (dir === "future") {
    const cal = yearStart ? { short: "filter.quick.calendar" as const } : {};
    const cer = (k: number) => unitSpan(today, "Y", k, yearStart);
    return [
      { id: "3m", key: "filter.quick.3months", start: today, end: addMonths(today, 3) },
      { id: "6m", key: "filter.quick.6months", start: today, end: addMonths(today, 6) },
      { id: "12m", key: "filter.quick.12months", start: today, end: addMonths(today, 12) },
      { id: "thisYear", key: "filter.quick.thisYear", ...year(y), ...cal, ...(yearStart && { group: "this" as const }) },
      ...(yearStart ? [{ id: "thisCeremony", key: "filter.quick.thisCeremony" as const, ...cer(0), group: "this" as const, short: "filter.quick.ceremony" as const }] : []),
      { id: "nextYear", key: "filter.quick.nextYear", ...year(y + 1), ...cal, ...(yearStart && { group: "next" as const }) },
      ...(yearStart ? [{ id: "nextCeremony", key: "filter.quick.nextCeremony" as const, ...cer(1), group: "next" as const, short: "filter.quick.ceremony" as const }] : []),
    ];
  }
  return [
    { id: "3m", key: "filter.quick.last3months", start: addMonths(today, -3), end: today },
    { id: "6m", key: "filter.quick.last6months", start: addMonths(today, -6), end: today },
    { id: "12m", key: "filter.quick.last12months", start: addMonths(today, -12), end: today },
    { id: "thisYear", key: "filter.quick.thisYear", ...year(y) },
    { id: "lastYear", key: "filter.quick.lastYear", ...year(y - 1) },
  ];
}

export type RelUnit = "D" | "W" | "M" | "Y";
export type RelDir = "past" | "future" | "both";
export const REL_UNITS: RelUnit[] = ["D", "W", "M", "Y"];
export const REL_DIRS: RelDir[] = ["past", "future", "both"];
const REL_RE = /^P(\d{1,3})([DWMY])$/;

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return fmt(new Date(y, m - 1, d + days));
}

const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

// Cutoff "MM-DD" in year y (Feb 29 clamped). A ceremony year ends on its cutoff date.
function cutoffDate(y: number, cutoff: string): string {
  const [cm, cd] = cutoff.split("-").map(Number);
  return fmt(new Date(y, cm - 1, Math.min(cd, daysInMonth(y, cm))));
}

// Whole unit k steps away from the unit containing ref (k < 0 = past). Weeks start on Monday.
function unitSpan(ref: string, unit: RelUnit, k: number, cutoff?: string): { start: string; end: string } {
  const [y, m, d] = ref.split("-").map(Number);
  if (unit === "D") return { start: addDays(ref, k), end: addDays(ref, k) };
  if (unit === "W") {
    const start = addDays(ref, -((new Date(y, m - 1, d).getDay() + 6) % 7) + 7 * k);
    return { start, end: addDays(start, 6) };
  }
  if (unit === "M") return { start: fmt(new Date(y, m - 1 + k, 1)), end: fmt(new Date(y, m + k, 0)) };
  if (!cutoff) return { start: `${y + k}-01-01`, end: `${y + k}-12-31` };
  const endYear = ref <= cutoffDate(y, cutoff) ? y : y + 1; // ceremony year containing ref
  return { start: addDays(cutoffDate(endYear - 1 + k, cutoff), 1), end: cutoffDate(endYear + k, cutoff) };
}

// Whole units around the current unit (the one containing ref). The current unit counts for past/future, not for "both".
// cutoff ("MM-DD") switches unit Y to ceremony years.
export function relativeRange(ref: string, n: number, unit: RelUnit, dir: RelDir, cutoff?: string): { start: string; end: string } {
  const lo = dir === "future" ? 0 : dir === "past" ? -(n - 1) : -n;
  const hi = dir === "past" ? 0 : dir === "future" ? n - 1 : n;
  return { start: unitSpan(ref, unit, lo, cutoff).start, end: unitSpan(ref, unit, hi, cutoff).end };
}

export type ParsedRange = {
  mode: "default" | "preset" | "rel" | "custom";
  start: string;
  end: string;
  id?: string; // preset
  rel?: { n: number; unit: RelUnit; dir: RelDir; ref?: string; ceremony?: boolean }; // ref nur, wenn ≠ heute
};

type RangeQuery = { range?: string; rel?: string; dir?: string; ref?: string; yr?: string; start?: string; end?: string };

// Löst die URL-Parameter gegen heute auf. Ungültiges fällt still auf den Seiten-Standard zurück.
// `start`/`end` sind hier die Werte der Seite (je nach Route aus start/end bzw. from/to gelesen).
export function parseRange(q: RangeQuery, today: string, dir: "future" | "past", defaults: { start: string; end: string }, cutoff?: string): ParsedRange {
  const fallback: ParsedRange = { mode: "default", ...defaults };
  const hasDates = q.start !== undefined || q.end !== undefined;
  const custom: ParsedRange = { mode: "custom", start: q.start ?? defaults.start, end: q.end ?? defaults.end };
  const presets = rangePresets(today, dir, cutoff);
  if (q.range === "custom") return custom;
  if (q.range === "rel") {
    const m = REL_RE.exec(q.rel ?? "");
    const d = REL_DIRS.find((x) => x === q.dir);
    if (!m || !d || Number(m[1]) < 1) return fallback;
    const n = Number(m[1]), unit = m[2] as RelUnit;
    const ref = q.ref && /^\d{4}-\d{2}-\d{2}$/.test(q.ref) && q.ref !== today ? q.ref : undefined;
    // yr=ceremony only counts for unit Y on pages that have a cutoff
    const ceremony = unit === "Y" && q.yr === "ceremony" && !!cutoff;
    return { mode: "rel", ...relativeRange(ref ?? today, n, unit, d, ceremony ? cutoff : undefined), rel: { n, unit, dir: d, ref, ceremony } };
  }
  const p = presets.find((x) => x.id === q.range);
  if (p) return { mode: "preset", start: p.start, end: p.end, id: p.id };
  if (!hasDates) return fallback;
  // Alte Links nur mit Daten: exakter Preset-Treffer → Preset, sonst benutzerdefiniert.
  const hit = presets.find((x) => x.start === custom.start && x.end === custom.end);
  return hit ? { mode: "preset", start: hit.start, end: hit.end, id: hit.id } : custom;
}

// Parameter, die den Bereich in Links/Formularen erhalten (ohne Standard); `names` = Datumsparameter der Seite.
export function rangeParams(r: ParsedRange, names: { start: string; end: string } = { start: "start", end: "end" }): Record<string, string | undefined> {
  if (r.mode === "preset") return { range: r.id };
  if (r.mode === "rel") return { range: "rel", rel: `P${r.rel!.n}${r.rel!.unit}`, dir: r.rel!.dir, ref: r.rel!.ref, yr: r.rel!.ceremony ? "ceremony" : undefined };
  if (r.mode === "custom") return { range: "custom", [names.start]: r.start, [names.end]: r.end };
  return {};
}

// ── Anzeige ───────────────────────────────────────────────────────────────────

const MONTH_KEYS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"] as const;
const monthName = (m: number, short: boolean) => {
  const n = t(`month.${MONTH_KEYS[m - 1]}` as TranslationKey);
  return short && n.length > 4 ? n.slice(0, 3) : n;
};
const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate();

// Kurzform für schnelle Lesbarkeit: "März 2026", "Jan – März 2026", "heute bis 23.01.2027", "23.01. – 23.06.2026".
export function formatRange(start: string, end: string, today: string): string {
  if (!start && !end) return "";
  if (!end) return `ab ${formatDate(start)}`;
  if (!start) return `bis ${formatDate(end)}`;
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (sd === 1 && ed === daysIn(ey, em) && start <= end) { // ganze Kalendermonate
    if (sy === ey && sm === 1 && em === 12) return String(sy);
    if (sy === ey && sm === em) return `${monthName(sm, false)} ${sy}`;
    if (sy === ey) return `${monthName(sm, true)} – ${monthName(em, true)} ${sy}`;
    return `${monthName(sm, true)} ${sy} – ${monthName(em, true)} ${ey}`;
  }
  if (start === today && end === today) return t("filter.quick.today");
  if (start === today) return `${t("filter.quick.today")} bis ${formatDate(end)}`;
  if (end === today) return `${formatDate(start)} bis ${t("filter.quick.today")}`;
  if (sy === ey) return `${formatDate(start).slice(0, 6)} – ${formatDate(end)}`;
  return `${formatDate(start)} – ${formatDate(end)}`;
}

const UNIT_LABEL: Record<RelUnit | "YC", [TranslationKey, TranslationKey]> = {
  D: ["filter.quick.unit1.D", "filter.quick.unit.D"],
  W: ["filter.quick.unit1.W", "filter.quick.unit.W"],
  M: ["filter.quick.unit1.M", "filter.quick.unit.M"],
  Y: ["filter.quick.unit1.Y", "filter.quick.unit.Y"],
  YC: ["filter.quick.unit1.YC", "filter.quick.unit.YC"],
};

// Button-Label für "Relativ": "+3 Monate", "−1 Woche", "±10 Tage".
export function relLabel(n: number, unit: RelUnit, dir: RelDir, ceremony = false): string {
  const sign = dir === "future" ? "+" : dir === "past" ? "−" : "±";
  return `${sign}${n} ${t(UNIT_LABEL[ceremony ? "YC" : unit][n === 1 ? 0 : 1])}`;
}

// "ab"-Zusatz im Titel, wenn das Referenzdatum vom heutigen abweicht: "30.10." (Jahr nur falls ≠ heute: "30.10.2027").
export function refLabel(ref: string, today: string): string {
  return ref.slice(0, 4) === today.slice(0, 4) ? `${formatDate(ref).slice(0, 6)}` : formatDate(ref);
}
