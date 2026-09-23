import type { FC, PropsWithChildren } from "hono/jsx";
import type { AppUser } from "../auth.js";
import { t } from "../i18n/index.js";

type Props = PropsWithChildren<{
  title?: string;
  user?: AppUser;
  activeNav?: "members" | "anniversaries" | "admin";
}>;

export const Layout: FC<Props> = ({ title, children, user, activeNav }) => (
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

      <nav class="navbar bg-base-200 shadow-sm px-4">
        <div class="navbar-start">
          <a href="/" class="font-bold text-primary text-lg mr-4" style="font-family: var(--font-heading)">
            on-duty
          </a>
          {user && (
            <div class="hidden sm:flex gap-1">
              <a
                href="/members"
                class={`btn btn-ghost btn-sm${activeNav === "members" ? " btn-active" : ""}`}
              >
                {t("common.nav.members")}
              </a>
              <a
                href="/anniversaries"
                class={`btn btn-ghost btn-sm${activeNav === "anniversaries" ? " btn-active" : ""}`}
              >
                {t("common.nav.anniversaries")}
              </a>
              {user.appRole === "admin" && (
                <a
                  href="/admin"
                  class={`btn btn-ghost btn-sm${activeNav === "admin" ? " btn-active" : ""}`}
                >
                  {t("common.nav.admin")}
                </a>
              )}
            </div>
          )}
        </div>
        {user && (
          <div class="navbar-center sm:hidden">
            <div class="dropdown dropdown-bottom dropdown-center">
              <button tabindex={0} class="btn btn-ghost btn-sm">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <ul tabindex={0} class="dropdown-content menu bg-base-200 rounded-box z-50 w-52 p-2 shadow">
                <li><a href="/members" class={activeNav === "members" ? "active" : ""}>{t("common.nav.members")}</a></li>
                <li><a href="/anniversaries" class={activeNav === "anniversaries" ? "active" : ""}>{t("common.nav.anniversaries")}</a></li>
                {user.appRole === "admin" && <li><a href="/admin" class={activeNav === "admin" ? "active" : ""}>{t("common.nav.admin")}</a></li>}
              </ul>
            </div>
          </div>
        )}
        {user && (
          <div class="navbar-end">
            <div class="dropdown dropdown-end">
              <div tabindex={0} role="button" class="btn btn-ghost btn-sm gap-1">
                <span>{user.name}</span>
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 opacity-60" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>
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
          el.className = "alert " + (type === "error" ? "alert-error" : "alert-success") + " shadow-lg";
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
