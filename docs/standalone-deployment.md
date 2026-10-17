# Standalone-Deployment (App + DB + OIDC)

Ein zweiter, eigenständiger Produktions-Stack für Betreiber ohne Coolify und ohne eigenen OIDC-Provider: App, Datenbank und ein selbst gehosteter OIDC-Provider (Zitadel) in einem einzigen `docker-compose.standalone.yml`. Ergänzt `docker-compose.prod.yml` (Coolify + externer OIDC-Provider), ersetzt es nicht.

Generische `OIDC_*`-Variablen sind in [docs/oidc.md](oidc.md) dokumentiert — dieser Stack setzt sie automatisch aus `APP_DOMAIN`/`ZITADEL_DOMAIN`, keine manuelle Konfiguration nötig.

## Voraussetzungen

- Docker + Docker Compose auf dem Server
- Zwei DNS-Einträge (A/AAAA-Record) auf diesen Server: `APP_DOMAIN` (z. B. `app.ff.altenhammer.de`) und `ZITADEL_DOMAIN` (z. B. `auth.ff.altenhammer.de`) — Subpath-Betrieb wird von Zitadel nicht zuverlässig unterstützt, daher zwei Subdomains
- Ports 80 + 443 von außen erreichbar (Caddy holt automatisch Let's-Encrypt-Zertifikate)

## Benötigte Dateien

Anders als beim reinen `docker-compose.prod.yml`-Deployment werden hier zusätzlich zwei Dateien aus dem Repo als Bind-Mounts eingebunden — alle vier gehören ins selbe Arbeitsverzeichnis auf dem Server, `postgres-init-standalone.sh` darin in einem `scripts/`-Unterordner:

```
docker-compose.standalone.yml
.env.standalone         # aus .env.standalone.example, siehe unten
Caddyfile.standalone
scripts/postgres-init-standalone.sh
```

## Ersteinrichtung

Zitadel lässt Client-ID/Client-Secret einer OIDC-Application nicht vorgeben ([Zitadel Discussion #4349](https://github.com/zitadel/zitadel/discussions/4349)). Der Stack legt die Application deshalb beim allerersten Start selbst per API an: Der Einmal-Service `zitadel-init` erstellt Projekt + Application, schreibt Client-ID/Secret in das Bootstrap-Volume (`oidc.env`), und der `app`-Service liest sie beim Start ein.

### 1. `.env.standalone` anlegen

```bash
cp .env.standalone.example .env.standalone
```

Alle Felder befüllen (Platzhalter mit `openssl rand -hex 32` bzw. `openssl rand -hex 16` für `ZITADEL_MASTERKEY`, siehe Kommentare in der Datei). `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` **leer lassen**.

### 2. Stack starten

```bash
docker compose --file docker-compose.standalone.yml --env-file .env.standalone up -d
```

`https://<APP_DOMAIN>` ist danach erreichbar. Login zunächst über `/admin/login` (lokaler Admin, `SERVICE_PASSWORD_ADMIN`) — OIDC-Benutzer müssen wie immer vorab unter **Admin → Benutzer** angelegt werden (oder per Selbstregistrierung, siehe [docs/oidc.md](oidc.md)).

Zitadel-Console: `https://<ZITADEL_DOMAIN>`. Login-Name ermitteln — Zitadel hängt an `ZITADEL_ADMIN_USERNAME` automatisch die Org-Domain an, sofern der Username keine E-Mail-Adresse ist (siehe `cmd/setup/steps.yaml`):

```bash
source .env.standalone && docker compose --file docker-compose.standalone.yml --env-file .env.standalone \
  exec -T db psql -U "$ZITADEL_DB_USER" -d "$ZITADEL_DB_NAME" -tAc \
  "select login_name from projections.login_names3 where login_name_lower like '${ZITADEL_ADMIN_USERNAME}@%' limit 1;"
```

Passwort: `SERVICE_PASSWORD_ZITADEL_ADMIN`; der erste Login erzwingt eine Passwortänderung.

### Wie die Automatisierung funktioniert

- Zitadel legt beim allerersten Setup einen Machine-User `onduty-init` (Rolle `IAM_OWNER`) samt PAT im Bootstrap-Volume an.
- `zitadel-init` nutzt diesen PAT, erzeugt Projekt `on-duty` und eine Web-Application (Authorization Code + PKCE, Redirect-URI `https://<APP_DOMAIN>/auth/callback/oidc`), schreibt `oidc.env` und **löscht den Machine-User samt PAT wieder**.
- Bei späteren Starts tut `zitadel-init` nichts (`oidc.env` existiert bzw. `OIDC_CLIENT_ID` ist gesetzt).
- Das Bootstrap-Volume enthält `oidc.env` mit dem Client-Secret (`0600`) — wie `.env.standalone` als Geheimnis behandeln.

### Manueller Fallback (bestehende Installationen)

Der Machine-User entsteht nur beim allerersten Setup einer Zitadel-Instanz. Bei einer bestehenden Installation (oder falls `zitadel-init` fehlschlägt: `docker compose logs zitadel-init`) die Application von Hand anlegen und die Werte in `.env.standalone` eintragen — explizit gesetzte Werte haben Vorrang, `zitadel-init` beendet sich dann sofort:

1. In der Console (Login-Name wie oben): **Projects → New Project** — Name z. B. `on-duty`.
2. Im Projekt: **New Application**
   - Type: **Web**
   - Authentication Method: **Code** (Authorization Code + PKCE — passend zu on-dutys Auth-Flow)
   - Redirect URI: `https://<APP_DOMAIN>/auth/callback/oidc`
   - Post Logout Redirect URI: `https://<APP_DOMAIN>` (on-duty nutzt kein RP-Initiated Logout, Feld aber von Zitadel benötigt)
3. **Client-ID** und **Client-Secret** notieren und eintragen:

```env
OIDC_CLIENT_ID=<Client-ID>
OIDC_CLIENT_SECRET=<Client-Secret>
```

4. `docker compose --file docker-compose.standalone.yml --env-file .env.standalone up -d`

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

## Lokal testen

Für Entwickler:innen, die den Stack end-to-end (inkl. echtem OIDC-Login) vor
einem Release lokal durchspielen wollen — ohne echte Domain, ohne öffentlich
erreichbare Ports 80/443:

```bash
./scripts/test-standalone-local.sh
```

Das Skript:


- generiert beim ersten Lauf `.env.standalone.local` (gitignored) mit
  Fake-Domains `app.localhost` / `auth.localhost` — `*.localhost` löst laut
  RFC 6761 lokal auf Loopback auf (kein `/etc/hosts`-Eintrag nötig, keine
  echte DNS-Anfrage — wichtig, da manche Router/ISP-Resolver Domains, die
  öffentlich auf eine private/Loopback-Adresse zeigen, als DNS-Rebinding
  filtern; `*.localtest.me` o. ä. scheitert daran auf manchen Netzwerken) —
  sowie zufälligen Secrets
- baut das `app`-Image lokal aus `Dockerfile` statt `ghcr.io` zu pullen —
  testet also den aktuellen Code-Stand, nicht das letzte veröffentlichte Image
- startet `db`, `zitadel`, `zitadel-login`, `caddy`. Caddy nutzt lokal `tls
  internal` (Caddyfile.standalone.local) statt echtem Let's Encrypt —
  Zertifikatswarnungen im Browser sind normal und können akzeptiert werden
- startet den kompletten Stack — ohne den `backup`-Service, der für den
  lokalen Test keine Rolle spielt. `zitadel-init` legt beim ersten Lauf
  Projekt + OIDC-Application automatisch an (siehe oben), es ist kein
  manueller Zitadel-Schritt nötig
- druckt am Ende Zugangsdaten (App-Admin, Zitadel-Console)

`https://app.localhost` ist danach erreichbar; Login zunächst über
`/admin/login`, für den OIDC-Test vorher passenden Benutzer unter **Admin →
Benutzer** anlegen (oder per Selbstregistrierung, siehe unten).

### Zitadel-Console lokal

`https://auth.localhost` (Zertifikatswarnung akzeptieren). Das Skript druckt
Login-Name und Passwort am Ende jedes Laufs. Der Login-Name ist nicht der reine
`ZITADEL_ADMIN_USERNAME`, sondern enthält die Org-Domain, z. B.
`zitadel-admin@on-duty-standalone-local-test.auth.localhost`. Das Passwort ist
`SERVICE_PASSWORD_ZITADEL_ADMIN` aus `.env.standalone.local`; der erste Login
erzwingt eine Änderung, danach gilt das neue Passwort.

### Selbstregistrierung lokal testen

1. Zitadel-Console: **Settings → Login Behavior and Security → Register allowed**
   aktivieren. Bestätigungsmails brauchen einen SMTP-Server (**Notification
   settings → SMTP**); der lokale Stack bringt keinen mit.
2. on-duty als lokaler Admin (`/admin/login`) → **Admin → Konfiguration**:
   `registrationEnabled` einschalten, optional `registrationAutoApprove` mit
   `registrationDefaultRoleId`.
3. In einem privaten Fenster `https://app.localhost` öffnen und über Zitadel
   registrieren. Ohne Auto-Freigabe landet der neue Benutzer auf der Seite
   „Freischaltung ausstehend“ und erscheint unter **Admin → Benutzer** als
   „wartet auf Freigabe“.

Details und Provider-Besonderheiten: [docs/oidc.md](oidc.md#selbstregistrierung).

Volumes bleiben zwischen Läufen erhalten (schnelle Iteration, die Zitadel-
Application wird nur einmal angelegt). Für einen echten Fresh-Install-Test:

```bash
./scripts/test-standalone-local.sh --clean
```

## Fehlerbehebung

| Symptom | Ursache | Lösung |
|---|---|---|
| Zitadel-Login-Seite lädt nicht (`/ui/v2/login` 502) | `zitadel-login`-Container noch nicht bereit oder Bootstrap-PAT noch nicht geschrieben | `docker compose logs zitadel-login` prüfen; `zitadel` muss zuerst healthy sein (schreibt die PAT-Datei ins gemeinsame Volume) |
| Login mit `ZITADEL_ADMIN_USERNAME` schlägt fehl: „Benutzer im System nicht gefunden" | Login-Name ist nicht `ZITADEL_ADMIN_USERNAME` allein, sondern mit Org-Domain als Suffix | Echten Login-Namen per DB-Query ermitteln (siehe Schritt 2 oben) und damit einloggen |
| `zitadel-init` bricht ab: „Weder OIDC_CLIENT_ID noch ein Bootstrap-Token vorhanden“ | Zitadel wurde nicht frisch aufgesetzt (bestehende DB), daher gibt es keinen Machine-User | Application manuell anlegen (Abschnitt „Manueller Fallback“) |
| on-duty-Login: `Errors.App.NotFound` | Die Client-ID existiert in Zitadel nicht (Instanz zurückgesetzt, `oidc.env`/`.env.standalone` veraltet) | Bei frischer Instanz Bootstrap-Volume + DB gemeinsam zurücksetzen (`down -v`); sonst Application neu anlegen und `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` setzen |
| on-duty-Login schlägt fehl, obwohl OIDC-Vars gesetzt sind | Redirect-URI in der Zitadel-Application stimmt nicht exakt mit `https://<APP_DOMAIN>/auth/callback/oidc` überein | URI in der Zitadel-Console korrigieren |
| Caddy bekommt kein Let's-Encrypt-Zertifikat | DNS zeigt noch nicht auf den Server, oder Port 80/443 ist blockiert | DNS-Propagation abwarten, Firewall prüfen (`docker compose logs caddy`) |
