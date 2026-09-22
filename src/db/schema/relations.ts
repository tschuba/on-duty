import { relations } from "drizzle-orm";
import { members } from "./members.js";
import { memberRoleAssignments, memberRoles } from "./roles.js";

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
