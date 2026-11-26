import type { IconName } from "../components/icon.js";
import type { t } from "../i18n/index.js";

type Key = Parameters<typeof t>[0];

export type Tip = {
  id: string;
  area: "members" | "mail" | "cash" | "general";
  icon: IconName;
  title: Key;
  text: Key;
  example: Key;
  href: string;
  // Mindestens eines dieser Rechte nötig; leer = jeder eingeloggte Benutzer.
  perms: string[];
};

// Einzige Quelle für „Wusstest du schon?“ (/help/tips) und die Karten auf /help/members.
export const TIPS: Tip[] = [
  { id: "export", area: "members", icon: "icon-[tabler--download]", title: "help.tips.members.export.title", text: "help.tips.members.export.text", example: "help.tips.members.export.example", href: "/members", perms: ["members:read"] },
  { id: "roles", area: "members", icon: "icon-[tabler--calendar-time]", title: "help.tips.members.roles.title", text: "help.tips.members.roles.text", example: "help.tips.members.roles.example", href: "/members?view=roles", perms: ["member-roles:read", "member-role-types:read"] },
  { id: "placeholders", area: "mail", icon: "icon-[tabler--braces]", title: "help.tips.mail.placeholders.title", text: "help.tips.mail.placeholders.text", example: "help.tips.mail.placeholders.example", href: "/mail/templates", perms: [] },
  { id: "optional", area: "mail", icon: "icon-[tabler--eye-off]", title: "help.tips.mail.optional.title", text: "help.tips.mail.optional.text", example: "help.tips.mail.optional.example", href: "/mail/templates", perms: [] },
  { id: "required", area: "mail", icon: "icon-[tabler--list-check]", title: "help.tips.mail.required.title", text: "help.tips.mail.required.text", example: "help.tips.mail.required.example", href: "/mail/templates", perms: [] },
  { id: "send", area: "mail", icon: "icon-[tabler--send]", title: "help.tips.mail.send.title", text: "help.tips.mail.send.text", example: "help.tips.mail.send.example", href: "/mail/templates", perms: ["mail:send", "system:admin"] },
  { id: "anniversaries", area: "members", icon: "icon-[tabler--cake]", title: "help.tips.anniversaries.title", text: "help.tips.anniversaries.text", example: "help.tips.anniversaries.example", href: "/anniversaries", perms: ["members:read", "anniversary-years:read"] },
  { id: "cash-storno", area: "cash", icon: "icon-[tabler--arrow-back-up]", title: "help.tips.cash.storno.title", text: "help.tips.cash.storno.text", example: "help.tips.cash.storno.example", href: "/cash", perms: ["cash:cancel", "cash:manage"] },
  { id: "cash-csv", area: "cash", icon: "icon-[tabler--download]", title: "help.tips.cash.csv.title", text: "help.tips.cash.csv.text", example: "help.tips.cash.csv.example", href: "/cash?view=report", perms: ["cash:read", "cash:manage"] },
  { id: "cash-print", area: "cash", icon: "icon-[tabler--printer]", title: "help.tips.cash.print.title", text: "help.tips.cash.print.text", example: "help.tips.cash.print.example", href: "/cash?view=report", perms: ["cash:report", "cash:read", "cash:manage"] },
  { id: "search", area: "general", icon: "icon-[tabler--search]", title: "help.tips.search.title", text: "help.tips.search.text", example: "help.tips.search.example", href: "/", perms: [] },
];

export function visibleTips(perms: ReadonlySet<string>, area?: Tip["area"][]): Tip[] {
  return TIPS.filter((x) => (!area || area.includes(x.area)) && (x.perms.length === 0 || x.perms.some((p) => perms.has(p))));
}
