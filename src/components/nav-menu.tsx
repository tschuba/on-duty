import type { Child } from "hono/jsx";
import type { AuthedUser } from "../middleware/auth.js";
import { t } from "../i18n/index.js";
import { env } from "../env.js";
import { Icon } from "./icon.js";
import type { IconName } from "./icon.js";

export type NavCounts = {
  applications: number;
  receipts: number;
  inspections: number;
  loans: number;
  loanRequests: number;
  events: number;
  org: boolean;
  pendingUsers: number;
};

type Tone = "badge-warning" | "badge-primary" | "badge-error";
type Leaf = { label: string; href: string; show: boolean; count?: number; tip?: string; dot?: boolean; tone?: Tone; external?: boolean; children?: Leaf[] };
type Group = { icon: IconName; label: string; items: Leaf[] };

export function CountBadge({ count, tone = "badge-warning" }: { count: number; tone?: Tone }) {
  return count > 0 ? <span class={`badge badge-sm ${tone} ml-1`}>{count}</span> : null;
}

function DotBadge() {
  const label = t("common.nav.organisationIncomplete");
  return <span class="badge badge-warning badge-xs ml-1" title={label} aria-label={label} role="img" />;
}

// Zahl nur bei Zählerpunkten (Summe inkl. 1 je Punkt), sonst nur der Punkt.
// Gruppe ohne eigenen Ton: Rot, sobald ein Eintrag mit Zähler rot ist.
function groupTone(items: Leaf[], tone?: Tone): Tone | undefined {
  return tone ?? (items.some((i) => (i.count ?? 0) > 0 && i.tone === "badge-error") ? "badge-error" : undefined);
}

// Tooltip im eingeklappten Menü: Gruppenname plus Aufschlüsselung der Zähler.
function groupTip(label: string, items: Leaf[]): string {
  const parts = items.filter((i) => (i.count ?? 0) > 0).map((i) => i.tip ?? `${i.label} ${i.count}`);
  return parts.length ? `${label} · ${parts.join(", ")}` : label;
}

function GroupBadge({ items, tone }: { items: Leaf[]; tone?: Tone }) {
  const counted = items.reduce((n, i) => n + (i.count ?? 0), 0);
  const dots = items.filter((i) => i.dot).length;
  return counted > 0 ? <CountBadge count={counted + dots} tone={groupTone(items, tone)} /> : dots > 0 ? <DotBadge /> : null;
}

function menuDefinition(user: AuthedUser, c: NavCounts): Group[] {
  const has = (p: string) => user.permissions.has(p as never);
  const any = (...p: string[]) => p.some(has);
  const donations = any("donations:read", "donations:record", "donations:issue-receipts");
  return [
    { icon: "icon-[tabler--calendar]", label: t("common.nav.events"), items: [{ label: t("common.nav.events"), href: "/events", show: true, count: c.events }] },
    { icon: "icon-[tabler--users]", label: t("common.nav.members"), items: [
      { label: t("common.nav.members"), href: "/members", show: any("members:read", "applications:read"), count: has("applications:read") ? c.applications : 0 },
      { label: t("common.nav.anniversaries"), href: "/anniversaries", show: any("members:read", "anniversary-years:read") },
      { label: t("common.nav.training"), href: "/training", show: has("training:read") },
      { label: t("common.nav.roles"), href: "/roles", show: any("member-roles:read", "member-role-types:read") },
    ] },
    { icon: "icon-[tabler--cash]", label: t("common.nav.donations"), items: [
      { label: t("donations.tabs.donations"), href: "/donations", show: donations, count: c.receipts },
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
    { icon: "icon-[tabler--building]", label: t("common.nav.organisation"), items: [
      { label: t("common.nav.organisation"), href: "/organisation", show: any("org:read", "org:write", "org:tax-data:read", "org:tax-data:write"), dot: c.org },
    ] },
    { icon: "icon-[tabler--mail]", label: t("mailTemplates.title"), items: [{ label: t("mailTemplates.title"), href: "/mail/templates", show: true }] },
    { icon: "icon-[tabler--download]", label: t("common.nav.import"), items: [{ label: t("common.nav.import"), href: "/import", show: has("import:run") }] },
    { icon: "icon-[tabler--settings]", label: t("common.nav.admin"), items: [
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
      <li class="is-drawer-close:hidden">
        <label class="input input-sm flex items-center gap-2">
          <Icon name="icon-[tabler--search]" class="h-4 w-4 opacity-60" />
          <input id="nav-search" type="search" class="grow" placeholder={t("common.nav.search")} aria-label={t("common.nav.search")} autocomplete="off" />
        </label>
      </li>
      <li class="hidden is-drawer-close:block">
        <button type="button" data-nav-search class="is-drawer-close:tooltip is-drawer-close:tooltip-right" data-tip={t("common.nav.search")} aria-label={t("common.nav.search")}>
          <Icon name="icon-[tabler--search]" class="h-5 w-5" />
        </button>
      </li>
      {groups.map((g) => {
        const sum = g.items.reduce((n, i) => n + (i.count ?? 0) + (i.dot ? 1 : 0), 0);
        const label = <span class="is-drawer-close:hidden">{g.label}</span>;
        if (g.items.length === 1) {
          const i = g.items[0];
          const isActive = i.href === active;
          return (
            <li data-nav-top data-label={lc(g.label)}>
              <a href={i.href} class={`is-drawer-close:tooltip is-drawer-close:tooltip-right ${isActive ? "menu-active" : ""}`} data-tip={groupTip(g.label, g.items)} data-label={lc(g.label)}>
                <span class="indicator"><Icon name={g.icon} class="h-5 w-5" />{sum > 0 && <span class={`indicator-item badge ${groupTone(g.items) ?? "badge-warning"} badge-xs is-drawer-open:hidden`} />}</span>
                {label}
                {!isActive && <span class="is-drawer-close:hidden"><GroupBadge items={g.items} tone={i.tone} /></span>}
              </a>
            </li>
          );
        }
        const open = g.items.some((i) => i.href === active || i.children.some((k) => k.href === active));
        return (
          <li data-nav-top data-label={lc(g.label)}>
            <details name="nav" data-nav class="group is-drawer-close:overflow-visible" open={open} data-active={open ? "" : undefined}>
              <summary class="is-drawer-close:tooltip is-drawer-close:tooltip-right" data-tip={groupTip(g.label, g.items)}>
                <span class="indicator"><Icon name={g.icon} class="h-5 w-5" />{sum > 0 && <span class={`indicator-item badge ${groupTone(g.items) ?? "badge-warning"} badge-xs is-drawer-open:hidden`} />}</span>
                <span class={`is-drawer-close:hidden ${open ? "font-semibold" : ""}`}>{g.label}</span>
                <span class="order-2 is-drawer-close:hidden group-open:hidden"><GroupBadge items={g.items} /></span>
              </summary>
              <ul class="is-drawer-close:hidden">
                {g.items.map((i) => {
                  const showKids = i.children.length > 0 && (i.href === active || i.children.some((k) => k.href === active));
                  return (
                    <li data-label={lc([i.label, ...i.children.map((k) => k.label)].join(" "))}>
                      <a href={i.href} class={i.href === active ? "menu-active" : ""} {...(i.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                        {i.label as Child}
                        {i.external && <Icon name="icon-[tabler--external-link]" class="h-4 w-4" />}
                        {i.href === active ? null : i.dot ? <DotBadge /> : <CountBadge count={i.count ?? 0} tone={i.tone} />}
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
      <li id="nav-none" hidden class="px-3 py-2 text-sm opacity-60 is-drawer-close:hidden">{t("common.nav.noResults")}</li>
    </ul>
  );
}
