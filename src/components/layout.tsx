import { readFileSync } from "node:fs";
import type { PropsWithChildren } from "hono/jsx";
import type { AuthedUser } from "../middleware/auth.js";
import { readDsn } from "../lib/sentry.js";
import { t } from "../i18n/index.js";
import { countOpenApplications } from "../lib/applications.js";
import { countOpenReceipts } from "../lib/donations.js";
import { countOverdueInspectionItems } from "../lib/inventory.js";
import { countOpenLoanRequests, countOverdueLoans } from "../lib/lending.js";
import { canReadOrgTab, loadOrgConfig, missingReceiptFields, type OrgTab } from "../lib/org-config.js";
import { countPendingUsers } from "../lib/registration.js";
import { SOURCE_REPO_URL } from "../lib/constants.js";
import { Icon } from "./icon.js";
import { getContext } from "hono/context-storage";
import { CountBadge, NavMenu, type NavCounts, NAV_SCRIPT, NAV_STATE_SCRIPT } from "./nav-menu.js";

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

// Platzhalter: künftige Spender-Zähler (z. B. unvollständige Adressen) hier einrechnen.
export const DONORS_TAB_COUNT = 0;

export { CountBadge };

// Async component — hono/jsx resolves Promise children/return values during render,
// so this stays a self-contained addition (only queries when the viewer actually has
// the permission) instead of threading a count prop through every route that renders
// the nav.
export const Layout = async ({ title, children, user, path }: Props) => {
  const has = (p: string) => Boolean(user?.permissions.has(p as never));
  let reqPath = path ?? "";
  if (!path) { try { reqPath = getContext().req.path; } catch { /* kein Hono-Kontext */ } }
  let counts: NavCounts | undefined;
  if (user) {
    let org = 0;
    if (["org:read", "org:write", "org:tax-data:read", "org:tax-data:write"].some(has)) {
      const missing = missingReceiptFields(await loadOrgConfig());
      org = (["master", "tax"] as OrgTab[]).filter((tab) => canReadOrgTab(user.permissions, tab)).reduce((n, tab) => n + missing[tab].length, 0);
    }
    counts = {
      applications: has("applications:read") ? await countOpenApplications() : 0,
      receipts: has("donations:issue-receipts") ? await countOpenReceipts() : 0,
      donors: DONORS_TAB_COUNT,
      inspections: has("inventory:read") ? await countOverdueInspectionItems() : 0,
      loans: has("lending:read") ? await countOverdueLoans() : 0,
      loanRequests: has("lending:manage") ? await countOpenLoanRequests() : 0,
      org,
      pendingUsers: has("system:admin") ? await countPendingUsers() : 0,
    };
  }

  return (
  <html lang="de">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title ? `${title} · on-duty` : "on-duty"}</title>
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
      {user && readDsn() && <script src="/js/sentry.min.js" />}
    </head>
    <body class="bg-base-100 min-h-dvh flex flex-col">
      {/* Toast container — filled by HX-Trigger: showToast */}
      <div id="toast-container" class="toast toast-top toast-end z-50" />

      <div class="drawer lg:drawer-open">
        {user && <><input id="nav-drawer" type="checkbox" autocomplete="off" class="drawer-toggle" aria-label={t("common.nav.toggleSidebar")} /><script dangerouslySetInnerHTML={{ __html: NAV_STATE_SCRIPT }} /></>}
        <div class="drawer-content flex min-h-dvh min-w-0 flex-col">
      <nav class="navbar bg-base-200 shadow-sm px-4 sticky top-0 z-40 border-b-[3px] border-gold">
        <div class="navbar-start flex-1 items-center">
          {user && (
            <label for="nav-drawer" class="btn btn-ghost btn-square mr-2 lg:hidden" aria-label={t("common.nav.toggleSidebar")}>
              <Icon name="bars-3" class="h-6 w-6 text-gold" />
            </label>
          )}
          <a href="/" class="font-bold text-primary text-lg mr-4" style="font-family: var(--font-heading)">
            on-<span class="text-error">duty</span>
          </a>
        </div>
        {user && (
          <div class="navbar-end w-auto">
            <div class="dropdown dropdown-end">
              <div tabindex={0} role="button" class="btn btn-ghost btn-sm gap-1" aria-label={user.name}>
                <div class="avatar avatar-placeholder tooltip tooltip-left lg:hidden" data-tip={user.name}>
                  <div class="bg-primary text-primary-content w-7 rounded-full text-xs">
                    <span>{(user.name ?? "").trim().split(/\s+/).map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
                  </div>
                </div>
                <span class="hidden lg:inline">{user.name}</span>
                <Icon name="chevron-down" class="h-4 w-4 opacity-60" />
              </div>
              <ul tabindex={0} class="dropdown-content menu bg-base-200 rounded-box z-10 w-48 p-2 shadow">
                <li class="menu-title">{t("common.theme")}</li>
                <li class="flex flex-row gap-1 lg:flex-col hover:bg-transparent">
                  {([["auto", "clock"], ["light", "sun"], ["dark", "moon"]] as const).map(([m, icon]) => (
                    <button
                      type="button"
                      data-theme-opt={m}
                      title={t(`common.theme.${m}`)}
                      aria-label={t(`common.theme.${m}`)}
                      class="theme-opt flex flex-1 items-center justify-center gap-2 rounded-field px-3 py-2 lg:w-full lg:flex-none lg:justify-start"
                      onclick={`var m="${m}",d=document.documentElement;try{m==="auto"?(localStorage.removeItem("theme"),delete d.dataset.theme):(localStorage.setItem("theme",m),d.dataset.theme=m)}catch(e){}document.activeElement.blur()`}
                    >
                      <Icon name={icon} class="h-5 w-5" />
                      <span class="hidden lg:inline">{t(`common.theme.${m}`)}</span>
                    </button>
                  ))}
                </li>
                <li class="mt-2 border-t border-base-content/20 pt-2">
                  <a href="/account" class="flex w-full items-center gap-2 px-3 py-2"><Icon name="users" class="h-5 w-5" />{t("common.nav.account")}</a>
                </li>
                <li>
                  <form action="/logout" method="post" class="p-0">
                    <button type="submit" class="flex w-full items-center gap-2 px-3 py-2"><Icon name="arrow-right-start-on-rectangle" class="h-5 w-5" />{t("common.logout")}</button>
                  </form>
                </li>
              </ul>
            </div>
          </div>
        )}
      </nav>
      <main class="container mx-auto px-4 py-6 flex-1 flex flex-col">{children}</main>
        <footer class="sticky bottom-0 mt-auto h-6 shrink-0 px-4 flex items-center justify-end gap-3 text-xs text-base-content/40 bg-base-100 pointer-events-none"><a href={SOURCE_REPO_URL} target="_blank" rel="noopener" class="link link-hover pointer-events-auto">{t("common.footer.source")}</a><a href={`${SOURCE_REPO_URL}/releases/tag/v${APP_VERSION}`} target="_blank" rel="noopener" class="link link-hover pointer-events-auto">v{APP_VERSION}</a></footer>
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
        document.addEventListener("input", (e) => toggleDiscard(e.target.form, true));
        document.addEventListener("change", (e) => toggleDiscard(e.target.form, true));
        document.addEventListener("reset", (e) => toggleDiscard(e.target, false));
        // Höhe der Filterleiste als --filter-h (Monatszeile klebt darunter); sie bricht je nach Breite/Inhalt um
        const filterRO = new ResizeObserver(([en]) => document.documentElement.style.setProperty("--filter-h", en.target.offsetHeight + "px"));
        const watchFilter = () => { filterRO.disconnect(); const f = document.querySelector(".filter-bar"); if (f) filterRO.observe(f); };
        watchFilter();
        document.body.addEventListener("htmx:afterSettle", watchFilter);
        // HTMX spinner: add loading class to triggering element
        document.body.addEventListener("htmx:beforeRequest", (e) => e.detail.elt.classList.add("loading", "loading-spinner"));
        document.body.addEventListener("htmx:afterRequest", (e) => e.detail.elt.classList.remove("loading", "loading-spinner"));
      ` }} />
    {user && <script dangerouslySetInnerHTML={{ __html: NAV_SCRIPT }} />}
    <script dangerouslySetInnerHTML={{ __html: `(function(){var m=document.cookie.match(/(?:^|; )draft-clear=([^;]*)/);if(m){localStorage.removeItem('member-draft:'+decodeURIComponent(m[1]));document.cookie='draft-clear=; Max-Age=0; path=/';}})();` }} />
    </body>
  </html>
  );
};
