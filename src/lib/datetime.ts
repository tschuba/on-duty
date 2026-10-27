import { env } from "../env.js";

// Erweiterungspunkt: heute eine feste Zone für die ganze Wehr, später ggf. pro Request/Org.
export function resolveTimezone(_c?: unknown): string {
  return env.APP_TIMEZONE;
}

const PARTS_FMT = new Map<string, Intl.DateTimeFormat>();
function partsFmt(tz: string) {
  let f = PARTS_FMT.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    PARTS_FMT.set(tz, f);
  }
  return f;
}

// Wanduhr-Zeit in `tz` zum UTC-Zeitpunkt `ms` als pseudo-UTC-Millisekunden.
function wallAsUtc(ms: number, tz: string): number {
  const p = Object.fromEntries(partsFmt(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

const offsetAt = (ms: number, tz: string) => wallAsUtc(ms, tz) - Math.floor(ms / 1000) * 1000;

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

// "YYYY-MM-DD" oder "YYYY-MM-DDTHH:mm" (Wanduhr in `tz`) → UTC-Date; null bei ungültiger Eingabe.
// Lücke (Frühjahr) wird nach vorn geschoben, doppelte Stunde (Herbst) nimmt den ersten Zeitpunkt.
export function parseLocal(input: string, tz: string): Date | null {
  const m = LOCAL_RE.exec(input);
  if (!m) return null;
  const [y, mo, d, h = 0, mi = 0] = m.slice(1).map((x) => (x === undefined ? 0 : Number(x)));
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(guess);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return null;
  // Kandidaten mit dem Offset vor und nach dem Tag; gültig, wenn der Offset am Ergebnis wieder passt.
  const offs = [offsetAt(guess - 864e5, tz), offsetAt(guess + 864e5, tz)];
  const valid = offs.map((o) => guess - o).filter((ms, i) => offsetAt(ms, tz) === offs[i]);
  const ms = valid.length ? Math.min(...valid) : guess - offs[0]; // Lücke: Offset davor → Zeit rutscht nach vorn
  return new Date(ms);
}

// UTC-Date → "YYYY-MM-DDTHH:mm" in `tz` (Wert für datetime-local).
export function toLocalInput(date: Date, tz: string): string {
  const s = new Date(wallAsUtc(date.getTime(), tz)).toISOString();
  return s.slice(0, 16);
}
export const toLocalDate = (date: Date, tz: string) => toLocalInput(date, tz).slice(0, 10);

export function formatDateTime(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(date);
}
export function formatDay(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}
export function formatTime(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(date);
}
// Ganztägig: Start 00:00 am ersten, Ende 23:59 am letzten Tag (Wanduhr in `tz`).
export function allDayBounds(startDay: string, endDay: string, tz: string): { startsAt: Date; endsAt: Date } | null {
  const startsAt = parseLocal(startDay, tz), endsAt = parseLocal(`${endDay}T23:59`, tz);
  return startsAt && endsAt ? { startsAt, endsAt } : null;
}

// Beginn des Tages nach `day` (exklusive Obergrenze für Bereichsfilter).
export function dayAfter(day: string, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return parseLocal(next, tz)!;
}

// Alle Kalendertage ("YYYY-MM-DD", Wanduhr in `tz`), die [start, end] berühren.
export function localDays(start: Date, end: Date, tz: string): string[] {
  const out: string[] = [];
  const last = toLocalDate(end, tz);
  for (let d = toLocalDate(start, tz); d <= last; ) {
    out.push(d);
    const [y, m, day] = d.split("-").map(Number);
    d = new Date(Date.UTC(y, m - 1, day + 1)).toISOString().slice(0, 10);
  }
  return out;
}
