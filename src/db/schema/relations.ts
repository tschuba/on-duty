import { relations } from "drizzle-orm";
import { members } from "./members";
import { persons } from "./persons";
import { memberRoleAssignments, memberRoles } from "./roles";
import { donors, donations } from "./donations";
import { users } from "./auth";

/* v8 ignore start -- relation declarations, no branching logic to unit-test */
export const personsRelations = relations(persons, ({ one }) => ({
  member: one(members),
  donor: one(donors),
}));

export const donorsRelations = relations(donors, ({ one, many }) => ({
  person: one(persons, { fields: [donors.personId], references: [persons.id] }),
  donations: many(donations),
}));

export const donationsRelations = relations(donations, ({ one }) => ({
  donor: one(donors, { fields: [donations.donorId], references: [donors.id] }),
  issuer: one(users, { fields: [donations.issuedBy], references: [users.id] }),
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
