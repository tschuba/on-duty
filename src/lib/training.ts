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
