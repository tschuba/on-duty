import type { Child } from "hono/jsx";
import type { AuthedUser } from "../middleware/auth.js";
import { t } from "../i18n/index.js";
import { env } from "../env.js";
import { Icon } from "./icon.js";
import type { IconName } from "./icons.generated.js";

export type NavCounts = {
  applications: number;
  receipts: number;
  donors: number;
  inspections: number;
  loans: number;
  loanRequests: number;
  org: number;
  pendingUsers: number;
};

type Tone = "badge-warning" | "badge-primary";
type Leaf = { label: string; href: string; show: boolean; count?: number; tone?: Tone; external?: boolean };
type Group = { icon: IconName; label: string; items: Leaf[] };

export function CountBadge({ count, tone = "badge-warning" }: { count: number; tone?: Tone }) {
  return count > 0 ? <span class={`badge badge-sm ${tone} ml-1`}>{count}</span> : null;
}

function menuDefinition(user: AuthedUser, c: NavCounts): Group[] {
  const has = (p: string) => user.permissions.has(p as never);
  const any = (...p: string[]) => p.some(has);
  const donations = any("donations:read", "donations:record", "donations:issue-receipts");
  return [
    { icon: "calendar-days", label: t("common.nav.events"), items: [{ label: t("common.nav.events"), href: "/events", show: true }] },
    { icon: "users", label: t("common.nav.members"), items: [
      { label: t("common.nav.members"), href: "/members", show: has("members:read") },
      { label: t("common.nav.anniversaries"), href: "/anniversaries", show: has("members:read") },
      { label: t("common.nav.applications"), href: "/applications", show: has("applications:read"), count: c.applications },
      { label: t("common.nav.roles"), href: "/roles", show: has("member-roles:read") },
      { label: t("common.nav.roleTypes"), href: "/role-types", show: has("member-role-types:read") },
      { label: t("common.nav.anniversaryYears"), href: "/anniversary-years", show: has("anniversary-years:read") },
    ] },
    { icon: "banknotes", label: t("common.nav.donations"), items: [
      { label: t("donations.tabs.donations"), href: "/donations", show: donations, count: c.receipts },
      { label: t("donations.tabs.donors"), href: "/donors", show: donations, count: c.donors },
    ] },
    { icon: "archive-box", label: t("common.nav.inventory"), items: [
      { label: t("inventory.tabs.stock"), href: "/inventory", show: has("inventory:read") },
      { label: t("inventory.tabs.inspections"), href: "/inventory/inspections", show: has("inventory:read"), count: c.inspections, tone: "badge-primary" },
      { label: t("inventory.tabs.lending"), href: "/inventory/lending", show: has("lending:read"), count: c.loans, tone: "badge-primary" },
      { label: t("lend.requests.title"), href: "/inventory/requests", show: has("lending:manage"), count: c.loanRequests },
    ] },
    { icon: "building-office", label: t("common.nav.organisation"), items: [
      { label: t("common.nav.organisation"), href: "/organisation", show: any("org:read", "org:write", "org:tax-data:read", "org:tax-data:write"), count: c.org },
    ] },
    { icon: "arrow-down-tray", label: t("common.nav.import"), items: [{ label: t("common.nav.import"), href: "/import", show: has("import:run") }] },
    { icon: "cog-6-tooth", label: t("common.nav.admin"), items: [
      { label: t("admin.tabs.users"), href: "/admin/users", show: has("system:admin"), count: c.pendingUsers },
      { label: t("admin.tabs.permissions"), href: "/admin/permissions", show: has("system:admin") },
      { label: t("admin.tabs.config"), href: "/admin/config", show: has("system:admin") },
      { label: t("admin.tabs.backup"), href: "/admin/backup", show: has("system:admin") },
      { label: t("admin.tabs.errorTracker"), href: env.ERROR_TRACKER_URL ?? "", show: has("system:admin") && Boolean(env.ERROR_TRACKER_URL), external: true },
    ] },
  ];
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
var c=document.getElementById("nav-drawer"),nav=document.getElementById("nav-menu"),q=document.getElementById("nav-search"),none=document.getElementById("nav-none");
if(!c||!nav)return;
var lg=matchMedia("(min-width: 1024px)");
var expand=function(){c.checked=true;c.dispatchEvent(new Event("change"))};
nav.addEventListener("click",function(e){
  if(lg.matches&&!c.checked){
    var s=e.target.closest("summary");
    if(s){e.preventDefault();expand();s.parentNode.open=true}
    else if(e.target.closest("[data-nav-search]")){expand();q.focus()}
  }
});
var groups=nav.querySelectorAll("details[data-nav]");
q.addEventListener("input",function(){
  var v=q.value.trim().toLowerCase(),hits=0;
  groups.forEach(function(d){if(v)d.removeAttribute("name");else d.setAttribute("name","nav")});
  nav.querySelectorAll("[data-nav-top]").forEach(function(top){
    var d=top.querySelector("details[data-nav]"),leaves=top.querySelectorAll("[data-label]"),show=!v;
    if(v){
      var own=top.getAttribute("data-label").indexOf(v)>-1;
      leaves.forEach(function(l){var m=own||l.getAttribute("data-label").indexOf(v)>-1;l.hidden=!m;if(m)show=true});
      if(d)d.open=show;
    }else{
      leaves.forEach(function(l){l.hidden=false});
      if(d)d.open=d.hasAttribute("data-active");
    }
    top.hidden=!show;if(show)hits++;
  });
  none.hidden=!v||hits>0;
});
})();`;

export function NavMenu({ user, counts, path }: { user: AuthedUser; counts: NavCounts; path: string }) {
  // Obermenü ohne sichtbare Unterpunkte entfällt, mit genau einem wird zum Link.
  const groups = menuDefinition(user, counts)
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show) }))
    .filter((g) => g.items.length > 0);
  const active = findActiveHref(groups.flatMap((g) => g.items.filter((i) => !i.external).map((i) => i.href)), path);
  const lc = (s: string) => s.toLowerCase();

  return (
    <ul id="nav-menu" class="menu w-full grow flex-nowrap gap-1 overflow-auto is-drawer-close:overflow-visible p-2">
      <li class="hidden lg:block mt-1.5">
        <label for="nav-drawer" class="is-drawer-close:tooltip is-drawer-close:tooltip-right" data-tip={t("common.nav.toggleSidebar")} aria-label={t("common.nav.toggleSidebar")}>
          <Icon name="bars-3" class="h-5 w-5 text-gold" />
        </label>
      </li>
      <li class="is-drawer-close:hidden">
        <label class="input input-sm flex items-center gap-2">
          <Icon name="magnifying-glass" class="h-4 w-4 opacity-60" />
          <input id="nav-search" type="search" class="grow" placeholder={t("common.nav.search")} aria-label={t("common.nav.search")} autocomplete="off" />
        </label>
      </li>
      <li class="hidden is-drawer-close:block">
        <button type="button" data-nav-search class="is-drawer-close:tooltip is-drawer-close:tooltip-right" data-tip={t("common.nav.search")} aria-label={t("common.nav.search")}>
          <Icon name="magnifying-glass" class="h-5 w-5" />
        </button>
      </li>
      {groups.map((g) => {
        const sum = g.items.reduce((n, i) => n + (i.count ?? 0), 0);
        const label = <span class="is-drawer-close:hidden">{g.label}</span>;
        if (g.items.length === 1) {
          const i = g.items[0];
          const isActive = i.href === active;
          return (
            <li data-nav-top data-label={lc(g.label)}>
              <a href={i.href} class={`is-drawer-close:tooltip is-drawer-close:tooltip-right ${isActive ? "menu-active" : ""}`} data-tip={g.label} data-label={lc(g.label)}>
                <span class="indicator"><Icon name={g.icon} class="h-5 w-5" />{!isActive && sum > 0 && <span class="indicator-item badge badge-warning badge-xs is-drawer-open:hidden" />}</span>
                {label}
                {!isActive && <span class="is-drawer-close:hidden"><CountBadge count={sum} tone={i.tone} /></span>}
              </a>
            </li>
          );
        }
        const open = g.items.some((i) => i.href === active);
        return (
          <li data-nav-top data-label={lc(g.label)}>
            <details name="nav" data-nav open={open} data-active={open ? "" : undefined}>
              <summary class="is-drawer-close:tooltip is-drawer-close:tooltip-right" data-tip={g.label}>
                <span class="indicator"><Icon name={g.icon} class="h-5 w-5" />{!open && sum > 0 && <span class="indicator-item badge badge-warning badge-xs is-drawer-open:hidden" />}</span>
                <span class={`is-drawer-close:hidden ${open ? "font-semibold" : ""}`}>{g.label}</span>
                {!open && <span class="is-drawer-close:hidden"><CountBadge count={sum} /></span>}
              </summary>
              <ul class="is-drawer-close:hidden">
                {g.items.map((i) => (
                  <li data-label={lc(i.label)}>
                    <a href={i.href} class={i.href === active ? "menu-active" : ""} {...(i.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                      {i.label as Child}
                      {i.external && <Icon name="arrow-top-right-on-square" class="h-4 w-4" />}
                      <CountBadge count={i.count ?? 0} tone={i.tone} />
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        );
      })}
      <li id="nav-none" hidden class="px-3 py-2 text-sm opacity-60 is-drawer-close:hidden">{t("common.nav.noResults")}</li>
    </ul>
  );
}
