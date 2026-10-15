import type { members, memberRoleAssignments, memberRoles } from "../db/schema/index.js";

// birthDate is nullable in `persons` (donor-only persons need none) but every
// `members` row's owning person is required to have one at the app layer
// (members.tsx form validation) — so it's re-asserted non-null here rather
// than inherited as `string | null` from the schema type.
type Member = typeof members.$inferSelect & { birthDate: string };
type Assignment = typeof memberRoleAssignments.$inferSelect & {
  role: typeof memberRoles.$inferSelect;
};

export type MemberStatus = "ausgetreten" | "verstorben" | "kinder" | "jugend" | "aktiv" | "passiv";

/** Ausgeschieden = ausgetreten oder verstorben. */
export function isFormer(status: MemberStatus): status is "ausgetreten" | "verstorben" {
  return status === "ausgetreten" || status === "verstorben";
}

// Local date components, not new Date(str).getTime() — avoids UTC/local timezone
// shift on the day-of-birthday boundary.
export function ageInYears(birthDate: string): number {
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
  if (beforeBirthday) age--;
  return age;
}

export function deriveMemberStatus(
  member: Pick<Member, "exitDate" | "deathDate" | "birthDate">,
  assignments: Assignment[],
  childrenAgeLimit: number,
  youthAgeLimit: number
): MemberStatus {
  if (member.deathDate) return "verstorben";
  if (member.exitDate) return "ausgetreten";

  const hasActiveRole = assignments.some(
    (a) => a.role.grantsActiveStatus && !a.to
  );

  if (hasActiveRole) {
    const age = ageInYears(member.birthDate);
    if (age < childrenAgeLimit) return "kinder";
    return age < youthAgeLimit ? "jugend" : "aktiv";
  }

  return "passiv";
}
