export const TRAINING_SOON_DAYS = 90;
export const TRAINING_TITLE_MAX = 200;

export type TrainingStatus = "expired" | "soon" | "valid" | "noExpiry" | "replaced";
export type TrainingLike = { id: string; memberId: string; title: string; completedAt: string | null; expiresAt: string | null };

const normTitle = (s: string) => s.trim().toLowerCase();

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** `today` is a local ISO date (use toLocalDate). A record is replaced when the same member has a later-completed record with the same title. */
export function trainingStatuses(records: TrainingLike[], today: string): Map<string, TrainingStatus> {
  const latest = new Map<string, string>();
  for (const r of records) {
    if (!r.completedAt) continue;
    const k = `${r.memberId}|${normTitle(r.title)}`;
    if (r.completedAt > (latest.get(k) ?? "")) latest.set(k, r.completedAt);
  }
  const soonLimit = addDays(today, TRAINING_SOON_DAYS);
  const out = new Map<string, TrainingStatus>();
  for (const r of records) {
    const newer = r.completedAt && (latest.get(`${r.memberId}|${normTitle(r.title)}`) ?? "") > r.completedAt;
    out.set(r.id,
      newer ? "replaced"
      : !r.expiresAt ? "noExpiry"
      : r.expiresAt < today ? "expired"
      : r.expiresAt <= soonLimit ? "soon"
      : "valid");
  }
  return out;
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().startsWith(s);

export type TrainingInput = { title: string; completedAt: string | null; expiresAt: string | null; organizer: string | null; notes: string | null };

/** Returns the cleaned input or an i18n error key. */
export function parseTrainingInput(body: Record<string, unknown>, today: string): { value: TrainingInput } | { error: "title" | "date" | "dates" | "future" | "order" } {
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
  const title = str("title");
  if (!title || title.length > TRAINING_TITLE_MAX) return { error: "title" };
  const completedAt = str("completedAt") || null;
  const expiresAt = str("expiresAt") || null;
  if ((completedAt && !isDate(completedAt)) || (expiresAt && !isDate(expiresAt))) return { error: "date" };
  if (!completedAt && !expiresAt) return { error: "dates" };
  if (completedAt && completedAt > today) return { error: "future" };
  if (completedAt && expiresAt && expiresAt < completedAt) return { error: "order" };
  return { value: { title, completedAt, expiresAt, organizer: str("organizer") || null, notes: str("notes") || null } };
}

export const TRAINING_SORT_KEYS = ["member", "title", "completedAt", "expiresAt", "organizer"] as const;
export type TrainingSortKey = (typeof TRAINING_SORT_KEYS)[number];
export type SortDir = "asc" | "desc";
type SortFields = Record<TrainingSortKey, string | null>;

export const parseTrainingSort = (v?: string): TrainingSortKey | undefined => TRAINING_SORT_KEYS.find((k) => k === v);
export const defaultTrainingDir = (k: TrainingSortKey): SortDir => (k === "completedAt" || k === "expiresAt" ? "desc" : "asc");
export const nextTrainingDir = (col: TrainingSortKey, sort: TrainingSortKey | undefined, dir: SortDir): SortDir =>
  sort === col ? (dir === "asc" ? "desc" : "asc") : defaultTrainingDir(col);

// Leere Werte stehen immer zuletzt, unabhängig von der Richtung.
const cmp = (a: string | null, b: string | null, dir: SortDir) =>
  a === b || (!a && !b) ? 0 : !a ? 1 : !b ? -1 : (dir === "asc" ? 1 : -1) * a.localeCompare(b, "de");

/** Standard: Ablaufdatum ↓, Abschlussdatum ↓, Bezeichnung. Eine gewählte Spalte steht davor, der Standard bleibt Tiebreaker. */
export function sortTrainings<T>(rows: T[], f: (x: T) => SortFields, sort?: TrainingSortKey, dir?: SortDir): T[] {
  const base = (a: SortFields, b: SortFields) => cmp(a.expiresAt, b.expiresAt, "desc") || cmp(a.completedAt, b.completedAt, "desc") || cmp(a.title, b.title, "asc");
  return [...rows].sort((x, y) => {
    const a = f(x), b = f(y);
    return (sort && cmp(a[sort], b[sort], dir ?? defaultTrainingDir(sort))) || base(a, b);
  });
}
