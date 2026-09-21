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
          <div class="flex-none items-center gap-3 flex">
            <span class="text-sm opacity-60 hidden sm:inline">{user.name}</span>
            <form action="/logout" method="post">
              <button type="submit" class="btn btn-ghost btn-sm">
                Abmelden
              </button>
            </form>
          </div>
        )}
      </nav>
      <main class="container mx-auto px-4 py-6">{children}</main>
    </body>
  </html>
);
