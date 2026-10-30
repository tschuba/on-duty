# Agent-Hinweise für on-duty

Werkzeugkasten für Wehr und Verein (entstanden bei der Freiwilligen Feuerwehr Altenhammer). Stack: Hono · Hono JSX · HTMX · Tailwind CSS v4 · daisyUI v5 · Drizzle ORM · Better Auth · PostgreSQL.

## UI-Arbeit

Bei allem, was Layout, Farben, Typografie, Tabellen oder Buttons betrifft: [docs/style-guide.md](docs/style-guide.md) befolgen. Der dort definierte Soll-Zustand gilt für neuen Code; bekannte Abweichungen im Bestand sind im Dokument markiert und werden nicht stillschweigend übernommen.

## Beitragen

Siehe [CONTRIBUTING.md](CONTRIBUTING.md).

## Datenbankmigrationen

Migrationen nur mit `pnpm db:generate` (Backfills: `--custom --name=<name>`) erzeugen. `drizzle/meta/_journal.json` und `when`-Werte nie von Hand setzen oder „hochzählen“. Bei Journal-Konflikten die eigene Migration samt Snapshot löschen und neu generieren. Details: [CONTRIBUTING.md](CONTRIBUTING.md).
