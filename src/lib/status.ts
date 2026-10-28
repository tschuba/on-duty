import type { members, memberRoleAssignments, memberRoles } from "../db/schema/index.js";

// birthDate is nullable in `persons` (donor-only persons need none) but every
// `members` row's owning person is required to have one at the app layer
// (members.tsx form validation) — so it's re-asserted non-null here rather
// than inherited as `string | null` from the schema type.
type Member = typeof members.$inferSelect & { birthDate: string };
type Assignment = typeof memberRoleAssignments.$inferSelect & {
  role: typeof memberRoles.$inferSelect;
};

export type MemberStatus = "left" | "deceased" | "children" | "youth" | "active" | "passive" | "supporting";

/** Ausgeschieden = ausgetreten oder verstorben. */
export function isFormer(status: MemberStatus): status is "left" | "deceased" {
  return status === "left" || status === "deceased";
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

/** Veteran/honorary division: from this age on, no longer active. */
export const DEFAULT_ACTIVE_AGE_LIMIT = 65;

/** Cutoff date (YYYY-MM-DD) on which the age limit is reached. */
export function ageLimitDate(birthDate: string, limit: number): string {
  const [y, m, d] = birthDate.split("-");
  return `${Number(y) + limit}-${m}-${d}`;
}

export type AgeGroup = "children" | "youth" | "adult" | "senior";
export const AGE_GROUPS: AgeGroup[] = ["children", "youth", "adult", "senior"];

/** Pure age group as of today, independent of status/function. */
export function ageGroupOf(
  birthDate: string,
  childrenAgeLimit: number,
  youthAgeLimit: number,
  activeAgeLimit: number,
  today = new Date()
): AgeGroup {
  const age = ageInYears(birthDate, today);
  if (age < childrenAgeLimit) return "children";
  if (age < youthAgeLimit) return "youth";
  if (age < activeAgeLimit) return "adult";
  return "senior";
}

export function deriveMemberStatus(
  member: Pick<Member, "exitDate" | "deathDate" | "birthDate">,
  assignments: Assignment[],
  childrenAgeLimit: number,
  youthAgeLimit: number,
  activeAgeLimit = DEFAULT_ACTIVE_AGE_LIMIT,
  today = new Date()
): MemberStatus {
  if (member.deathDate) return "deceased";
  if (member.exitDate) return "left";

  const age = ageInYears(member.birthDate, today);
  if (age < activeAgeLimit && assignments.some((a) => a.role.grantsActiveStatus && !a.to)) {
    if (age < childrenAgeLimit) return "children";
    return age < youthAgeLimit ? "youth" : "active";
  }

  const cutoff = ageLimitDate(member.birthDate, activeAgeLimit);
  const wasActiveAtCutoff = assignments.some(
    (a) => a.role.grantsActiveStatus && a.from <= cutoff && (!a.to || a.to >= cutoff)
  );
  return wasActiveAtCutoff ? "passive" : "supporting";
}
