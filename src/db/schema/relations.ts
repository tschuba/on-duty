import { relations } from "drizzle-orm";
import { members } from "./members";
import { persons } from "./persons";
import { memberRoleAssignments, memberRoles } from "./roles";
import { donors, donations } from "./donations";
import { users } from "./auth";
import { applications, applicationGuardians } from "./applications";
import { inventoryItems, inventoryItemTags } from "./inventory";

/* v8 ignore start -- relation declarations, no branching logic to unit-test */
export const personsRelations = relations(persons, ({ one, many }) => ({
  member: one(members),
  donor: one(donors),
  // many, not one: a person can reapply after a rejection, or submit again years
  // later — every application stays attached, "rejected" ones included.
  applications: many(applications),
}));

export const applicationsRelations = relations(applications, ({ one, many }) => ({
  person: one(persons, { fields: [applications.personId], references: [persons.id] }),
  reviewer: one(users, { fields: [applications.reviewedBy], references: [users.id] }),
  guardians: many(applicationGuardians),
}));

export const applicationGuardiansRelations = relations(applicationGuardians, ({ one }) => ({
  application: one(applications, { fields: [applicationGuardians.applicationId], references: [applications.id] }),
  person: one(persons, { fields: [applicationGuardians.personId], references: [persons.id] }),
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
  assignedInventoryItems: many(inventoryItems),
}));

export const inventoryItemsRelations = relations(inventoryItems, ({ one, many }) => ({
  assignedMember: one(members, { fields: [inventoryItems.assignedMemberId], references: [members.id] }),
  tags: many(inventoryItemTags),
}));

export const inventoryItemTagsRelations = relations(inventoryItemTags, ({ one }) => ({
  item: one(inventoryItems, { fields: [inventoryItemTags.inventoryItemId], references: [inventoryItems.id] }),
}));

export const assignmentsRelations = relations(memberRoleAssignments, ({ one }) => ({
  member: one(members, { fields: [memberRoleAssignments.memberId], references: [members.id] }),
  role: one(memberRoles, { fields: [memberRoleAssignments.memberRoleId], references: [memberRoles.id] }),
}));

export const rolesRelations = relations(memberRoles, ({ many }) => ({
  assignments: many(memberRoleAssignments),
}));
/* v8 ignore stop */
