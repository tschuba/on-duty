import type { FC, PropsWithChildren } from "hono/jsx";
import type { AppUser } from "../auth.js";

type Props = PropsWithChildren<{
  title?: string;
  user?: AppUser;
}>;

export const Layout: FC<Props> = ({ title, children, user }) => (
  <html lang="de">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title ? `${title} · on-duty` : "on-duty"}</title>
      <link rel="stylesheet" href="/css/app.css" />
    </head>
    <body class="bg-base-100 min-h-screen">
      <nav class="navbar bg-base-200 shadow-sm px-4">
        <div class="flex-1">
          <a href="/" class="font-bold text-primary text-lg" style="font-family: var(--font-heading)">
            on-duty
          </a>
        </div>
        {user && (
          <div class="flex-none">
            <div class="dropdown dropdown-end">
              <div tabindex={0} role="button" class="btn btn-ghost btn-sm gap-1">
                <span>{user.name}</span>
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 opacity-60" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>
              </div>
              <ul tabindex={0} class="dropdown-content menu bg-base-200 rounded-box z-10 w-48 p-2 shadow">
                {user.email === "admin@local" && (
                  <li><a href="/admin/password">Passwort ändern</a></li>
                )}
                {user.appRole === "admin" && (
                  <li><a href="/admin">Admin</a></li>
                )}
                <li>
                  <form action="/logout" method="post" class="p-0">
                    <button type="submit" class="w-full text-left px-4 py-2">Abmelden</button>
                  </form>
                </li>
              </ul>
            </div>
          </div>
        )}
      </nav>
      <main class="container mx-auto px-4 py-6">{children}</main>
    </body>
  </html>
);
