import { t } from "../i18n/index.js";
import { groupPermissionsForBadges, type Permission } from "../lib/roles.js";

export const PERMISSION_LABELS: Record<Permission, string> = {
  "members:read": t("admin.permissions.key.membersRead"),
  "members:write": t("admin.permissions.key.membersWrite"),
  "members:delete": t("admin.permissions.key.membersDelete"),
  "members:bank-data:read": t("admin.permissions.key.membersBankDataRead"),
  "members:bank-data:write": t("admin.permissions.key.membersBankDataWrite"),
  "system:admin": t("admin.permissions.key.systemAdmin"),
  "donations:read": t("admin.permissions.key.donationsRead"),
  "donations:record": t("admin.permissions.key.donationsRecord"),
  "donations:delete": t("admin.permissions.key.donationsDelete"),
  "donations:issue-receipts": t("admin.permissions.key.donationsIssueReceipts"),
  "applications:read": t("admin.permissions.key.applicationsRead"),
  "applications:record": t("admin.permissions.key.applicationsRecord"),
  "applications:review": t("admin.permissions.key.applicationsReview"),
  "applications:manage-forms": t("admin.permissions.key.applicationsManageForms"),
  "inventory:read": t("admin.permissions.key.inventoryRead"),
  "inventory:manage": t("admin.permissions.key.inventoryManage"),
  "lending:read": t("admin.permissions.key.lendingRead"),
  "lending:manage": t("admin.permissions.key.lendingManage"),
  "org:read": t("admin.permissions.key.orgRead"),
  "org:write": t("admin.permissions.key.orgWrite"),
  "org:tax-data:read": t("admin.permissions.key.orgTaxDataRead"),
  "org:tax-data:write": t("admin.permissions.key.orgTaxDataWrite"),
  "import:run": t("admin.permissions.key.importRun"),
  "member-roles:read": t("admin.permissions.key.memberRolesRead"),
  "member-roles:write": t("admin.permissions.key.memberRolesWrite"),
  "member-roles:delete": t("admin.permissions.key.memberRolesDelete"),
  "member-role-types:read": t("admin.permissions.key.memberRoleTypesRead"),
  "member-role-types:write": t("admin.permissions.key.memberRoleTypesWrite"),
  "member-role-types:delete": t("admin.permissions.key.memberRoleTypesDelete"),
  "anniversary-years:read": t("admin.permissions.key.anniversaryYearsRead"),
  "anniversary-years:write": t("admin.permissions.key.anniversaryYearsWrite"),
  "anniversary-years:delete": t("admin.permissions.key.anniversaryYearsDelete"),
};

export const RESOURCE_LABELS: Record<string, string> = {
  members: t("admin.permissions.resource.members"),
  system: t("admin.permissions.resource.system"),
  donations: t("admin.permissions.resource.donations"),
  applications: t("admin.permissions.resource.applications"),
  inventory: t("admin.permissions.resource.inventory"),
  lending: t("admin.permissions.resource.lending"),
  org: t("admin.permissions.resource.org"),
  "anniversary-years": t("admin.permissions.resource.anniversary-years"),
  "member-roles": t("admin.permissions.resource.member-roles"),
  "member-role-types": t("admin.permissions.resource.member-role-types"),
};

export function PermissionBadges({ permissions }: { permissions: Permission[] }) {
  return (
    <div class="flex flex-wrap gap-1">
      {groupPermissionsForBadges(permissions).map((g) => {
        if (g.kind === "full") {
          return (
            <span key="full" class="badge badge-primary badge-sm whitespace-nowrap">
              {t("admin.permissions.badge.full")}
            </span>
          );
        }
        if (g.kind === "resource-full") {
          return (
            <span key={g.resource} class="badge badge-outline badge-primary badge-sm whitespace-nowrap">
              {t("admin.permissions.badge.resourceFull", { resource: RESOURCE_LABELS[g.resource] ?? g.resource })}
            </span>
          );
        }
        return (
          <span key={g.permission} class="badge badge-outline badge-sm whitespace-nowrap">
            {PERMISSION_LABELS[g.permission]}
          </span>
        );
      })}
    </div>
  );
}
