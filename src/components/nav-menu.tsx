import type { Child } from "hono/jsx";
import type { AuthedUser } from "../middleware/auth.js";
import { t } from "../i18n/index.js";
import { env } from "../env.js";
import { Icon } from "./icon.js";
import type { IconName } from "./icon.js";

export type NavCounts = {
  applications: number;
  receipts: number;
  cash: number;
  inspections: number;
  loans: number;
  loanRequests: number;
  events: number;
  org: boolean;
  pendingUsers: number;
  backupProblem: boolean;
};

type Tone = "badge-warning" | "badge-primary" | "badge-error";
type Leaf = { label: string; href: string; show: boolean; count?: number; tip?: string; dot?: boolean; tone?: Tone; alert?: boolean; external?: boolean; icon?: IconName; children?: Leaf[] };
type Group = { icon: IconName; label: string; items: Leaf[] };

export function CountBadge({ count, tone = "badge-warning" }: { count: number; tone?: Tone }) {
  return count > 0 ? <span class={`badge badge-sm ${tone} ml-1`}>{count}</span> : null;
}

// Tooltip im eingeklappten Menü: Gruppenname plus Aufschlüsselung der Zähler.
function groupTip(label: string, items: Leaf[]): string {
  const parts = items.filter((i) => (i.count ?? 0) > 0).map((i) => i.tip ?? `${i.label} ${i.count}`);
  return parts.length ? `${label} · ${parts.join(", ")}` : label;
}

function menuDefinition(user: AuthedUser, c: NavCounts): Group[] {
  const has = (p: string) => user.permissions.has(p as never);
  const any = (...p: string[]) => p.some(has);
  const donations = any("donations:read", "donations:record", "donations:issue-receipts");
  return [
    { icon: "icon-[tabler--calendar]", label: t("common.nav.events"), items: [{ label: t("common.nav.events"), href: "/events", show: true, count: c.events }] },
    { icon: "icon-[tabler--users]", label: t("common.nav.members"), items: [
      { label: t("common.nav.members"), href: "/members", show: any("members:read", "applications:read", "training:read", "member-roles:read", "member-role-types:read"), count: has("applications:read") ? c.applications : 0 },
    ] },
    { icon: "icon-[tabler--cake]", label: t("common.nav.anniversaries"), items: [
      { label: t("common.nav.anniversaries"), href: "/anniversaries", show: any("members:read", "anniversary-years:read") },
    ] },
    { icon: "icon-[tabler--cash]", label: t("common.nav.donations"), items: [
      { label: t("donations.tabs.donations"), href: "/donations", show: donations, count: c.receipts },
    ] },
    { icon: "icon-[tabler--wallet]", label: t("common.nav.cash"), items: [
      { label: t("common.nav.cash"), href: "/cash", show: any("cash:report", "cash:read", "cash:manage"), count: c.cash },
    ] },
    { icon: "icon-[tabler--building-warehouse]", label: t("common.nav.inventory"), items: [
      { label: t("common.nav.inventory"), href: "/inventory", show: has("inventory:read") },
    ] },
    { icon: "icon-[tabler--clipboard-check]", label: t("inventory.tabs.inspections"), items: [
      { label: t("inventory.tabs.inspections"), href: "/inventory/inspections", show: has("inventory:read"), count: c.inspections, tone: "badge-primary" },
    ] },
    { icon: "icon-[tabler--arrows-exchange]", label: t("inventory.tabs.lending"), items: [
      { label: t("inventory.tabs.lending"), href: "/inventory/lending", show: has("lending:read"), count: c.loans + c.loanRequests, tip: [c.loans > 0 && t("common.nav.tip.overdue", { count: c.loans }), c.loanRequests > 0 && t(c.loanRequests === 1 ? "common.nav.tip.request" : "common.nav.tip.requests", { count: c.loanRequests })].filter(Boolean).join(", "), tone: c.loans > 0 ? "badge-error" : "badge-primary" },
    ] },
    { icon: "icon-[tabler--mail]", label: t("mailTemplates.title"), items: [{ label: t("mailTemplates.title"), href: "/mail/templates", show: true }] },
    { icon: "icon-[tabler--building]", label: t("common.nav.organisation"), items: [
      { label: t("common.nav.organisation"), href: "/organisation", show: any("org:read", "org:write", "org:tax-data:read", "org:tax-data:write"), dot: c.org },
    ] },
    { icon: "icon-[tabler--download]", label: t("common.nav.import"), items: [{ label: t("common.nav.import"), href: "/import", show: has("import:run") }] },
  ];
}

function adminItems(user: AuthedUser, c: NavCounts): Leaf[] {
  const has = (p: string) => user.permissions.has(p as never);
  const items: Leaf[] = [
      { icon: "icon-[tabler--user-shield]", label: t("admin.tabs.usersPermissions"), href: "/admin/users", show: has("system:admin"), count: c.pendingUsers },
      { icon: "icon-[tabler--adjustments]", label: t("admin.tabs.config"), href: "/admin/config", show: has("system:admin") },
      { icon: "icon-[tabler--database-export]", label: t("admin.tabs.backup"), href: "/admin/backup", show: has("system:admin"), alert: c.backupProblem },
      { icon: "icon-[tabler--bug]", label: t("admin.tabs.errorTracker"), href: env.ERROR_TRACKER_URL ?? "", show: has("system:admin") && Boolean(env.ERROR_TRACKER_URL), external: true },
    ];
  return items.filter((i) => i.show);
}

const NO_COUNTS: NavCounts = { applications: 0, receipts: 0, cash: 0, inspections: 0, loans: 0, loanRequests: 0, events: 0, org: false, pendingUsers: 0, backupProblem: false };

// Flache Linkliste für die globale Suche; `show` hängt nur an Rechten, daher reichen Null-Zähler.
export function menuLinks(user: AuthedUser): { label: string; href: string; parent?: string; icon: IconName; external?: boolean }[] {
  const out: ReturnType<typeof menuLinks> = [];
  for (const g of menuDefinition(user, NO_COUNTS)) {
    for (const i of g.items.filter((x) => x.show)) {
      out.push({ label: i.label, href: i.href, parent: i.label === g.label ? undefined : g.label, icon: g.icon, external: i.external });
      for (const k of i.children?.filter((x) => x.show) ?? []) out.push({ label: k.label, href: k.href, parent: g.label, icon: g.icon });
    }
  }
  for (const i of adminItems(user, NO_COUNTS)) out.push({ label: i.label, href: i.href, parent: t("common.nav.admin"), icon: i.icon ?? "icon-[tabler--settings]", external: i.external });
  return out;
}

export function adminAlert(user: AuthedUser, c: NavCounts): "error" | "warning" | null {
  if (!adminItems(user, c).length) return null;
  return c.backupProblem ? "error" : c.pendingUsers > 0 ? "warning" : null;
}

// Offene Punkte für das Aufgaben-Menü der Navbar (nur Einträge mit Zähler > 0; Rechte stecken schon in den Zählern).
export function attentionItems(c: NavCounts): { icon: IconName; label: string; href: string; count: number; tone: Tone }[] {
  const all: { icon: IconName; label: string; href: string; count: number; tone: Tone }[] = [
    { icon: "icon-[tabler--calendar]", label: t("common.nav.events"), href: "/events", count: c.events, tone: "badge-warning" },
    { icon: "icon-[tabler--users]", label: t("common.nav.members"), href: "/members", count: c.applications, tone: "badge-warning" },
    { icon: "icon-[tabler--cash]", label: t("donations.tabs.donations"), href: "/donations", count: c.receipts, tone: "badge-warning" },
    { icon: "icon-[tabler--wallet]", label: t("common.nav.cash"), href: "/cash", count: c.cash, tone: "badge-warning" },
    { icon: "icon-[tabler--clipboard-check]", label: t("inventory.tabs.inspections"), href: "/inventory/inspections", count: c.inspections, tone: "badge-primary" },
    { icon: "icon-[tabler--arrows-exchange]", label: t("inventory.tabs.lending"), href: "/inventory/lending", count: c.loans + c.loanRequests, tone: c.loans > 0 ? "badge-error" : "badge-primary" },
    { icon: "icon-[tabler--user-shield]", label: t("admin.tabs.usersPermissions"), href: "/admin/users", count: c.pendingUsers, tone: "badge-warning" },
    { icon: "icon-[tabler--database-export]", label: t("admin.tabs.backup"), href: "/admin/backup", count: c.backupProblem ? 1 : 0, tone: "badge-error" },
  ];
  return all.filter((i) => i.count > 0);
}

// <li>-Einträge für das Benutzermenü (eigener Abschnitt „Administration“).
export function AdminMenuItems({ user, counts }: { user: AuthedUser; counts: NavCounts }) {
  const items = adminItems(user, counts);
  if (!items.length) return null;
  return (<>
    <li class="menu-title mt-1">{t("common.nav.admin")}</li>
    {items.map((i) => (
      <li>
        <a href={i.href} {...(i.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {i.icon && <Icon name={i.icon} class="h-5 w-5" />}
          <span class="flex-1">{i.label}</span>
          {i.external && <Icon name="icon-[tabler--external-link]" class="h-4 w-4 opacity-60" />}
        </a>
      </li>
    ))}
  </>);
}

// Längster passender Pfad-Präfix gewinnt (/inventory/inspections vor /inventory).
export function findActiveHref(hrefs: string[], path: string): string | null {
  let best: string | null = null;
  for (const h of hrefs) if ((path === h || path.startsWith(h + "/")) && (!best || h.length > best.length)) best = h;
  return best;
}

// Inline-Script: Sidebar-Zustand (nur ab lg), Klick auf Icon-Leiste, Suche.
export const NAV_STATE_SCRIPT = `(function(){var c=document.getElementById("nav-drawer");if(!c)return;var lg=matchMedia("(min-width: 1024px)");try{c.checked=lg.matches&&localStorage.getItem("nav-collapsed")!=="1"}catch(e){c.checked=lg.matches}c.addEventListener("change",function(){if(!c.checked)document.querySelectorAll("#nav-menu details[open]").forEach(function(d){d.removeAttribute("open")});if(lg.matches)try{localStorage.setItem("nav-collapsed",c.checked?"0":"1")}catch(e){}})})();`;

export const NAV_SCRIPT = `(function(){
var c=document.getElementById("nav-drawer"),nav=document.getElementById("nav-menu");
if(!c||!nav)return;
var lg=matchMedia("(min-width: 1024px)");
nav.addEventListener("click",function(e){
  if(lg.matches&&!c.checked){
    var s=e.target.closest("summary");
    if(s){e.preventDefault();c.checked=true;c.dispatchEvent(new Event("change"));s.parentNode.open=true}
  }
});
})();`;

export function NavMenu({ user, counts, path }: { user: AuthedUser; counts: NavCounts; path: string }) {
  // Obermenü ohne sichtbare Unterpunkte entfällt, mit genau einem wird zum Link.
  const groups = menuDefinition(user, counts)
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show).map((i) => ({ ...i, children: i.children?.filter((k) => k.show) ?? [] })) }))
    .filter((g) => g.items.length > 0);
  const active = findActiveHref(groups.flatMap((g) => g.items.filter((i) => !i.external).flatMap((i) => [i.href, ...i.children.map((k) => k.href)])), path);
  const lc = (s: string) => s.toLowerCase();

  return (
    <ul id="nav-menu" class="menu w-full grow flex-nowrap gap-1 overflow-auto is-drawer-close:overflow-visible p-2">
      <li class="hidden lg:block mt-1.5">
        <label for="nav-drawer" class="is-drawer-close:tooltip is-drawer-close:tooltip-right" data-tip={t("common.nav.toggleSidebar")} aria-label={t("common.nav.toggleSidebar")}>
          <Icon name="icon-[tabler--layout-sidebar-left-collapse]" class="h-5 w-5 text-gold is-drawer-close:hidden" />
          <Icon name="icon-[tabler--layout-sidebar-left-expand]" class="h-5 w-5 text-gold hidden is-drawer-close:block" />
        </label>
      </li>
      {groups.map((g) => {
        const label = <span class="is-drawer-close:hidden">{g.label}</span>;
        if (g.items.length === 1) {
          const i = g.items[0];
          const isActive = i.href === active;
          return (
            <li data-nav-top data-label={lc(g.label)}>
              <a href={i.href} class={`is-drawer-close:tooltip is-drawer-close:tooltip-right ${isActive ? "menu-active" : ""}`} data-tip={groupTip(g.label, g.items)} data-label={lc(g.label)}>
                <Icon name={g.icon} class="h-5 w-5" />
                {label}
              </a>
            </li>
          );
        }
        const open = g.items.some((i) => i.href === active || i.children.some((k) => k.href === active));
        return (
          <li data-nav-top data-label={lc(g.label)}>
            <details name="nav" data-nav class="group is-drawer-close:overflow-visible" open={open} data-active={open ? "" : undefined}>
              <summary class="is-drawer-close:tooltip is-drawer-close:tooltip-right" data-tip={groupTip(g.label, g.items)}>
                <Icon name={g.icon} class="h-5 w-5" />
                <span class={`is-drawer-close:hidden ${open ? "font-semibold" : ""}`}>{g.label}</span>
              </summary>
              <ul class="is-drawer-close:hidden">
                {g.items.map((i) => {
                  const showKids = i.children.length > 0 && (i.href === active || i.children.some((k) => k.href === active));
                  return (
                    <li data-label={lc([i.label, ...i.children.map((k) => k.label)].join(" "))}>
                      <a href={i.href} class={i.href === active ? "menu-active" : ""} {...(i.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                        {i.label as Child}
                        {i.external && <Icon name="icon-[tabler--external-link]" class="h-4 w-4" />}
                      </a>
                      {showKids && (
                        <ul>
                          {i.children.map((k) => (
                            <li data-label={lc(k.label)}><a href={k.href} class={k.href === active ? "menu-active" : ""}>{k.label}</a></li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
