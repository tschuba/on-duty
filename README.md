# on-duty

Mitglieder-Datenbank der Freiwilligen Feuerwehr Altenhammer.

**Stack:** Hono · HTMX · Tailwind v4 · daisyUI v5 · Drizzle ORM · Better Auth · PostgreSQL · Docker

---

## Konfiguration

- [OIDC-Provider konfigurieren](docs/oidc.md)
- [Backup konfigurieren](docs/backup.md)

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
| `YOUTH_AGE_LIMIT` | — | `18` | Altersgrenze Jugendfeuerwehr (Jahre) |
| `ANNIVERSARY_CUTOFF` | — | `01-06` | Jubiläumsstichtag (MM-DD) |
| `BACKUP_SCHEDULE` | — | `0 2 * * 0` | Backup-Intervall (Cron-Ausdruck) |
| `BACKUP_LOCAL_PATH` | — | — | Pfad für lokales Backup-Volume |
| `BACKUP_RETENTION_COUNT` | — | `4` | Max. Backup-Dateien pro Ziel |
| `S3_ENDPOINT` | — | — | S3-Endpoint-URL |
| `S3_BUCKET` | — | — | S3-Bucket-Name |
| `S3_ACCESS_KEY` | — | — | S3 Access Key ID |
| `S3_SECRET_KEY` | — | — | S3 Secret Access Key |
| `S3_REGION` | — | — | S3-Region (optional) |
| `S3_PREFIX` | — | — | Pfad-Prefix im Bucket (optional) |

> S3-Backup ist aktiv wenn `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY` und `S3_SECRET_KEY` alle gesetzt sind.
> Lokales Backup ist aktiv wenn `BACKUP_LOCAL_PATH` gesetzt ist.
