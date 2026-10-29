# on-duty

Werkzeugkasten für Wehr und Verein: Mitglieder, Ausrüstung und mehr.
Entstanden bei und im Einsatz für die Freiwillige Feuerwehr Altenhammer.

## Funktionen

- Mitglieder
- Inventar und Ausleihe
- Spenden und Spender
- Jubiläen
- Veranstaltungskalender

**Stack:** Hono · HTMX · Tailwind v4 · daisyUI v5 · Drizzle ORM · Better Auth · PostgreSQL · Docker

---

## Konfiguration

- [OIDC-Provider konfigurieren](docs/oidc.md)
- [Backup-Überwachung](docs/backup.md)
- [Standalone-Deployment (App + DB + OIDC, ohne Coolify)](docs/standalone-deployment.md)
- [GitHub-Repository konfigurieren](docs/github-setup.md)
- Impressum für öffentliche Seiten: Unter „Organisation → Stammdaten“ Name, Anschrift, E-Mail und vertretungsberechtigte Person (Pflicht, § 5 DDG) sowie optional Telefon und Registergericht/-nummer pflegen. Erst dann ist `/impressum` erreichbar und wird von Anträgen, Verleih und öffentlichem Kalender verlinkt.

## Deployment (Docker)

**Voraussetzungen:** Docker + Docker Compose

```bash
# 1. Repository klonen
git clone <repo-url> on-duty && cd on-duty

# 2. Umgebungsvariablen anlegen
cp .env.example .env
# .env öffnen und alle Pflichtfelder setzen (siehe Tabelle unten)
# Wichtig: DATABASE_URL muss den Hostnamen "db" verwenden:
#   DATABASE_URL=postgresql://onduty:<password>@db:5432/onduty
# POSTGRES_PASSWORD in .env ergänzen (für den DB-Container)

# 3. Image bauen und Container starten
docker compose -f docker-compose.prod.yml up -d --build

# 4. Migrationen ausführen (einmalig nach erstem Start)
docker compose -f docker-compose.prod.yml exec app node -e \
  "import('./dist/index.js')" 2>/dev/null || true
docker compose -f docker-compose.prod.yml exec app \
  sh -c "node --import=tsx/esm node_modules/.bin/drizzle-kit migrate"
```

> **Migrationen:** Da `drizzle-kit` ein Dev-Tool ist, empfiehlt sich das einmalige Ausführen von `pnpm db:migrate` lokal gegen die Produktionsdatenbank (via `DATABASE_URL`) oder ein separater Init-Container.

> **Backup:** `docker-compose.prod.yml` enthält einen `backup`-Service; on-duty zeigt dessen Status unter `/admin/backup` ([Details](docs/backup.md)).

---

## Lokale Entwicklung

**Voraussetzungen:** Node.js 22, pnpm, Docker

```bash
# 1. Abhängigkeiten installieren (kopiert auch Fonts nach public/fonts/)
pnpm install

# 2. Dev-Stack starten (DB, Zitadel, Caddy; erzeugt .env.dev-stack, migriert die DB)
pnpm stack:up          # optional mit Bugsink: pnpm stack:up:errors

# 3. Einmalig pro Rechner: lokale CA im System vertrauen (fragt nach dem Admin-Passwort), Browser neu starten
pnpm stack:trust

# 4. Entwicklungsserver starten (lädt .env.dev-stack automatisch)
pnpm dev
# → https://app.localhost

# Aufräumen: pnpm stack:down · alles löschen inkl. Volumes: pnpm stack:reset (CA bleibt; `stack:reset --ca` entfernt auch sie)
```

## Als App installieren

on-duty ist eine installierbare Web-App (PWA); ohne Netz zeigt sie nur eine Offline-Seite, Daten werden nie gecacht.
Android (Chrome): Menü → „Zum Startbildschirm hinzufügen“ · iOS (Safari): Teilen → „Zum Home-Bildschirm“.

## Scripts

| Befehl | Beschreibung |
|---|---|
| `pnpm dev` | Dev-Server + Tailwind watch (parallel) |
| `pnpm build` | TypeScript kompilieren + CSS minifizieren |
| `pnpm db:generate` | Drizzle-Migration aus Schema generieren |
| `pnpm db:migrate` | Migrationen ausführen |
| `pnpm db:seed` | Admin-Account anlegen (idempotent) |
| `pnpm stack:up` / `stack:down` / `stack:reset` / `stack:trust` | Dev-Stack (Docker) starten / stoppen / komplett löschen / lokale CA im System vertrauen — Details: [docs/standalone-deployment.md](docs/standalone-deployment.md#dev-stack-im-host-modus) |
| `pnpm db:setup` | Migrate + Seed (Ersteinrichtung) |
| `pnpm db:studio` | Drizzle Studio öffnen |
| `pnpm ops:pseudonym <userId>` | Nutzer-Pseudonym (16 Hex, HMAC mit `BETTER_AUTH_SECRET`) berechnen, um „Seite ist langsam“-Meldungen in Logs/Traces einem Nutzer zuzuordnen. Rotation des Secrets ändert alle Pseudonyme |

## Umgebungsvariablen

Alle Variablen in `.env` (Vorlage: `.env.example`).

| Variable | Pflicht | Standard | Beschreibung |
|---|---|---|---|
| `DATABASE_URL` | ✓ | — | PostgreSQL-Verbindungs-URL |
| `ORG_NAME` | ✓ | — | Organisationsname (z. B. für Export-Dateinamen) |
| `ADMIN_PASSWORD` | ✓ | — | Passwort des lokalen Admin-Accounts |
| `BETTER_AUTH_SECRET` | ✓ | — | Zufälliger Secret für Session-Signaturen (`openssl rand -hex 32`) |
| `OIDC_PROVIDER` | ✓ | — | OIDC-Issuer-URL (HTTPS) |
| `OIDC_CLIENT_ID` | ✓ | — | OAuth2-Client-ID |
| `OIDC_CLIENT_SECRET` | ✓ | — | OAuth2-Client-Secret |
| `OIDC_APP_URL` | ✓ | — | Eigene App-URL für Redirect-URI (HTTPS) |
| `APP_TIMEZONE` | — | `Europe/Berlin` | Feste Zeitzone für Termine (IANA-Name); Ein- und Ausgabe erfolgen immer in dieser Zone |
| `EVENTS_PUBLIC_INDEXING` | — | `false` | `true`: öffentliche Terminseite `/events/public` darf von Suchmaschinen indexiert werden (sonst `X-Robots-Tag: noindex`) |
| `SESSION_LIFETIME` | — | `7d` | Session-Dauer (z. B. `7d`, `8h`, `30m`) |
| `CHILDREN_AGE_LIMIT` | — | `12` | Altersgrenze Kinderfeuerwehr (Jahre, muss < `YOUTH_AGE_LIMIT`) |
| `REGISTRATION_ENABLED` | — | `false` | Startwert: Selbstregistrierung aktiv (`true`/`false`); wird nur einmalig übernommen, solange die Einstellung noch nie gespeichert wurde |
| `REGISTRATION_AUTO_APPROVE` | — | `false` | Startwert (einmalig): Registrierungen automatisch freigeben (braucht `REGISTRATION_DEFAULT_ROLE_ID`) |
| `REGISTRATION_DEFAULT_ROLE_ID` | — | — | Startwert (einmalig): Rollen-ID für automatisch freigegebene Nutzer |
| `YOUTH_AGE_LIMIT` | — | `18` | Altersgrenze Jugendfeuerwehr (Jahre) |
| `ANNIVERSARY_CUTOFF` | — | `01-06` | Ehrungstermin für Jubiläen (MM-DD) |
| `BACKUP_STATUS_FILE` | — | — | Pfad zur `status.json` des Backup-Containers (leer = Überwachung aus) |
| `BACKUP_STATUS_MAX_AGE_HOURS` | — | `26` | Nach so vielen Stunden ohne erfolgreiches Backup wird gewarnt |
| `SMTP_HOST` | — | — | SMTP-Server für E-Mail-Benachrichtigungen |
| `SMTP_PORT` | — | `587` | SMTP-Port |
| `SMTP_USER` | — | — | SMTP-Benutzername |
| `SMTP_PASS` | — | — | SMTP-Passwort |
| `SMTP_FROM` | — | — | Absenderadresse für E-Mail-Benachrichtigungen |

> E-Mail-Versand ist aktiv wenn `SMTP_HOST` und `SMTP_FROM` gesetzt sind — ohne SMTP-Konfiguration (oder falls der Server nicht erreichbar ist) wird die Benachrichtigung übersprungen, der jeweilige Workflow (Antrag einreichen/annehmen/ablehnen) schlägt dadurch nie fehl.

## Lizenz

on-duty steht unter der [GNU Affero General Public License v3.0 oder später](LICENSE) (`AGPL-3.0-or-later`).
Copyright (C) 2026 Thomas Schulte-Bahrenberg.

Logo, Icons und Wortmarke „on-duty“ (`branding/`, Icons in `public/`) sind von der AGPL ausgenommen, siehe [branding/README.md](branding/README.md).

Forks, die öffentlich betrieben werden, müssen den Quelltext anbieten: Dafür `SOURCE_REPO_URL` in `src/lib/constants.ts` auf das eigene Repository ändern (Footer-Link).
