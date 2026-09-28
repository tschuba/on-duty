import type { members, memberRoleAssignments, memberRoles, persons } from "../db/schema/index.js";

type Member = typeof members.$inferSelect & Pick<typeof persons.$inferSelect, "birthDate">;
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
