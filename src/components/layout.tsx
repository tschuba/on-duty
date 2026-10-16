import type { PropsWithChildren } from "hono/jsx";
import type { AuthedUser } from "../middleware/auth.js";
import { t } from "../i18n/index.js";
import { countOpenApplications } from "../lib/applications.js";
import { countOverdueInspectionItems } from "../lib/inventory.js";
import { Icon } from "./icon.js";

type Props = PropsWithChildren<{
  title?: string;
  user?: AuthedUser;
  activeNav?: "members" | "anniversaries" | "donations" | "donors" | "admin" | "applications" | "inventory" | "organisation";
}>;

export function ClickToEditHint() {
  return <p class="text-sm opacity-50 mb-2">{t("common.rowClickHint")}</p>;
}

// Desktop-Nav: Textlinks, aktive Seite fett + Unterstrich, andere gedämpft.
const navLink = (active: boolean) =>
  `text-sm px-1 py-1 border-b-2 ${active ? "font-semibold border-primary text-base-content" : "border-transparent text-base-content/60 hover:text-base-content"}`;

function ApplicationsBadge({ count }: { count: number }) {
  return count > 0 ? <span class="badge badge-sm badge-primary ml-1">{count}</span> : null;
}

function OverdueInspectionsBadge({ count }: { count: number }) {
  return count > 0 ? <span class="badge badge-sm badge-primary ml-1">{count}</span> : null;
}

// Async component — hono/jsx resolves Promise children/return values during render,
// so this stays a self-contained addition (only queries when the viewer actually has
// the permission) instead of threading a count prop through every route that renders
// the nav.
export const Layout = async ({ title, children, user, activeNav }: Props) => {
  const canReviewApplications = Boolean(user?.permissions.has("applications:review"));
  const openApplicationsCount = canReviewApplications ? await countOpenApplications() : 0;
  const canSeeOrganisation = ["org:read", "org:write", "org:tax-data:read", "org:tax-data:write"].some((p) => user?.permissions.has(p as never));
  const canReadInventory = Boolean(user?.permissions.has("inventory:read"));
  const overdueInspectionsCount = canReadInventory ? await countOverdueInspectionItems() : 0;

  return (
  <html lang="de">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title ? `${title} · on-duty` : "on-duty"}</title>
      <link rel="stylesheet" href="/css/app.css" />
      <script src="/js/htmx.min.js" />
    </head>
    <body class="bg-base-100 min-h-screen">
      {/* Toast container — filled by HX-Trigger: showToast */}
      <div id="toast-container" class="toast toast-top toast-end z-50" />

      <nav class="navbar bg-base-200 shadow-sm px-4 border-b-[3px] border-gold">
        <div class="navbar-start flex-1">
          <a href="/" class="font-bold text-primary text-lg mr-4" style="font-family: var(--font-heading)">
            on-duty
          </a>
          {user && (
            <div class="hidden xl:flex gap-4 items-center">
              <a
                href="/members"
                class={navLink(activeNav === "members")}
              >
                {t("common.nav.members")}
              </a>
              <a
                href="/anniversaries"
                class={navLink(activeNav === "anniversaries")}
              >
                {t("common.nav.anniversaries")}
              </a>
              {canReviewApplications && (
                <a
                  href="/applications"
                  class={navLink(activeNav === "applications")}
                >
                  {t("common.nav.applications")}
                  <ApplicationsBadge count={openApplicationsCount} />
                </a>
              )}
              {(user.permissions.has("donations:record") || user.permissions.has("donations:issue-receipts")) && (
                <a
                  href="/donations"
                  class={navLink(activeNav === "donations")}
                >
                  {t("common.nav.donations")}
                </a>
              )}
              {(user.permissions.has("donations:record") || user.permissions.has("donations:issue-receipts")) && (
                <a
                  href="/donors"
                  class={navLink(activeNav === "donors")}
                >
                  {t("common.nav.donors")}
                </a>
              )}
              {canReadInventory && (
                <a
                  href="/inventory"
                  class={navLink(activeNav === "inventory")}
                >
                  {t("common.nav.inventory")}
                  <OverdueInspectionsBadge count={overdueInspectionsCount} />
                </a>
              )}
              {canSeeOrganisation && (
                <a
                  href="/organisation"
                  class={navLink(activeNav === "organisation")}
                >
                  {t("common.nav.organisation")}
                </a>
              )}
              {user.permissions.has("system:admin") && (
                <a
                  href="/admin"
                  class={navLink(activeNav === "admin")}
                >
                  {t("common.nav.admin")}
                </a>
              )}
            </div>
          )}
        </div>
        {user && (
          <div class="navbar-center xl:hidden">
            <div class="dropdown dropdown-bottom dropdown-center">
              <button tabindex={0} class="btn btn-ghost btn-sm">
                <Icon name="bars-3" class="h-5 w-5 text-gold" />
              </button>
              <ul tabindex={0} class="dropdown-content menu bg-base-200 rounded-box z-50 w-52 p-2 shadow">
                <li><a href="/members" class={activeNav === "members" ? "active" : ""}>{t("common.nav.members")}</a></li>
                <li><a href="/anniversaries" class={activeNav === "anniversaries" ? "active" : ""}>{t("common.nav.anniversaries")}</a></li>
                {canReviewApplications && <li><a href="/applications" class={activeNav === "applications" ? "active" : ""}>{t("common.nav.applications")}<ApplicationsBadge count={openApplicationsCount} /></a></li>}
                {(user.permissions.has("donations:record") || user.permissions.has("donations:issue-receipts")) && <li><a href="/donations" class={activeNav === "donations" ? "active" : ""}>{t("common.nav.donations")}</a></li>}
                {(user.permissions.has("donations:record") || user.permissions.has("donations:issue-receipts")) && <li><a href="/donors" class={activeNav === "donors" ? "active" : ""}>{t("common.nav.donors")}</a></li>}
                {canReadInventory && <li><a href="/inventory" class={activeNav === "inventory" ? "active" : ""}>{t("common.nav.inventory")}<OverdueInspectionsBadge count={overdueInspectionsCount} /></a></li>}
                {canSeeOrganisation && <li><a href="/organisation" class={activeNav === "organisation" ? "active" : ""}>{t("common.nav.organisation")}</a></li>}
                {user.permissions.has("system:admin") && <li><a href="/admin" class={activeNav === "admin" ? "active" : ""}>{t("common.nav.admin")}</a></li>}
              </ul>
            </div>
          </div>
        )}
        {user && (
          <div class="navbar-end w-auto">
            <div class="dropdown dropdown-end">
              <div tabindex={0} role="button" class="btn btn-ghost btn-sm gap-1">
                <span>{user.name}</span>
                <Icon name="chevron-down" class="h-4 w-4 opacity-60" />
              </div>
              <ul tabindex={0} class="dropdown-content menu bg-base-200 rounded-box z-10 w-48 p-2 shadow">
                <li>
                  <form action="/logout" method="post" class="p-0">
                    <button type="submit" class="w-full text-left px-4 py-2">{t("common.logout")}</button>
                  </form>
                </li>
              </ul>
            </div>
          </div>
        )}
      </nav>
      <main class="container mx-auto px-4 py-6">{children}</main>

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
        // HTMX spinner: add loading class to triggering element
        document.body.addEventListener("htmx:beforeRequest", (e) => e.detail.elt.classList.add("loading", "loading-spinner"));
        document.body.addEventListener("htmx:afterRequest", (e) => e.detail.elt.classList.remove("loading", "loading-spinner"));
      ` }} />
    </body>
  </html>
  );
};
