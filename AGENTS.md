# Agent-Hinweise für on-duty

Werkzeugkasten für Wehr und Verein (entstanden bei der Freiwilligen Feuerwehr Altenhammer). Stack: Hono · Hono JSX · HTMX · Tailwind CSS v4 · daisyUI v5 · Drizzle ORM · Better Auth · PostgreSQL.

## UI-Arbeit

Bei allem, was Layout, Farben, Typografie, Tabellen oder Buttons betrifft: [docs/style-guide.md](docs/style-guide.md) befolgen. Der dort definierte Soll-Zustand gilt für neuen Code; bekannte Abweichungen im Bestand sind im Dokument markiert und werden nicht stillschweigend übernommen.

## Beitragen

Siehe [CONTRIBUTING.md](CONTRIBUTING.md).

## Datenbankmigrationen

Migrationen nur mit `pnpm db:generate` (Backfills: `--custom --name=<name>`) erzeugen. `drizzle/meta/_journal.json` und `when`-Werte nie von Hand setzen oder „hochzählen“. Bei Journal-Konflikten und der Ausnahme für Zukunfts-Timestamps: [CONTRIBUTING.md](CONTRIBUTING.md#datenbankmigrationen).

## UI im Browser prüfen (mit Login)

Die App läuft lokal (`pnpm dev`, Port 3000, erreichbar als `https://app.localhost`). Login über OIDC (`auth.localhost`), der Agent hat keine Zugangsdaten.

1. `BrowserReauth` mit der Ziel-URL aufrufen. Es öffnet sich ein Fenster; der Benutzer meldet sich dort an und lässt es offen, bis die Zielseite sichtbar ist.
2. Danach dem Agenten Bescheid geben. Der Agent wechselt mit `BrowserSwitchMode` auf `persistent` (headless) und öffnet die Seite mit `BrowserNewPage`.
3. Die Session liegt im Profil `~/.pi/browser-profile`. Zeigt die Seite wieder den Login, mit Schritt 1 neu anmelden.

Hinweise: Seiten mit `BrowserTakeScreenshot` (Viewport, ggf. vorher per `BrowserEvaluateScript` scrollen) und `BrowserEvaluateScript` (DOM, Links) prüfen. Nach Codeänderungen lädt der Dev-Server neu; die Seite kurz danach neu laden, sonst erscheint noch der alte Stand.
