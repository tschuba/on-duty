# on-duty

Werkzeugkasten für Wehr und Verein: Mitglieder, Ausrüstung und mehr.
Entstanden bei und im Einsatz für die Freiwillige Feuerwehr Altenhammer.

## Funktionen

- Mitglieder
- Inventar und Ausleihe
- Spenden und Spender
- Jubiläen

**Stack:** Hono · HTMX · Tailwind v4 · daisyUI v5 · Drizzle ORM · Better Auth · PostgreSQL · Docker

---

## Konfiguration

- [OIDC-Provider konfigurieren](docs/oidc.md)
- [Backup konfigurieren](docs/backup.md)
- [Standalone-Deployment (App + DB + OIDC, ohne Coolify)](docs/standalone-deployment.md)
- [GitHub-Repository konfigurieren](docs/github-setup.md)

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

> **Lokales Backup-Volume:** `BACKUP_LOCAL_PATH=/app/backups` in `.env` setzen und das Volume in `docker-compose.prod.yml` einkommentieren.

---

## Lokale Entwicklung

**Voraussetzungen:** Node.js 22, pnpm, Docker

> **macOS:** Für Backups wird `pg_dump` benötigt. Da `libpq` bei Homebrew keg-only ist, muss es explizit verlinkt werden:
> ```bash
> brew install libpq && brew link --force libpq
> ```

```bash
# 1. Abhängigkeiten installieren (kopiert auch Fonts nach public/fonts/)
pnpm install

# 2. Umgebungsvariablen anlegen
cp .env.example .env
# .env öffnen: ADMIN_PASSWORD und BETTER_AUTH_SECRET setzen (+ OIDC-Vars für Login)

# 3. Datenbank starten
docker compose up -d

# 4. Schema migrieren + Admin-Account anlegen
pnpm db:setup

# 5. Entwicklungsserver starten
pnpm dev
# → http://localhost:3000
```

## Scripts

| Befehl | Beschreibung |
|---|---|
| `pnpm dev` | Dev-Server + Tailwind watch (parallel) |
| `pnpm build` | TypeScript kompilieren + CSS minifizieren |
| `pnpm db:generate` | Drizzle-Migration aus Schema generieren |
| `pnpm db:migrate` | Migrationen ausführen |
| `pnpm db:seed` | Admin-Account anlegen (idempotent) |
| `pnpm db:setup` | Migrate + Seed (Ersteinrichtung) |
| `pnpm db:studio` | Drizzle Studio öffnen |

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
| `SESSION_LIFETIME` | — | `7d` | Session-Dauer (z. B. `7d`, `8h`, `30m`) |
| `CHILDREN_AGE_LIMIT` | — | `12` | Altersgrenze Kinderfeuerwehr (Jahre, muss < `YOUTH_AGE_LIMIT`) |
| `REGISTRATION_ENABLED` | — | `false` | Startwert: Selbstregistrierung aktiv (`true`/`false`); wird nur einmalig übernommen, solange die Einstellung noch nie gespeichert wurde |
| `REGISTRATION_AUTO_APPROVE` | — | `false` | Startwert (einmalig): Registrierungen automatisch freigeben (braucht `REGISTRATION_DEFAULT_ROLE_ID`) |
| `REGISTRATION_DEFAULT_ROLE_ID` | — | — | Startwert (einmalig): Rollen-ID für automatisch freigegebene Nutzer |
| `YOUTH_AGE_LIMIT` | — | `18` | Altersgrenze Jugendfeuerwehr (Jahre) |
| `ANNIVERSARY_CUTOFF` | — | `01-06` | Ehrungstermin für Jubiläen (MM-DD) |
| `BACKUP_SCHEDULE` | — | `0 2 * * 0` | Backup-Intervall (Cron-Ausdruck) |
| `BACKUP_LOCAL_PATH` | — | — | Pfad für lokales Backup-Volume |
| `BACKUP_RETENTION_COUNT` | — | `4` | Max. Backup-Dateien pro Ziel |
| `S3_ENDPOINT` | — | — | S3-Endpoint-URL |
| `S3_BUCKET` | — | — | S3-Bucket-Name |
| `S3_ACCESS_KEY` | — | — | S3 Access Key ID |
| `S3_SECRET_KEY` | — | — | S3 Secret Access Key |
| `S3_REGION` | — | — | S3-Region (optional) |
| `S3_PREFIX` | — | — | Pfad-Prefix im Bucket (optional) |
| `SMTP_HOST` | — | — | SMTP-Server für E-Mail-Benachrichtigungen |
| `SMTP_PORT` | — | `587` | SMTP-Port |
| `SMTP_USER` | — | — | SMTP-Benutzername |
| `SMTP_PASS` | — | — | SMTP-Passwort |
| `SMTP_FROM` | — | — | Absenderadresse für E-Mail-Benachrichtigungen |

> S3-Backup ist aktiv wenn `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY` und `S3_SECRET_KEY` alle gesetzt sind.
> Lokales Backup ist aktiv wenn `BACKUP_LOCAL_PATH` gesetzt ist.
> E-Mail-Versand ist aktiv wenn `SMTP_HOST` und `SMTP_FROM` gesetzt sind — ohne SMTP-Konfiguration (oder falls der Server nicht erreichbar ist) wird die Benachrichtigung übersprungen, der jeweilige Workflow (Antrag einreichen/annehmen/ablehnen) schlägt dadurch nie fehl.
