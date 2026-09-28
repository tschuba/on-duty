import { relations } from "drizzle-orm";
import { members } from "./members";
import { persons } from "./persons";
import { memberRoleAssignments, memberRoles } from "./roles";

/* v8 ignore start -- relation declarations, no branching logic to unit-test */
export const personsRelations = relations(persons, ({ one }) => ({
  member: one(members),
}));

export const membersRelations = relations(members, ({ one, many }) => ({
  person: one(persons, { fields: [members.personId], references: [persons.id] }),
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
