# Standalone-Deployment (App + DB + OIDC)

Ein zweiter, eigenständiger Produktions-Stack für Betreiber ohne Coolify und ohne eigenen OIDC-Provider: App, Datenbank und ein selbst gehosteter OIDC-Provider (Zitadel) in einem einzigen `docker-compose.standalone.yml`. Ergänzt `docker-compose.prod.yml` (Coolify + externer OIDC-Provider), ersetzt es nicht.

Generische `OIDC_*`-Variablen sind in [docs/oidc.md](oidc.md) dokumentiert — dieser Stack setzt sie automatisch aus `APP_DOMAIN`/`ZITADEL_DOMAIN`, keine manuelle Konfiguration nötig.

## Voraussetzungen

- Docker + Docker Compose auf dem Server
- Zwei DNS-Einträge (A/AAAA-Record) auf diesen Server: `APP_DOMAIN` (z. B. `app.ff.altenhammer.de`) und `ZITADEL_DOMAIN` (z. B. `auth.ff.altenhammer.de`) — Subpath-Betrieb wird von Zitadel nicht zuverlässig unterstützt, daher zwei Subdomains
- Ports 80 + 443 von außen erreichbar (Caddy holt automatisch Let's-Encrypt-Zertifikate)

## Benötigte Dateien

Anders als beim reinen `docker-compose.prod.yml`-Deployment werden hier zusätzlich zwei Dateien aus dem Repo als Bind-Mounts eingebunden — alle vier gehören ins selbe Arbeitsverzeichnis auf dem Server:

```
docker-compose.standalone.yml
.env.standalone         # aus .env.standalone.example, siehe unten
Caddyfile.standalone
postgres-init-standalone.sh
```

## Ersteinrichtung

Das Deployment ist **zweistufig**, weil Zitadel Client-ID/Client-Secret einer OIDC-Application nicht vorgeben lässt ([Zitadel Discussion #4349](https://github.com/zitadel/zitadel/discussions/4349)) — die App-Registrierung muss einmalig manuell in der Zitadel-Console erfolgen, bevor on-duty selbst gestartet werden kann.

### 1. `.env.standalone` anlegen

```bash
cp .env.standalone.example .env.standalone
```

Alle Felder außer `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` befüllen (Platzhalter mit `openssl rand -hex 32` bzw. `openssl rand -hex 16` für `ZITADEL_MASTERKEY`, siehe Kommentare in der Datei).

### 2. Infrastruktur-Services starten

```bash
docker compose --file docker-compose.standalone.yml --env-file .env.standalone up -d db zitadel zitadel-login caddy
```

Logs abwarten, bis Zitadel bereit ist:

```bash
docker compose --file docker-compose.standalone.yml logs -f zitadel
```

### 3. Projekt + OIDC-Application in Zitadel anlegen (manuell, einmalig)

1. `https://<ZITADEL_DOMAIN>` aufrufen, mit Bootstrap-Admin einloggen (Benutzername `ZITADEL_ADMIN_USERNAME`, Passwort `SERVICE_PASSWORD_ZITADEL_ADMIN`). Erster Login erzwingt eine Passwortänderung.
2. **Projects → New Project** — Name z. B. `on-duty`.
3. Im Projekt: **New Application**
   - Type: **Web**
   - Authentication Method: **Code** (Authorization Code + PKCE — passend zu on-dutys Auth-Flow)
   - Redirect URI: `https://<APP_DOMAIN>/auth/callback/oidc`
   - Post Logout Redirect URI: `https://<APP_DOMAIN>` (on-duty nutzt kein RP-Initiated Logout, Feld aber von Zitadel benötigt)
4. Nach dem Speichern zeigt Zitadel **Client-ID** und **Client-Secret** — beide notieren.
5. In `.env.standalone` eintragen:

```env
OIDC_CLIENT_ID=<Client-ID aus Schritt 4>
OIDC_CLIENT_SECRET=<Client-Secret aus Schritt 4>
```

### 4. Komplett-Stack starten

```bash
docker compose --file docker-compose.standalone.yml --env-file .env.standalone up -d
```

`https://<APP_DOMAIN>` ist danach erreichbar. Login zunächst über `/admin/login` (lokaler Admin, `SERVICE_PASSWORD_ADMIN`) — OIDC-Benutzer müssen wie immer vorab unter **Admin → Benutzer** angelegt werden (kein JIT, siehe [docs/oidc.md](oidc.md)).

## Upgrade

```bash
# Neue Versionen in .env.standalone eintragen (APP_VERSION; für Zitadel/Caddy/Postgres/Backup
# die exakten Image-Tags direkt in docker-compose.standalone.yml anpassen — bewusst kein
# Moving-Tag), dann:
docker compose --file docker-compose.standalone.yml --env-file .env.standalone pull
docker compose --file docker-compose.standalone.yml --env-file .env.standalone up -d
```

## Backup

Der dedizierte `backup`-Service (`prodrigestivill/postgres-backup-local`) sichert **beide** Datenbanken (`onduty` und `zitadel`) täglich nach `./data/backups`, Retention 7 Tage / 4 Wochen / 6 Monate. Der in on-duty eingebaute Backup-Mechanismus ist über `BACKUP_DISABLED=true` deaktiviert (fest verdrahtet in `docker-compose.standalone.yml`, kein Umschalten vorgesehen).

Dateien landen als gzip-komprimierte SQL-Dumps unter `data/backups/daily|weekly|monthly/<db>-<datum>.sql.gz`. Wiederherstellen (Beispiel `onduty`-DB, über den laufenden `backup`-Container):

```bash
docker compose --file docker-compose.standalone.yml exec --tty --interactive backup \
  /bin/sh -c "zcat /backups/daily/onduty-<datum>.sql.gz | psql --host=db --username=onduty --dbname=onduty -W"
```

## Fehlerbehebung

| Symptom | Ursache | Lösung |
|---|---|---|
| Zitadel-Login-Seite lädt nicht (`/ui/v2/login` 502) | `zitadel-login`-Container noch nicht bereit oder Bootstrap-PAT noch nicht geschrieben | `docker compose logs zitadel-login` prüfen; `zitadel` muss zuerst healthy sein (schreibt die PAT-Datei ins gemeinsame Volume) |
| on-duty-Login schlägt fehl, obwohl OIDC-Vars gesetzt sind | Redirect-URI in der Zitadel-Application stimmt nicht exakt mit `https://<APP_DOMAIN>/auth/callback/oidc` überein | URI in der Zitadel-Console korrigieren |
| Caddy bekommt kein Let's-Encrypt-Zertifikat | DNS zeigt noch nicht auf den Server, oder Port 80/443 ist blockiert | DNS-Propagation abwarten, Firewall prüfen (`docker compose logs caddy`) |
