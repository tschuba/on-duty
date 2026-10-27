import { readFileSync } from "node:fs";
import type { PropsWithChildren } from "hono/jsx";
import type { AuthedUser } from "../middleware/auth.js";
import { readDsn } from "../lib/sentry.js";
import { t } from "../i18n/index.js";
import { countOpenApplications } from "../lib/applications.js";
import { countOpenReceipts } from "../lib/donations.js";
import { countOverdueInspectionItems } from "../lib/inventory.js";
import { countOpenLoanRequests } from "../lib/lending.js";
import { canReadOrgTab, loadOrgConfig, missingReceiptFields, type OrgTab } from "../lib/org-config.js";
import { countPendingUsers } from "../lib/registration.js";
import { SOURCE_REPO_URL } from "../lib/constants.js";
import { Icon } from "./icon.js";
import { SubNav } from "./sub-nav.js";

// package.json liegt in Dev und im Docker-Image (WORKDIR /app) im cwd.
const APP_VERSION: string = JSON.parse(readFileSync("package.json", "utf8")).version;

type Props = PropsWithChildren<{
  title?: string;
  user?: AuthedUser;
  activeNav?: "members" | "donations" | "admin" | "inventory" | "organisation" | "import";
}>;

export function ClickToEditHint() {
  return <p class="text-sm opacity-50 mb-2">{t("common.rowClickHint")}</p>;
}

// Desktop-Nav: Textlinks, aktive Seite fett + Unterstrich, andere gedämpft.
const navLink = (active: boolean) =>
  `text-sm px-1 py-1 border-b-2 ${active ? "font-semibold border-primary text-base-content" : "border-transparent text-base-content/60 hover:text-base-content"}`;

// Platzhalter: künftige Spender-Zähler (z. B. unvollständige Adressen) hier einrechnen.
export const DONORS_TAB_COUNT = 0;

export function CountBadge({ count }: { count: number }) {
  return count > 0 ? <span class="badge badge-sm badge-warning ml-1">{count}</span> : null;
}

// Async component — hono/jsx resolves Promise children/return values during render,
// so this stays a self-contained addition (only queries when the viewer actually has
// the permission) instead of threading a count prop through every route that renders
// the nav.
export const Layout = async ({ title, children, user, activeNav }: Props) => {
  const canReviewApplications = Boolean(user?.permissions.has("applications:read"));
  const openApplicationsCount = canReviewApplications ? await countOpenApplications() : 0;
  const canIssueReceipts = Boolean(user?.permissions.has("donations:issue-receipts"));
  const openReceiptsCount = canIssueReceipts ? await countOpenReceipts() : 0;
  // Menüpunkt "Spenden" zeigt die Summe der Reiter-Zähler (Spender hat noch keinen).
  const donationsNavCount = openReceiptsCount + DONORS_TAB_COUNT;
  const canSeeOrganisation = ["org:read", "org:write", "org:tax-data:read", "org:tax-data:write"].some((p) => user?.permissions.has(p as never));
  let orgMissingCount = 0;
  if (canSeeOrganisation && user) {
    const missing = missingReceiptFields(await loadOrgConfig());
    orgMissingCount = (["master", "tax"] as OrgTab[]).filter((tab) => canReadOrgTab(user.permissions, tab)).reduce((n, tab) => n + missing[tab].length, 0);
  }
  // "Mitglieder" also serves roles-only users (e.g. the local Administrator): they land on the role pages.
  const membersNavHref = user?.permissions.has("members:read") ? "/members" : user?.permissions.has("member-roles:read") ? "/roles" : user?.permissions.has("member-role-types:read") ? "/role-types" : user?.permissions.has("anniversary-years:read") ? "/anniversary-years" : null;
  const pendingUsersCount = user?.permissions.has("system:admin") ? await countPendingUsers() : 0;
  const canReadInventory = Boolean(user?.permissions.has("inventory:read"));
  const canManageLending = Boolean(user?.permissions.has("lending:manage"));
  const overdueInspectionsCount = (canReadInventory ? await countOverdueInspectionItems() : 0) + (canManageLending ? await countOpenLoanRequests() : 0);

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

      <nav class="navbar bg-base-200 shadow-sm px-4 sticky top-0 z-40 border-b-[3px] border-gold">
        <div class="navbar-start flex-1 items-baseline">
          <a href="/" class="font-bold text-primary text-lg mr-4" style="font-family: var(--font-heading)">
            on-<span class="text-error">duty</span>
          </a>
          {user && (
            <div class="hidden md:flex gap-4 items-baseline">
              {membersNavHref && (
                <a
                  href={membersNavHref}
                  class={navLink(activeNav === "members")}
                >
                  {t("common.nav.members")}
                  <CountBadge count={activeNav === "members" ? 0 : openApplicationsCount} />
                </a>
              )}
              {(user.permissions.has("donations:read") || user.permissions.has("donations:record") || user.permissions.has("donations:issue-receipts")) && (
                <a
                  href="/donations"
                  class={navLink(activeNav === "donations")}
                >
                  {t("common.nav.donations")}
                  <CountBadge count={activeNav === "donations" ? 0 : donationsNavCount} />
                </a>
              )}
              {canReadInventory && (
                <a
                  href="/inventory"
                  class={navLink(activeNav === "inventory")}
                >
                  {t("common.nav.inventory")}
                  <CountBadge count={activeNav === "inventory" ? 0 : overdueInspectionsCount} />
                </a>
              )}
              {canSeeOrganisation && (
                <a
                  href="/organisation"
                  class={navLink(activeNav === "organisation")}
                >
                  {t("common.nav.organisation")}
                  <CountBadge count={activeNav === "organisation" ? 0 : orgMissingCount} />
                </a>
              )}
              {user.permissions.has("import:run") && (
                <a
                  href="/import"
                  class={navLink(activeNav === "import")}
                >
                  {t("common.nav.import")}
                </a>
              )}
              {user.permissions.has("system:admin") && (
                <a
                  href="/admin"
                  class={navLink(activeNav === "admin")}
                >
                  {t("common.nav.admin")}
                  <CountBadge count={activeNav === "admin" ? 0 : pendingUsersCount} />
                </a>
              )}
            </div>
          )}
        </div>
        {user && (
          <div class="navbar-center md:hidden">
            <div class="dropdown dropdown-bottom dropdown-center">
              <div tabindex={0} role="button" class="btn btn-ghost btn-md" aria-label={t("common.nav.menu")}>
                <Icon name="bars-3" class="h-6 w-6 text-gold" />
              </div>
              <ul tabindex={0} class="dropdown-content menu bg-base-200 rounded-box z-50 w-64 p-2 shadow">
                {membersNavHref && <li><a href={membersNavHref} class={activeNav === "members" ? "active" : ""}>{t("common.nav.members")}<CountBadge count={activeNav === "members" ? 0 : openApplicationsCount} /></a></li>}
                {(user.permissions.has("donations:read") || user.permissions.has("donations:record") || user.permissions.has("donations:issue-receipts")) && <li><a href="/donations" class={activeNav === "donations" ? "active" : ""}>{t("common.nav.donations")}<CountBadge count={activeNav === "donations" ? 0 : donationsNavCount} /></a></li>}
                {canReadInventory && <li><a href="/inventory" class={activeNav === "inventory" ? "active" : ""}>{t("common.nav.inventory")}<CountBadge count={activeNav === "inventory" ? 0 : overdueInspectionsCount} /></a></li>}
                {canSeeOrganisation && <li><a href="/organisation" class={activeNav === "organisation" ? "active" : ""}>{t("common.nav.organisation")}<CountBadge count={activeNav === "organisation" ? 0 : orgMissingCount} /></a></li>}
                {user.permissions.has("import:run") && <li><a href="/import" class={activeNav === "import" ? "active" : ""}>{t("common.nav.import")}</a></li>}
                {user.permissions.has("system:admin") && <li><a href="/admin" class={activeNav === "admin" ? "active" : ""}>{t("common.nav.admin")}<CountBadge count={activeNav === "admin" ? 0 : pendingUsersCount} /></a></li>}
              </ul>
            </div>
          </div>
        )}
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
    <script dangerouslySetInnerHTML={{ __html: `(function(){var m=document.cookie.match(/(?:^|; )draft-clear=([^;]*)/);if(m){localStorage.removeItem('member-draft:'+decodeURIComponent(m[1]));document.cookie='draft-clear=; Max-Age=0; path=/';}})();` }} />
    </body>
  </html>
  );
};

export function DonationTabs({ active, openReceiptsCount }: { active: "donations" | "donors"; openReceiptsCount: number }) {
  const tabs = [
    { key: "donations", href: "/donations", count: openReceiptsCount },
    { key: "donors", href: "/donors", count: DONORS_TAB_COUNT },
  ] as const;
  return (
    <SubNav items={tabs.map((tab) => ({ href: tab.href, active: active === tab.key, label: t(`donations.tabs.${tab.key}`), badge: <CountBadge count={tab.count} /> }))} />
  );
}

// Async like Layout: the Applications tab (permission + open count) is resolved here.
export async function MemberTabs({ active, user }: { active: "members" | "anniversaries" | "applications" | "roles" | "roleTypes" | "anniversaryYears"; user: AuthedUser }) {
  const canReviewApplications = user.permissions.has("applications:read");
  const tabs = [
    ...(user.permissions.has("members:read")
      ? [{ key: "members", href: "/members", count: 0 }, { key: "anniversaries", href: "/anniversaries", count: 0 }]
      : []),
    ...(canReviewApplications ? [{ key: "applications", href: "/applications", count: await countOpenApplications() }] : []),
    // Role configuration has its own permission (the /admin/role* routes enforce it too).
    ...(user.permissions.has("member-roles:read") ? [{ key: "roles", href: "/roles", count: 0 }] : []),
    ...(user.permissions.has("member-role-types:read") ? [{ key: "roleTypes", href: "/role-types", count: 0 }] : []),
    // Anniversary-year configuration has its own permission (the /anniversary-years routes enforce it).
    ...(user.permissions.has("anniversary-years:read") ? [{ key: "anniversaryYears", href: "/anniversary-years", count: 0 }] : []),
  ] as const;
  return (
    <SubNav items={tabs.map((tab) => ({ href: tab.href, active: active === tab.key, label: t(`common.nav.${tab.key}` as "common.nav.members"), badge: <CountBadge count={tab.count} /> }))} />
  );
}
