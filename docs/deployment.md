# Deployment

## Via Coolify

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

---

## Via Docker Compose

Direktes Deployment ohne Coolify — Docker und Docker Compose müssen auf dem Server installiert sein.
Migrationen und Seed laufen beim Container-Start automatisch.

### Prod-Server (direkt)

#### Ersteinrichtung

1. `docker-compose.prod.yml` aus dem Repo in ein Arbeitsverzeichnis auf dem Server kopieren.
2. `.env.prod` im selben Verzeichnis anlegen (siehe `.env.prod.example` im Repo):

```env
# Image
APP_VERSION=1.0.0

# Datenbank
POSTGRES_USER=onduty
POSTGRES_DB=onduty
SERVICE_PASSWORD_POSTGRES=<sicheres-zufalls-passwort>  # openssl rand -hex 32

# App-Secrets
SERVICE_PASSWORD_BETTERAUTH=<sicheres-zufalls-passwort>  # openssl rand -hex 32
SERVICE_PASSWORD_ADMIN=<admin-passwort>

# App-Konfiguration
ORG_NAME=Feuerwehr Musterstadt
OIDC_PROVIDER=keycloak
OIDC_CLIENT_ID=on-duty
OIDC_CLIENT_SECRET=<client-secret>
OIDC_APP_URL=https://on-duty.example.com  # kein trailing /

# Optional (Defaults gelten wenn nicht gesetzt)
# SESSION_LIFETIME=7d
# BACKUP_SCHEDULE=0 2 * * 0
# BACKUP_RETENTION_COUNT=4
# ANNIVERSARY_CUTOFF=01-06
```

3. Starten:

```bash
docker compose --env-file .env.prod up -d
```

4. Logs prüfen:

```bash
docker compose logs -f app
```

#### Upgrade

```bash
# APP_VERSION in .env.prod auf neue Version setzen, dann:
docker compose --env-file .env.prod pull && docker compose --env-file .env.prod up -d
```

#### Rollback

`APP_VERSION` in `.env.prod` auf die vorherige Version zurücksetzen:

```bash
docker compose --env-file .env.prod pull && docker compose --env-file .env.prod up -d
```

---

### Lokales Staging

Zum lokalen Testen des Prod-Stacks im geklonten Repo:

1. `.env.prod` im Repo-Root anlegen (Vorlage: `.env.prod.example`):

```env
# Staging — einfache Testwerte ausreichend
APP_VERSION=latest

POSTGRES_USER=onduty
POSTGRES_DB=onduty
SERVICE_PASSWORD_POSTGRES=testpassword       # lokal: beliebiger String

SERVICE_PASSWORD_BETTERAUTH=testpassword     # lokal: beliebiger String
SERVICE_PASSWORD_ADMIN=admin123

ORG_NAME=Feuerwehr Test
OIDC_PROVIDER=keycloak
OIDC_CLIENT_ID=on-duty
OIDC_CLIENT_SECRET=test
OIDC_APP_URL=http://localhost:3000
```

2. Starten:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

3. App läuft auf [http://localhost:3000](http://localhost:3000).
