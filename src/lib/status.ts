import type { members, memberRoleAssignments, memberRoles } from "../db/schema/index.js";

// birthDate is nullable in `persons` (donor-only persons need none) but every
// `members` row's owning person is required to have one at the app layer
// (members.tsx form validation) — so it's re-asserted non-null here rather
// than inherited as `string | null` from the schema type.
type Member = typeof members.$inferSelect & { birthDate: string };
type Assignment = typeof memberRoleAssignments.$inferSelect & {
  role: typeof memberRoles.$inferSelect;
};

export type MemberStatus = "ausgetreten" | "verstorben" | "kinder" | "jugend" | "aktiv" | "passiv" | "foerdernd";

/** Ausgeschieden = ausgetreten oder verstorben. */
export function isFormer(status: MemberStatus): status is "ausgetreten" | "verstorben" {
  return status === "ausgetreten" || status === "verstorben";
}

// Local date components, not new Date(str).getTime() — avoids UTC/local timezone
// shift on the day-of-birthday boundary.
export function ageInYears(birthDate: string, today = new Date()): number {
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
  if (beforeBirthday) age--;
  return age;
}

/** Stichtag (YYYY-MM-DD), an dem die Altersgrenze erreicht wird. */
/** Alters-/Ehrenabteilung: ab diesem Alter nicht mehr aktiv. */
export const DEFAULT_ACTIVE_AGE_LIMIT = 65;

export function ageLimitDate(birthDate: string, limit: number): string {
  const [y, m, d] = birthDate.split("-");
  return `${Number(y) + limit}-${m}-${d}`;
}

export type AgeGroup = "kinder" | "jugend" | "erwachsen" | "senioren";
export const AGE_GROUPS: AgeGroup[] = ["kinder", "jugend", "erwachsen", "senioren"];

/** Reine Altersgruppe am heutigen Tag, unabhängig von Status/Funktion. */
export function ageGroupOf(
  birthDate: string,
  childrenAgeLimit: number,
  youthAgeLimit: number,
  activeAgeLimit: number,
  today = new Date()
): AgeGroup {
  const age = ageInYears(birthDate, today);
  if (age < childrenAgeLimit) return "kinder";
  if (age < youthAgeLimit) return "jugend";
  if (age < activeAgeLimit) return "erwachsen";
  return "senioren";
}

export function deriveMemberStatus(
  member: Pick<Member, "exitDate" | "deathDate" | "birthDate">,
  assignments: Assignment[],
  childrenAgeLimit: number,
  youthAgeLimit: number,
  activeAgeLimit = DEFAULT_ACTIVE_AGE_LIMIT,
  today = new Date()
): MemberStatus {
  if (member.deathDate) return "verstorben";
  if (member.exitDate) return "ausgetreten";

  const age = ageInYears(member.birthDate, today);
  if (age < activeAgeLimit && assignments.some((a) => a.role.grantsActiveStatus && !a.to)) {
    if (age < childrenAgeLimit) return "kinder";
    return age < youthAgeLimit ? "jugend" : "aktiv";
  }

  const cutoff = ageLimitDate(member.birthDate, activeAgeLimit);
  const wasActiveAtCutoff = assignments.some(
    (a) => a.role.grantsActiveStatus && a.from <= cutoff && (!a.to || a.to >= cutoff)
  );
  return wasActiveAtCutoff ? "passiv" : "foerdernd";
}
