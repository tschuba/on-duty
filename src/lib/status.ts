import type { members, memberRoleAssignments, memberRoles } from "../db/schema/index.js";

// birthDate is nullable in `persons` (donor-only persons need none) but every
// `members` row's owning person is required to have one at the app layer
// (members.tsx form validation) — so it's re-asserted non-null here rather
// than inherited as `string | null` from the schema type.
type Member = typeof members.$inferSelect & { birthDate: string };
type Assignment = typeof memberRoleAssignments.$inferSelect & {
  role: typeof memberRoles.$inferSelect;
};

export type MemberStatus = "archiviert" | "kinder" | "jugend" | "aktiv" | "passiv";

export function deriveMemberStatus(
  member: Pick<Member, "exitDate" | "deathDate" | "birthDate">,
  assignments: Assignment[],
  childrenAgeLimit: number,
  youthAgeLimit: number
): MemberStatus {
  if (member.exitDate || member.deathDate) return "archiviert";

  const hasActiveRole = assignments.some(
    (a) => a.role.grantsActiveStatus && !a.to
  );

  if (hasActiveRole) {
    const today = new Date();
    const birth = new Date(member.birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const beforeBirthday =
      today.getMonth() < birth.getMonth() ||
      (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
    if (beforeBirthday) age--;

    if (age < childrenAgeLimit) return "kinder";
    return age < youthAgeLimit ? "jugend" : "aktiv";
  }

  return "passiv";
}
