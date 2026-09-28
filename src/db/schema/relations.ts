import { relations } from "drizzle-orm";
import { members } from "./members";
import { memberRoleAssignments, memberRoles } from "./roles";

/* v8 ignore start -- relation declarations, no branching logic to unit-test */
export const membersRelations = relations(members, ({ many }) => ({
  assignments: many(memberRoleAssignments),
}));

export const assignmentsRelations = relations(memberRoleAssignments, ({ one }) => ({
  member: one(members, { fields: [memberRoleAssignments.memberId], references: [members.id] }),
  role: one(memberRoles, { fields: [memberRoleAssignments.memberRoleId], references: [memberRoles.id] }),
}));

export const rolesRelations = relations(memberRoles, ({ many }) => ({
  assignments: many(memberRoleAssignments),
}));
/* v8 ignore stop */
