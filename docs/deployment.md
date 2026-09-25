# Deployment via Coolify

Coolify konsumiert fertige Docker-Images aus ghcr.io — kein Build auf dem Server.

## Ersteinrichtung

### 1. Service anlegen

1. Coolify → **New Resource → Docker Compose**
2. Inhalt von `docker-compose.prod.yml` einfügen
3. Name: `on-duty`

### 2. Umgebungsvariablen setzen

Unter **Environment Variables** eintragen (kein `.env`-File — alle Vars kommen aus Coolify):

| Variable | Beispiel | Pflicht |
|---|---|---|
| `APP_VERSION` | `latest` | ja |
| `APP_URL` | `https://on-duty.example.com` | ja |
| `SESSION_SECRET` | (langer Zufalls-String) | ja |
| `ADMIN_PASSWORD` | | ja |
| `OIDC_CLIENT_ID` | | ja, wenn OIDC aktiv |
| `OIDC_CLIENT_SECRET` | | ja, wenn OIDC aktiv |
| `OIDC_ISSUER` | | ja, wenn OIDC aktiv |
| `POSTGRES_PASSWORD` | | ja |
| `POSTGRES_USER` | `onduty` | nein (Default) |
| `POSTGRES_DB` | `onduty` | nein (Default) |

### 3. Erste Version deployen

1. `APP_VERSION=latest` setzen (oder eine konkrete Version wie `1.0.0`)
2. **Deploy** klicken
3. Logs abwarten — Drizzle-Migrationen laufen beim Container-Start automatisch

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
