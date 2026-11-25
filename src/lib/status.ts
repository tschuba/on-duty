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

/** Warum ein Mitglied seinen Status hat (Diagnose, siehe members.statusReason.*). */
export type StatusReason =
  | { kind: "deceased"; date: string }
  | { kind: "left"; date: string }
  | { kind: "runningRole"; roleTitle: string; age: number }
  | { kind: "passiveAtCutoff"; roleTitle: string; age: number; cutoff: string; limit: number }
  | { kind: "noOpenRole" }
  | { kind: "openRoleNotActive"; roleTitle: string }
  | { kind: "noRoleAtCutoff"; cutoff: string; limit: number };

/** Einzige Statuslogik: liefert Status und Grund. */
export function explainMemberStatus(
  member: Pick<Member, "exitDate" | "deathDate" | "birthDate">,
  assignments: Assignment[],
  childrenAgeLimit: number,
  youthAgeLimit: number,
  activeAgeLimit = DEFAULT_ACTIVE_AGE_LIMIT,
  today = new Date()
): { status: MemberStatus; reason: StatusReason } {
  if (member.deathDate) return { status: "deceased", reason: { kind: "deceased", date: member.deathDate } };
  if (member.exitDate) return { status: "left", reason: { kind: "left", date: member.exitDate } };

  const age = ageInYears(member.birthDate, today);
  const running = assignments.find((a) => a.role.grantsActiveStatus && !a.to);
  if (age < activeAgeLimit) {
    if (running) {
      const group = ageGroupOf(member.birthDate, childrenAgeLimit, youthAgeLimit, activeAgeLimit, today);
      const status = group === "children" ? "children" : group === "youth" ? "youth" : "active";
      return { status, reason: { kind: "runningRole", roleTitle: running.role.title, age } };
    }
    const open = assignments.find((a) => !a.to);
    return { status: "supporting", reason: open ? { kind: "openRoleNotActive", roleTitle: open.role.title } : { kind: "noOpenRole" } };
  }

  const cutoff = ageLimitDate(member.birthDate, activeAgeLimit);
  const atCutoff = assignments.find(
    (a) => a.role.grantsActiveStatus && (a.from == null || a.from <= cutoff) && (!a.to || a.to >= cutoff)
  );
  return atCutoff
    ? { status: "passive", reason: { kind: "passiveAtCutoff", roleTitle: atCutoff.role.title, age, cutoff, limit: activeAgeLimit } }
    : { status: "supporting", reason: { kind: "noRoleAtCutoff", cutoff, limit: activeAgeLimit } };
}

export function deriveMemberStatus(...args: Parameters<typeof explainMemberStatus>): MemberStatus {
  return explainMemberStatus(...args).status;
}
