import { relations } from "drizzle-orm";
import { members } from "./members";
import { persons } from "./persons";
import { memberRoleAssignments, memberRoles } from "./roles";
import { donors, donations } from "./donations";
import { users } from "./auth";
import { applications, applicationGuardians } from "./applications";
import { inventoryItems, inventoryItemTags, inventoryItemNumbers, inventoryItemSerials, inventoryItemAssignments, inventoryFieldDefs, inventoryFieldValues } from "./inventory";
import { lendingItems, lendingLoans, loanRequests } from "./lending";
import { events, eventTags, eventVisibleRoles } from "./events";
import { appRoles } from "./permissions";

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
  inventoryAssignments: many(inventoryItemAssignments),
}));

export const inventoryItemsRelations = relations(inventoryItems, ({ many }) => ({
  assignments: many(inventoryItemAssignments),
  tags: many(inventoryItemTags),
  numbers: many(inventoryItemNumbers),
  serials: many(inventoryItemSerials),
  lendingItem: many(lendingItems),
  fieldValues: many(inventoryFieldValues),
}));

export const inventoryFieldDefsRelations = relations(inventoryFieldDefs, ({ many }) => ({
  values: many(inventoryFieldValues),
}));

export const inventoryFieldValuesRelations = relations(inventoryFieldValues, ({ one }) => ({
  item: one(inventoryItems, { fields: [inventoryFieldValues.inventoryItemId], references: [inventoryItems.id] }),
  fieldDef: one(inventoryFieldDefs, { fields: [inventoryFieldValues.fieldDefId], references: [inventoryFieldDefs.id] }),
}));

export const lendingItemsRelations = relations(lendingItems, ({ one, many }) => ({
  inventoryItem: one(inventoryItems, { fields: [lendingItems.inventoryItemId], references: [inventoryItems.id] }),
  loans: many(lendingLoans),
  requests: many(loanRequests),
}));

export const lendingLoansRelations = relations(lendingLoans, ({ one }) => ({
  lendingItem: one(lendingItems, { fields: [lendingLoans.lendingItemId], references: [lendingItems.id] }),
  borrower: one(persons, { fields: [lendingLoans.borrowerPersonId], references: [persons.id] }),
}));

export const inventoryItemAssignmentsRelations = relations(inventoryItemAssignments, ({ one }) => ({
  item: one(inventoryItems, { fields: [inventoryItemAssignments.inventoryItemId], references: [inventoryItems.id] }),
  member: one(members, { fields: [inventoryItemAssignments.memberId], references: [members.id] }),
}));

export const inventoryItemTagsRelations = relations(inventoryItemTags, ({ one }) => ({
  item: one(inventoryItems, { fields: [inventoryItemTags.inventoryItemId], references: [inventoryItems.id] }),
}));

export const inventoryItemNumbersRelations = relations(inventoryItemNumbers, ({ one }) => ({
  item: one(inventoryItems, { fields: [inventoryItemNumbers.inventoryItemId], references: [inventoryItems.id] }),
}));

export const inventoryItemSerialsRelations = relations(inventoryItemSerials, ({ one }) => ({
  item: one(inventoryItems, { fields: [inventoryItemSerials.inventoryItemId], references: [inventoryItems.id] }),
}));

export const assignmentsRelations = relations(memberRoleAssignments, ({ one }) => ({
  member: one(members, { fields: [memberRoleAssignments.memberId], references: [members.id] }),
  role: one(memberRoles, { fields: [memberRoleAssignments.memberRoleId], references: [memberRoles.id] }),
}));

export const rolesRelations = relations(memberRoles, ({ many }) => ({
  assignments: many(memberRoleAssignments),
}));

export const eventsRelations = relations(events, ({ many }) => ({
  tags: many(eventTags),
  visibleRoles: many(eventVisibleRoles),
}));

export const eventTagsRelations = relations(eventTags, ({ one }) => ({
  event: one(events, { fields: [eventTags.eventId], references: [events.id] }),
}));

export const eventVisibleRolesRelations = relations(eventVisibleRoles, ({ one }) => ({
  event: one(events, { fields: [eventVisibleRoles.eventId], references: [events.id] }),
  role: one(appRoles, { fields: [eventVisibleRoles.roleId], references: [appRoles.id] }),
}));
/* v8 ignore stop */

export const loanRequestsRelations = relations(loanRequests, ({ one }) => ({
  lendingItem: one(lendingItems, { fields: [loanRequests.lendingItemId], references: [lendingItems.id] }),
  person: one(persons, { fields: [loanRequests.personId], references: [persons.id] }),
}));
