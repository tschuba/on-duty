import { readFileSync } from "node:fs";
import type { PropsWithChildren } from "hono/jsx";
import type { AuthedUser } from "../middleware/auth.js";
import { readDsn } from "../lib/sentry.js";
import { t } from "../i18n/index.js";
import { countOpenApplications } from "../lib/applications.js";
import { countOpenReceipts } from "../lib/donations.js";
import { countOverdueInspections } from "../lib/inventory.js";
import { countPendingRsvps } from "../lib/events.js";
import { countOpenLoanRequests, countOverdueLoans } from "../lib/lending.js";
import { canReadOrgTab, loadOrgConfig, loadOrgNameSafe, missingReceiptFields, type OrgTab } from "../lib/org-config.js";
import { countPendingUsers } from "../lib/registration.js";
import { SOURCE_REPO_URL } from "../lib/constants.js";
import { Icon } from "./icon.js";
import { getContext } from "hono/context-storage";
import { getBackupStatus } from "../lib/backup.js";
import { countCashAttention } from "../lib/cash.js";
import { GlobalSearch, GLOBAL_SEARCH_SCRIPT } from "./global-search.js";
import { AdminMenuItems, attentionItems, CountBadge, NavMenu, type NavCounts, NAV_SCRIPT, NAV_STATE_SCRIPT } from "./nav-menu.js";

// package.json liegt in Dev und im Docker-Image (WORKDIR /app) im cwd.
const APP_VERSION: string = JSON.parse(readFileSync("package.json", "utf8")).version;

type Props = PropsWithChildren<{
  title?: string;
  user?: AuthedUser;
  path?: string; // Fallback, wenn kein Hono-Kontext (contextStorage) vorhanden ist
}>;

export function ClickToEditHint() {
  return <p class="text-sm opacity-50 mb-2">{t("common.rowClickHint")}</p>;
}

export { CountBadge };

// Async component — hono/jsx resolves Promise children/return values during render,
// so this stays a self-contained addition (only queries when the viewer actually has
// the permission) instead of threading a count prop through every route that renders
// the nav.
const BusyLamp = () => (
  <span class="busy"><span class="lens"><b /><i /></span><svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M0 100L7 14Q8 6 17 5Q50 -3 83 5Q92 6 93 14L100 100Z" /></svg><span class="foot" /></span>
);

export const Layout = async ({ title, children, user, path }: Props) => {
  const has = (p: string) => Boolean(user?.permissions.has(p as never));
  let reqPath = path ?? "";
  if (!path) { try { reqPath = getContext().req.path; } catch { /* kein Hono-Kontext */ } }
  let counts: NavCounts | undefined;
  if (user) {
    let org = false;
    if (["org:read", "org:write", "org:tax-data:read", "org:tax-data:write"].some(has)) {
      const missing = missingReceiptFields(await loadOrgConfig());
      org = (["master", "tax"] as OrgTab[]).filter((tab) => canReadOrgTab(user.permissions, tab)).some((tab) => missing[tab].length > 0);
    }
    counts = {
      applications: has("applications:read") ? await countOpenApplications() : 0,
      receipts: has("donations:issue-receipts") ? await countOpenReceipts() : 0,
      cash: has("cash:manage") ? await countCashAttention().catch(() => 0) : 0,
      inspections: has("inventory:read") ? await countOverdueInspections() : 0,
      loans: has("lending:read") ? await countOverdueLoans() : 0,
      loanRequests: has("lending:manage") ? await countOpenLoanRequests() : 0,
      events: await countPendingRsvps(user.id).catch(() => 0), // Badge darf die Seite nie brechen
      org,
      pendingUsers: has("system:admin") ? await countPendingUsers() : 0,
      backupProblem: has("system:admin") ? ["failed", "stale"].includes((await getBackupStatus()).state) : false,
    };
  }

  const initials = (user?.name ?? "").trim().split(/\s+/).map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();
  const brand = user ? "on-duty" : (await loadOrgNameSafe()) || "on-duty";

  return (
  <html lang="de">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title ? `${title} · ${brand}` : brand}</title>
      <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}catch(e){}` }} />
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      <link rel="manifest" href="/manifest.webmanifest" />
      <meta name="theme-color" content="#f8f8f8" media="(prefers-color-scheme: light)" />
      <meta name="theme-color" content="#1b222c" media="(prefers-color-scheme: dark)" />
      <meta name="apple-mobile-web-app-title" content="on-duty" />
      <script dangerouslySetInnerHTML={{ __html: `if("serviceWorker"in navigator)addEventListener("load",function(){navigator.serviceWorker.register("/sw.js")})` }} />
      <link rel="stylesheet" href="/css/app.css" />
      <script src="/js/htmx.min.js" />
      <script src="/js/busy.min.js" defer />
      {user && readDsn() && <script src="/js/sentry.min.js" />}
    </head>
    <body class="bg-base-100 min-h-dvh flex flex-col">
      {/* Toast container — filled by HX-Trigger: showToast */}
      <div id="toast-container" class="toast toast-top toast-end z-50" />
      <div id="busy-bar" hidden class="busy-bar" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <svg width="0" height="0" class="absolute" aria-hidden="true"><clipPath id="busy-clip" clipPathUnits="objectBoundingBox"><path d="M0 1L.07 .14Q.08 .06 .17 .05Q.5 -.03 .83 .05Q.92 .06 .93 .14L1 1Z" /></clipPath></svg>

      <div class="drawer lg:drawer-open">
        {user && <><input id="nav-drawer" type="checkbox" autocomplete="off" class="drawer-toggle" aria-label={t("common.nav.toggleSidebar")} /><script dangerouslySetInnerHTML={{ __html: NAV_STATE_SCRIPT }} /></>}
        <div class="drawer-content flex min-h-dvh min-w-0 flex-col">
      <nav class="navbar bg-base-200/80 backdrop-blur shadow-sm px-4 sticky top-0 z-40 border-b border-base-300">
        <div class="navbar-start flex-1 sm:flex-none sm:w-auto items-center">
          {user && (
            <label for="nav-drawer" class="btn btn-ghost btn-square mr-2 lg:hidden" aria-label={t("common.nav.toggleSidebar")}>
              <Icon name="icon-[tabler--menu-2]" class="h-6 w-6 text-gold" />
            </label>
          )}
          <a href="/" class="font-bold text-primary text-lg mr-4" style="font-family: var(--font-heading)">
            {user ? <>on-<span class="text-error">duty</span></> : brand === "on-duty" ? <>on-<span class="text-error">duty</span></> : brand}
          </a>
        </div>
        {user && <div class="flex min-w-0 flex-1 justify-center px-4 max-sm:flex-none max-sm:px-0"><GlobalSearch /></div>}
        {user && (
          <div class="navbar-end w-auto gap-1">
            {counts && (() => { const items = attentionItems(counts); const total = items.reduce((n, i) => n + i.count, 0); return (
              <div class="dropdown dropdown-end max-sm:static">
                <div tabindex={0} role="button" class="btn btn-ghost btn-sm btn-square" aria-label={t("common.nav.attention")} title={t("common.nav.attention")}>
                  <span class="indicator">
                    {total > 0 && <span class={`indicator-item badge badge-xs ${items.some((i) => i.tone === "badge-error") ? "badge-error" : "badge-warning"}`}>{total}</span>}
                    <Icon name="icon-[tabler--bell]" class="h-5 w-5" />
                  </span>
                </div>
                <ul tabindex={0} class="dropdown-content menu bg-base-200 rounded-box z-10 w-[min(18rem,calc(100vw-2rem))] p-2 shadow">
                  <li class="menu-title">{t("common.nav.attention")}</li>
                  {items.length === 0 && <li class="disabled"><span>{t("common.nav.attentionNone")}</span></li>}
                  {items.map((i) => (
                    <li><a href={i.href}><Icon name={i.icon} class="h-5 w-5" /><span class="flex-1">{i.label}</span><CountBadge count={i.count} tone={i.tone} /></a></li>
                  ))}
                </ul>
              </div>
            ); })()}
            <div class="dropdown dropdown-end">
              <div tabindex={0} role="button" class="btn btn-ghost btn-sm gap-1" aria-label={user.name}>
                <span class="flex items-center gap-1.5">
                  <div class="avatar avatar-placeholder">
                    <div class="bg-primary text-primary-content w-7 rounded-full text-xs">
                      <span>{initials}</span>
                    </div>
                  </div>
                  <span class="hidden lg:inline">{user.name}</span>
                  <Icon name="icon-[tabler--chevron-down]" class="h-4 w-4 opacity-60" />
                </span>
              </div>
              <ul tabindex={0} class="dropdown-content menu bg-base-200 rounded-box z-10 w-[min(18rem,calc(100vw-2rem))] p-2 shadow">
                <li class="pointer-events-none mb-1">
                  <div class="flex w-full flex-row items-center gap-3">
                    <div class="avatar avatar-placeholder shrink-0"><div class="bg-primary text-primary-content w-10 rounded-full"><span>{initials}</span></div></div>
                    <div class="min-w-0 flex-1"><div class="truncate font-semibold">{user.name}</div><div class="truncate text-xs opacity-60">{user.email}</div></div>
                  </div>
                </li>
                <li class="m-0 border-t border-base-content/20 p-0" aria-hidden="true" />
                {counts && <AdminMenuItems user={user} counts={counts} />}
                <li class="menu-title mt-1">{t("common.theme")}</li>
                <li class="flex flex-row gap-1 hover:bg-transparent">
                  {([["light", "icon-[tabler--sun]"], ["auto", "icon-[tabler--clock]"], ["dark", "icon-[tabler--moon]"]] as const).map(([m, icon]) => (
                    <button
                      type="button"
                      data-theme-opt={m}
                      title={t(`common.theme.${m}`)}
                      aria-label={t(`common.theme.${m}`)}
                      class="theme-opt flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-field px-1 py-2"
                      onclick={`var m="${m}",d=document.documentElement;try{m==="auto"?(localStorage.removeItem("theme"),delete d.dataset.theme):(localStorage.setItem("theme",m),d.dataset.theme=m)}catch(e){}document.activeElement.blur()`}
                    >
                      <Icon name={icon} class="h-5 w-5" />
                      <span class="text-xs">{t(`common.theme.${m}`)}</span>
                    </button>
                  ))}
                </li>
                <li class="mt-2 border-t border-base-content/20 pt-2">
                  <a href="/account" class="flex w-full items-center gap-2 px-3 py-2"><Icon name="icon-[tabler--user-circle]" class="h-5 w-5" />{t("common.nav.account")}</a>
                </li>
                <li>
                  <form action="/logout" method="post" class="p-0">
                    <button type="submit" class="flex w-full items-center gap-2 px-3 py-2"><Icon name="icon-[tabler--logout]" class="h-5 w-5" />{t("common.logout")}</button>
                  </form>
                </li>
              </ul>
            </div>
          </div>
        )}
        <i class="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-transparent via-gold to-transparent" aria-hidden="true" />
      </nav>
      <div class="relative flex-1 flex flex-col">
        <main id="busy-main" class="container mx-auto px-4 py-6 flex-1 flex flex-col">{children}</main>
        <div id="busy-overlay" hidden data-aborted={t("common.busy.aborted")} data-error={t("common.busy.failed")} class="busy-overlay">
          <div class="busy-center" role="status" aria-label={t("common.busy")}>
            <span class="hl"><BusyLamp /></span>
            <div class="font-medium">{t("common.busy")}</div>
            <button id="busy-cancel" type="button" hidden class="btn btn-sm btn-outline mt-3">{t("common.cancel")}</button>
          </div>
        </div>
      </div>
        <footer class="sticky bottom-0 mt-auto h-6 shrink-0 px-4 flex items-center justify-center gap-3 text-xs text-base-content/40 bg-base-100 pointer-events-none"><a href={SOURCE_REPO_URL} target="_blank" rel="noopener" class="link link-hover pointer-events-auto">{t("common.footer.source")}</a><a href={`${SOURCE_REPO_URL}/releases/tag/v${APP_VERSION}`} target="_blank" rel="noopener" class="link link-hover pointer-events-auto">v{APP_VERSION}</a></footer>
        </div>
        {user && counts && (
          <div class="drawer-side z-50 is-drawer-close:overflow-visible">
            <label for="nav-drawer" aria-label={t("common.nav.toggleSidebar")} class="drawer-overlay" />
            <div class="flex min-h-full flex-col bg-base-200 border-r border-base-300 is-drawer-close:w-14 is-drawer-open:w-64">
              <NavMenu user={user} counts={counts} path={reqPath} />
            </div>
          </div>
        )}
      </div>

      {/* Toast handler + flash cookie reader */}
      <script dangerouslySetInnerHTML={{ __html: `
        function showToast(message, type) {
          const el = document.createElement("div");
          el.className = "alert " + (type === "error" ? "alert-error" : type === "info" ? "alert-info" : "alert-success") + " shadow-lg";
          el.textContent = message;
          const container = document.getElementById("toast-container");
          container.appendChild(el);
          setTimeout(() => el.remove(), 3000);
        }
        document.body.addEventListener("showToast", (e) => showToast(e.detail.message, e.detail.type));
        // flash cookie
        const flash = document.cookie.split(';').find(c => c.trim().startsWith('flash='));
        if (flash) {
          try {
            const { message, type } = JSON.parse(decodeURIComponent(flash.split('=').slice(1).join('=')));
            document.cookie = 'flash=; Max-Age=0; path=/';
            showToast(message, type);
          } catch(e) {}
        }
        // Verwerfen-Button nur bei ungespeicherten Änderungen zeigen
        const toggleDiscard = (f, show) => f && f.id && document.querySelectorAll('[data-discard="' + f.id + '"]').forEach(b => b.classList.toggle("hidden", !show));
        // Geändert = ein Feld weicht vom Ausgangswert (defaultValue/defaultChecked) ab; manuelles Zurücksetzen gilt als unverändert
        const isDirty = (f) => [...f.elements].some(el =>
          el.type === "checkbox" || el.type === "radio" ? el.checked !== el.defaultChecked
          : el.tagName === "SELECT" ? [...el.options].some(o => o.selected !== o.defaultSelected)
          : el.type !== "file" && "defaultValue" in el && el.value !== el.defaultValue);
        const syncDiscard = (e) => { const f = e.target.form; if (f) toggleDiscard(f, isDirty(f)); };
        document.addEventListener("input", syncDiscard);
        document.addEventListener("change", syncDiscard);
        document.addEventListener("reset", (e) => toggleDiscard(e.target, false));
        // Listenfilter pro Pfad merken; Zurück-Links (data-keep-filter) auf die nackte Liste bekommen ihn wieder angehängt
        const saveFilter = () => { try { if (document.querySelector(".filter-bar, [data-page-search], [data-page-filter]")) sessionStorage.setItem("filter:" + location.pathname, location.search); } catch(e) {} };
        saveFilter();
        document.body.addEventListener("htmx:afterSettle", saveFilter);
        document.addEventListener("click", (e) => {
          const a = e.target.closest && e.target.closest("a[data-keep-filter]");
          if (!a || a.search || a.origin !== location.origin || a.pathname === location.pathname || e.defaultPrevented) return;
          try { const s = sessionStorage.getItem("filter:" + a.pathname); if (s) a.search = s; } catch(e) {}
        }, true);
      ` }} />
    {user && <script dangerouslySetInnerHTML={{ __html: NAV_SCRIPT }} />}
    {user && <script dangerouslySetInnerHTML={{ __html: GLOBAL_SEARCH_SCRIPT }} />}
    {/* Pflichtfelder mit Floating Label: der Placeholder ist das einzige sichtbare Label; ein Overlay (unsichtbarer Placeholder-Text + roter Stern) markiert sie auch im leeren Zustand (auch nach htmx-Swaps). */}
    <script dangerouslySetInnerHTML={{ __html: `(function(){function f(r){r.querySelectorAll(".floating-label :is(input,textarea)[placeholder]:not([data-star])").forEach(function(e){if(!e.required&&!e.closest("[data-required]"))return;e.dataset.star="1";var s=document.createElement("b"),i=document.createElement("i");s.className="req-star";s.setAttribute("aria-hidden","true");i.textContent=e.placeholder;s.append(i,"*");e.after(s);function u(){var c=getComputedStyle(e),t=e.tagName==="TEXTAREA";s.style.font=c.font;s.style.left=e.offsetLeft+parseFloat(c.borderLeftWidth)+parseFloat(c.paddingLeft)+"px";s.style.top=e.offsetTop+(t?parseFloat(c.borderTopWidth)+parseFloat(c.paddingTop):0)+"px";s.style.height=t?"auto":e.offsetHeight+"px";s.style.alignItems=t?"flex-start":"center"}u();new ResizeObserver(u).observe(e)})}f(document);document.addEventListener("htmx:load",function(e){f(e.target)})})();` }} />
    <script dangerouslySetInnerHTML={{ __html: `(function(){var m=document.cookie.match(/(?:^|; )draft-clear=([^;]*)/);if(m){localStorage.removeItem('member-draft:'+decodeURIComponent(m[1]));document.cookie='draft-clear=; Max-Age=0; path=/';}})();` }} />
    </body>
  </html>
  );
};
