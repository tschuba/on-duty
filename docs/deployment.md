# Deployment via Coolify

Coolify konsumiert fertige Docker-Images aus ghcr.io — kein Build auf dem Server.
`DATABASE_URL`, `BETTER_AUTH_SECRET` und `ADMIN_PASSWORD` werden von Coolify automatisch generiert (Magic Values in `docker-compose.prod.yml`).

## Ersteinrichtung

### 1. Service anlegen

1. Coolify → **New Resource → Docker Compose**
2. Inhalt von `docker-compose.prod.yml` einfügen
3. Name: `on-duty`

### 2. Umgebungsvariablen setzen

Coolify generiert automatisch (keine manuelle Eingabe nötig):

| Variable | Generiert als |
|---|---|
| `DATABASE_URL` | aus `SERVICE_PASSWORD_POSTGRES` zusammengesetzt |
| `BETTER_AUTH_SECRET` | `SERVICE_PASSWORD_BETTERAUTH` |
| `ADMIN_PASSWORD` | `SERVICE_PASSWORD_ADMIN` |
| `POSTGRES_PASSWORD` | `SERVICE_PASSWORD_POSTGRES` |

Manuell setzen unter **Environment Variables**:

| Variable | Beispiel | Beschreibung |
|---|---|---|
| `ORG_NAME` | `Feuerwehr Musterstadt` | Anzeigename in der App |
| `OIDC_PROVIDER` | `keycloak` | OIDC-Provider-Name |
| `OIDC_CLIENT_ID` | | Client-ID aus dem Provider |
| `OIDC_CLIENT_SECRET` | | Client-Secret aus dem Provider |
| `OIDC_APP_URL` | `https://on-duty.example.com` | Öffentliche App-URL (kein trailing `/`) |

Optional (Defaults in der App):

| Variable | Default | Beschreibung |
|---|---|---|
| `APP_VERSION` | `latest` | Image-Tag |
| `POSTGRES_USER` | `onduty` | DB-Benutzername |
| `POSTGRES_DB` | `onduty` | DB-Name |
| `SESSION_LIFETIME` | `7d` | Session-Gültigkeitsdauer |
| `BACKUP_SCHEDULE` | `0 2 * * 0` | Cron-Ausdruck für automatisches Backup |
| `BACKUP_RETENTION_COUNT` | `4` | Anzahl aufbewahrter Backups |
| `ANNIVERSARY_CUTOFF` | `01-06` | Stichtag für Jubiläumsberechnung (MM-DD) |

### 3. Erste Version deployen

1. **Deploy** klicken
2. Logs abwarten — Drizzle-Migrationen laufen beim Container-Start automatisch

## Upgrade

```bash
git tag v1.2.3
git push --tags
```

1. CI-Workflow abwarten (~5 min, Multi-Arch Build)
2. In Coolify: `APP_VERSION=1.2.3` setzen
3. **Redeploy** klicken

## Rollback

`APP_VERSION` auf die vorherige Version zurücksetzen → **Redeploy**.
