# Standalone-Deployment (App + DB + OIDC)

Ein zweiter, eigenständiger Produktions-Stack für Betreiber ohne Coolify und ohne eigenen OIDC-Provider: App, Datenbank und ein selbst gehosteter OIDC-Provider (Zitadel) in einem einzigen `docker-compose.standalone.yml`. Ergänzt `docker-compose.prod.yml` (Coolify + externer OIDC-Provider), ersetzt es nicht.

Generische `OIDC_*`-Variablen sind in [docs/oidc.md](oidc.md) dokumentiert — dieser Stack setzt sie automatisch aus den Coolify-Domains, keine manuelle Konfiguration nötig.

## Voraussetzungen

- Coolify (v4.x) mit Git-Deployment dieses Repos; der Stack wurde noch nicht gegen eine echte Coolify-Instanz getestet
- Zwei DNS-Einträge auf den Coolify-Server, z. B. `on-duty.example.com` (App) und `auth.example.com` (Zitadel) — Subpath-Betrieb wird von Zitadel nicht zuverlässig unterstützt
- TLS und Routing übernimmt Coolify (Traefik); Caddy gibt es nur im lokalen Test (`scripts/test-standalone-local.sh`)

## Ersteinrichtung in Coolify

Zitadel lässt Client-ID/Client-Secret einer OIDC-Application nicht vorgeben ([Zitadel Discussion #4349](https://github.com/zitadel/zitadel/discussions/4349)). Der Stack legt die Application deshalb beim allerersten Start selbst per API an: Der Einmal-Service `zitadel-init` erstellt Projekt + Application, schreibt Client-ID/Secret in das Bootstrap-Volume (`oidc.env`), und der `app`-Service liest sie beim Start ein.

### 1. Ressource anlegen

Neue Ressource → Docker Compose → Repo, Compose-Datei `docker-compose.standalone.yml`.

### 2. Domains eintragen

| Service | Domain |
|---|---|
| `app` | `https://on-duty.example.com` |
| `zitadel` | `https://auth.example.com` |
| `zitadel-login` | `https://login.example.com` (eigene Domain, **ohne Pfad**) |

`zitadel-login` bekommt bewusst eine **eigene Domain ohne Pfad**: Coolify entfernt bei gesetztem Pfad das Präfix (Traefik `stripprefix`), das Login-UI braucht es aber (`NEXT_PUBLIC_BASE_PATH=/ui/v2/login`). Damit Zitadel die Instanz trotz zweiter Domain findet, setzt `zitadel-login` per `CUSTOM_REQUEST_HEADERS` die Zitadel-Domain als `Host`, `x-zitadel-instance-host` und `x-zitadel-public-host`.

`zitadel` spricht HTTP/2 im Klartext (h2c) — falls Traefik 502 liefert, am Service das Label `traefik.http.services.<name>.loadbalancer.server.scheme=h2c` ergänzen.

### 3. Variablen setzen

Nur `ORG_NAME` (Pflicht), optional `SMTP_*` und `APP_VERSION`; `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` **leer lassen** (siehe `.env.standalone.example`). Passwörter und Secrets (`SERVICE_PASSWORD_*`) erzeugt Coolify selbst und darf nach dem ersten Deploy nicht mehr neu generiert werden (Masterkey, DB-Passwörter).

`SERVICE_PASSWORDWITHSYMBOLS_ZITADELADMIN` ist ein Zufallswert, der Zitadels Passwort-Policy (Groß-/Kleinbuchstabe, Ziffer, Symbol) nicht immer erfüllt. Der Stack hängt deshalb `Aa1!` an: das Initialpasswort ist der Coolify-Wert **plus `Aa1!`**.

### 4. Deployen und anmelden

Deploy in Coolify starten. `https://<on-duty-domain>` ist danach erreichbar. Login zunächst über `/admin/login` (lokaler Admin, `SERVICE_PASSWORD_ADMIN`) — OIDC-Benutzer müssen vorab unter **Admin → Benutzer** angelegt werden (oder per Selbstregistrierung, siehe [docs/oidc.md](oidc.md)).

Zitadel-Console: `https://<zitadel-domain>`, Benutzername `zitadel-admin` (Zitadel hängt automatisch die Org-Domain an; den vollständigen Login-Namen gibt `zitadel-init` im Log aus: Zeile `Console login: … login name: …`). Passwort: Wert von `SERVICE_PASSWORDWITHSYMBOLS_ZITADELADMIN` aus den Coolify-Variablen **plus `Aa1!`**; der erste Login erzwingt eine Passwortänderung.

### Wie die Automatisierung funktioniert

- Zitadel legt beim allerersten Setup einen Machine-User `onduty-init` (Rolle `IAM_OWNER`) samt PAT im separaten Volume `zitadel-admin` an (nur `zitadel`, `zitadel-init` und `zitadel-init-hooks` mounten es, `app` und `zitadel-login` nicht).
- `zitadel-init` nutzt diesen PAT, erzeugt Projekt `on-duty` und eine Web-Application (Authorization Code + PKCE, Redirect-URI `https://<on-duty-domain>/auth/callback/oidc`), schreibt `oidc.env`. Der Machine-User bleibt bestehen: `zitadel-init` und `zitadel-init-hooks` laufen bei jedem Deploy und gleichen Redirect-URIs, Login-UI-URL und Webhook-Endpoint mit den aktuellen Domains ab. Das Volume `zitadel-admin` enthält einen `IAM_OWNER`-Token und gehört nicht in Backups oder Snapshots, die Dritte lesen können.
- Bei späteren Starts tut `zitadel-init` nichts (`oidc.env` existiert bzw. `OIDC_CLIENT_ID` ist gesetzt).
- Das Bootstrap-Volume enthält `oidc.env` mit dem Client-Secret (`0600`) — wie `.env.standalone` als Geheimnis behandeln.

### Webhook und SMTP (optional)

Zusätzlich richtet die Ersteinrichtung zwei Komfortfunktionen ein. Scheitert eine davon, läuft der Stack trotzdem — die Benutzer entstehen dann wie bei jedem anderen Provider beim ersten Login.

- **Webhook:** `zitadel-init-hooks` legt (sobald `app` läuft) ein Zitadel-Target auf `http://app:3000/hooks/zitadel` an, mit Executions für `user.human.added` und `user.human.email.verified`. on-duty prüft die Signatur (`ZITADEL-Signature`, HMAC-SHA256 mit dem Signing-Key, den Zitadel beim Anlegen liefert; Schlüssel liegt als `webhook.secret` im Bootstrap-Volume) und legt bei `registrationEnabled` den Benutzer **bei der Registrierung** an (`emailVerified=false`, Zitadel-Benutzer-ID als `account`-Bindung). Nach der E-Mail-Bestätigung in Zitadel setzt das zweite Event `emailVerified=true`. Ein Benutzer ist **aktiv**, wenn die E-Mail bestätigt ist und er mindestens eine Rolle hat. Bis dahin sieht er `/pending`, der Admin ein Badge in der Navigation. Ohne Webhook entsteht der Benutzer erst beim ersten Login — die Regel bleibt gleich.
- **SMTP:** Sind `SMTP_*` in Coolify gesetzt, trägt `zitadel-init` dieselben Werte als Zitadel-SMTP-Provider ein und gleicht sie bei jedem Deploy ab (Bestätigungsmails); on-duty nutzt sie für die Admin-Benachrichtigung. Beides ist unabhängig voneinander nutzbar: Zitadel versendet die Mail an den Benutzer, on-duty die Mail an die Admins.
- **Webhook-URL:** Zitadel sperrt ausgehende Aufrufe an private Netze und Loopback (`HTTPClient.DenyList`, Default bleibt unverändert aktiv). Der Webhook zeigt deshalb auf die **öffentliche** URL `https://<on-duty-domain>/hooks/zitadel` (über den Reverse Proxy), nicht auf `http://app:3000` — das Docker-Subnetz ist nicht vorhersagbar (172.x, 192.168.x oder 10.x je nach Host) und ließe sich nicht zuverlässig freigeben. Überschreibbar mit `WEBHOOK_URL` in `.env.standalone`. Schlägt das Anlegen mit `DeniedURL` fehl, steht der Grund im Log von `zitadel-init-hooks`; on-duty läuft dann ohne Webhook (Benutzer entsteht beim ersten Login).
- **Lokaler Test:** `*.localhost` löst auf Loopback auf, die öffentliche URL ist dort nicht erreichbar. `docker-compose.standalone.local.yml` legt deshalb ein festes Subnetz (`172.29.77.0/24`) an und nimmt `172.16.0.0/12` aus der Deny-Liste, damit der Webhook direkt an `http://app:3000` gehen kann. Nur für den Test; ist das Subnetz auf dem Host belegt, in der Datei ändern.
- `user.human.added` feuert auch für Benutzer, die ein Zitadel-Admin anlegt. Sie werden bei `registrationEnabled` wie Registrierungen behandelt.

### Manueller Fallback (bestehende Installationen)

Der Machine-User entsteht nur beim allerersten Setup einer Zitadel-Instanz. Bei einer bestehenden Installation (oder falls `zitadel-init` fehlschlägt: `docker compose logs zitadel-init`) die Application von Hand anlegen und die Werte in `.env.standalone` eintragen — explizit gesetzte Werte haben Vorrang, `zitadel-init` beendet sich dann sofort:

1. In der Console (Login-Name wie oben): **Projects → New Project** — Name z. B. `on-duty`.
2. Im Projekt: **New Application**
   - Type: **Web**
   - Authentication Method: **Code** (Authorization Code + PKCE — passend zu on-dutys Auth-Flow)
   - Redirect URI: `https://<on-duty-domain>/auth/callback/oidc`
   - Post Logout Redirect URI: `https://<on-duty-domain>` (on-duty nutzt kein RP-Initiated Logout, Feld aber von Zitadel benötigt)
3. **Client-ID** und **Client-Secret** notieren und eintragen:

```env
OIDC_CLIENT_ID=<Client-ID>
OIDC_CLIENT_SECRET=<Client-Secret>
```

4. `docker compose --file docker-compose.standalone.yml --env-file .env.standalone up -d`

## Nach dem Erststart fixiert

- `ORG_NAME` ist Pflicht; fehlt der Wert, bricht der Deploy ab, bevor Zitadel initialisiert wird. Nach dem Erststart ändert sich der Org-Name nur noch in der Zitadel-Console (die Variable wirkt dann nur noch in der App).
- **Domains** (`app`, `zitadel`, `zitadel-login`) werden bei jedem Deploy automatisch nach Zitadel synchronisiert, siehe [Domain nachträglich ändern](#domain-nachträglich-ändern).
- Masterkey und DB-Passwörter (`SERVICE_PASSWORD_*`) nie neu generieren und ins Backup aufnehmen.

## Domain nachträglich ändern

Domain in Coolify ändern und redeployen, mehr nicht. `zitadel-init` und `zitadel-init-hooks` gleichen bei jedem Deploy ab:

- Redirect-URI und Post-Logout-URI der OIDC-Application (`app`-Domain),
- Login-V2-Basis-URL der Instanz (`zitadel-login`-Domain),
- Endpoint des Webhook-Targets (`app`-Domain; Signing-Key und `webhook.secret` bleiben gleich).

Zitadels Issuer folgt `ZITADEL_EXTERNALDOMAIN` beim Start von selbst. `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` bleiben unverändert. Voraussetzung ist das Volume `zitadel-admin`. Installationen aus der Zeit davor (PAT wurde gelöscht) haben es nicht: `zitadel-init` warnt dort nur bei Domain-Änderungen, und die drei Werte müssen in der Zitadel-Console von Hand angepasst werden (Redirect-URI: Projekt `on-duty` → Application; Webhook: Actions → Targets; Login-URL: `PUT /v2/features/instance` mit `{"loginV2":{"required":true,"baseUri":"https://<login-domain>/ui/v2/login/"}}`).

## Upgrade

```bash
# Neue Versionen in .env.standalone eintragen (APP_VERSION; für Zitadel/Caddy/Postgres/Backup
# die exakten Image-Tags direkt in docker-compose.standalone.yml anpassen — bewusst kein
# Moving-Tag), dann:
docker compose --file docker-compose.standalone.yml --env-file .env.standalone pull
docker compose --file docker-compose.standalone.yml --env-file .env.standalone up -d
```

## Backup

Der dedizierte `backup`-Service (`prodrigestivill/postgres-backup-local`) sichert **beide** Datenbanken (`onduty` und `zitadel`) täglich nach `./data/backups`, Retention 7 Tage / 4 Wochen / 6 Monate. Nach jedem Lauf schreibt ein Hook den Status in das Volume `backup-status`; on-duty zeigt ihn unter `/admin/backup` an und warnt per Banner (siehe [backup.md](backup.md)).

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

### Bugsink lokal

Standardmäßig aus (siehe unten). Lokal dazustarten:

```bash
docker compose -p on-duty-standalone-local -f docker-compose.standalone.yml -f docker-compose.standalone.local.yml --env-file .env.standalone.local --profile errors up -d
```

`https://errors.localhost` (Zertifikatswarnung akzeptieren). Login:
`admin@bugsink.local` (Default von `BUGSINK_ADMIN_EMAIL`) und
`SERVICE_PASSWORD_BUGSINK` aus `.env.standalone.local`. Nach dem ersten Lauf
von `bugsink-init` einmal `app` neu starten, damit die DSN greift (siehe
unten).

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

## Dev-Stack im Host-Modus

Für die normale Entwicklung (nicht den Release-Test oben): DB, Zitadel (+
Login, Init) und optional Bugsink laufen in Docker, die App selbst **nicht**
als Container, sondern per `pnpm dev` auf dem Host — mit Hot-Reload.
Basis sind dieselben Compose-Dateien wie oben, nur ohne das Compose-Profil
`app`.

```bash
pnpm stack:up          # optional mit Bugsink: pnpm stack:up:errors
pnpm stack:trust       # einmalig pro Rechner, danach Browser neu starten
pnpm dev               # → https://app.localhost
```

`pnpm stack:up`:

- generiert `.env.standalone.dev` (Compose-`--env-file`, analog
  `.env.standalone.local` oben) und startet `db`, `zitadel`,
  `zitadel-login`, `caddy`, `zitadel-init`, `zitadel-init-hooks` (mit
  `--with-errors` zusätzlich `bugsink`/`bugsink-init`) — **ohne** `app`
- exportiert Caddys lokales CA-Zertifikat und das Zitadel-Webhook-Secret
  nach `.dev-stack/` (gitignored). Caddys `/data` liegt als Bind-Mount in
  `.dev-stack-ca/` (gitignored), damit die CA `stack:reset` übersteht
- schreibt `.env.dev-stack`: `DATABASE_URL` (Postgres auf
  `127.0.0.1:5433`), `OIDC_*`, `BETTER_AUTH_SECRET`, `ADMIN_PASSWORD`,
  `NODE_EXTRA_CA_CERTS` (zeigt auf die exportierte CA — nötig für
  OIDC-Discovery und Bugsink-Reporting), `ZITADEL_WEBHOOK_SECRET_FILE`,
  bei `--with-errors` auch `SENTRY_DSN`/`ERROR_TRACKER_URL`
- führt `pnpm db:setup` aus (Migration + Admin-Account); dabei ist
  Selbstregistrierung (`registrationEnabled`) direkt aktiv, damit sich der
  OIDC-Registrierungs-Webhook ohne Umweg über `/admin/config` testen lässt

`pnpm dev` lädt `.env.dev-stack` automatisch (`--env-file-if-exists`, spätere
Datei gewinnt) und verbindet sich mit dem Stack. Caddy proxyt dafür auf
`host.docker.internal:3000` statt auf `app:3000`; Zitadels `HTTPClient.DenyList`
lässt diese Adresse zu (sonst würde `DeniedURL` den Webhook blockieren, siehe
oben).

Aufräumen: `pnpm stack:down` (Container stoppen, Volumes bleiben) bzw.
`pnpm stack:reset` (alles löschen, inkl. `.env.standalone.dev`,
`.env.dev-stack`, `.dev-stack/`; `.dev-stack-ca/` und damit die CA bleiben).
`pnpm stack:reset --ca` löscht zusätzlich `.dev-stack-ca/` und entfernt die
alte CA aus dem System-Trust-Store (unter Linux gehört `.dev-stack-ca/` root,
das Löschen braucht `sudo`).

**Browser-Vertrauen:** `pnpm stack:trust` installiert die CA einmalig im
System-Trust-Store (macOS: Keychain, Linux: `update-ca-certificates` bzw.
`trust anchor`; Windows/WSL nicht unterstützt) und braucht Admin-Rechte.
`stack:up` installiert nichts selbst und weist nur darauf hin. Firefox nutzt
einen eigenen Store: `security.enterprise_roots.enabled` in `about:config` auf
`true` setzen. Wer den Stack vor dieser Umstellung gestartet hat, bekommt beim
nächsten `stack:up` einmalig eine neue CA.

**Achtung:** `test-standalone-local.sh` und `dev-stack.sh` nutzen
unterschiedliche Compose-Projekte, belegen aber dasselbe Docker-Subnetz und
dieselben Ports 80/443 — vorher den jeweils anderen Stack stoppen
(`docker compose -p on-duty-standalone-local … down` bzw. `pnpm stack:down`).

## Fehlerbehebung

| Symptom | Ursache | Lösung |
|---|---|---|
| Zitadel-Login-Seite lädt nicht (`/ui/v2/login` 502) | `zitadel-login`-Container noch nicht bereit oder Bootstrap-PAT noch nicht geschrieben | `docker compose logs zitadel-login` prüfen; `zitadel` muss zuerst healthy sein (schreibt die PAT-Datei ins gemeinsame Volume) |
| Login mit `ZITADEL_ADMIN_USERNAME` schlägt fehl: „Benutzer im System nicht gefunden" | Login-Name ist nicht `ZITADEL_ADMIN_USERNAME` allein, sondern mit Org-Domain als Suffix | Echten Login-Namen per DB-Query ermitteln (siehe Schritt 2 oben) und damit einloggen |
| `zitadel-init` bricht ab: „Weder OIDC_CLIENT_ID noch ein Bootstrap-Token vorhanden“ | Zitadel wurde nicht frisch aufgesetzt (bestehende DB), daher gibt es keinen Machine-User | Application manuell anlegen (Abschnitt „Manueller Fallback“) |
| on-duty-Login: `Errors.App.NotFound` | Die Client-ID existiert in Zitadel nicht (Instanz zurückgesetzt, `oidc.env`/`.env.standalone` veraltet) | Bei frischer Instanz Bootstrap-Volume + DB gemeinsam zurücksetzen (`down -v`); sonst Application neu anlegen und `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` setzen |
| on-duty-Login schlägt fehl, obwohl OIDC-Vars gesetzt sind | Redirect-URI in der Zitadel-Application stimmt nicht exakt mit `https://<on-duty-domain>/auth/callback/oidc` überein | URI in der Zitadel-Console korrigieren |
| Caddy bekommt kein Let's-Encrypt-Zertifikat | DNS zeigt noch nicht auf den Server, oder Port 80/443 ist blockiert | DNS-Propagation abwarten, Firewall prüfen (`docker compose logs caddy`) |

## Fehlererfassung (optional)

Unbehandelte Serverfehler (5xx, `uncaughtException`, `unhandledRejection`) können an ein Sentry-kompatibles Backend (Bugsink, GlitchTip, Sentry) gehen. Ohne DSN ist das SDK komplett aus (kein Netzwerkverkehr).

| Variable | Bedeutung |
|---|---|
| `SENTRY_DSN` | DSN des Projekts; hat Vorrang |
| `SENTRY_DSN_FILE` | Pfad zu einer Datei mit der DSN (beim Start gelesen; leer/fehlend = aus) |

- Gesendet werden nur Fehlertyp/Stack, interne `user.id`, Route-Pattern, Request-ID, App-Version und Umgebung. Kein Body, Query-String, Cookie, Header oder IP; keine Performance-Daten.
- Restgrenze: Fehlermeldungen und Stacks können Werte enthalten (z. B. SQL-Fehler). DSN nur eintragen, wenn dem Empfänger der Daten vertraut wird.

### Traces (OpenTelemetry, optional)

Mit `OTEL_EXPORTER_OTLP_ENDPOINT` (z. B. `https://<host>/api/default` bei OpenObserve) exportiert die App Traces und Metriken per OTLP/HTTP; leer = aus. Anmeldung über `OPENOBSERVE_USER`/`OPENOBSERVE_PASSWORD` (Basic), `OTEL_EXPORTER_OTLP_HEADERS` überschreibt; `OTEL_TRACES_SAMPLER_ARG` = Anteil 0..1 (Standard 1). Details: `docs/deployment.md`.

### Bugsink mitliefern (Compose-Profil `errors`)

Optional und standardmäßig aus. Aktivieren: in Coolify die Variable `COMPOSE_PROFILES=errors` setzen und neu deployen. Ohne Profil starten weder `bugsink` noch `bugsink-init`. (Coolify beachtet Profile ggf. nicht, siehe Coolify-Issue #6395; dann `bugsink`/`bugsink-init` in eine eigene Compose-Datei auslagern.)

- Bugsink bekommt eine eigene Domain (`SERVICE_FQDN_BUGSINK_8000`). Login: `BUGSINK_ADMIN_EMAIL` (Default `admin@bugsink.local`) und das von Coolify erzeugte `SERVICE_PASSWORD_BUGSINK`.
- `bugsink-init` legt Team und Projekt `on-duty` an und schreibt die DSN nach `/bugsink/dsn` (idempotent). Die App liest sie als `SENTRY_DSN_FILE`; **nach dem ersten Lauf die App einmal neu starten**. Eine explizite `SENTRY_DSN` hat Vorrang.
- Unter **Admin → Konfiguration** erscheint bei aktivem Profil ein Link zur Issue-Liste von Bugsink (`ERROR_TRACKER_URL`, Default `https://<SERVICE_FQDN_BUGSINK>/issues/`, per expliziter Variable überschreibbar). Login erfolgt dort separat (eigenes Bugsink-Konto, siehe oben), kein SSO.
- Limits: `BUGSINK_MAX_EVENTS_PER_HOUR` (Default 1000; Bugsink-Default 5000/Projekt) und `BUGSINK_RETENTION_EVENTS` (Default 10000 Events pro Projekt, gilt nur beim Anlegen des Projekts).
- Mail: Bugsink nutzt dieselben `SMTP_*`-Werte wie die App (für Passwort-Resets; Issue-Benachrichtigungen sind nicht eingeplant). Ohne `SMTP_HOST` versendet Bugsink nichts. Verschlüsselung ist STARTTLS; für Port 465 `BUGSINK_EMAIL_USE_SSL=True` und `BUGSINK_EMAIL_USE_TLS=False` setzen.
- Speicher: SQLite im Volume `bugsink-data`, **kein Backup**.
- Live-Logs: Dozzle wird nicht mitgeliefert, bei Bedarf separat betreiben.

## Logging

Die App loggt mit Pino auf stdout (`docker logs`).

| Variable | Werte | Default |
|---|---|---|
| `LOG_LEVEL` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` | `info` |
| `LOG_FORMAT` | `json` (eine JSON-Zeile je Eintrag), `pretty` (lesbar) | `json`; in der Entwicklung `pretty` |

- Jeder Request erhält eine ID (`X-Request-Id` des Proxys oder neu erzeugt), die in jeder Log-Zeile und im Response-Header steht. Bei einem Serverfehler zeigt die 500-Seite sie als „Fehler-ID“ – damit lässt sich die Log-Zeile finden.
- Es werden nur IDs geloggt, keine Namen, E-Mails oder IBANs. Die Redaction (`email`, `iban`, `password`, `authorization`, `cookie`) greift nur auf Feldnamen, nicht in Freitext.
- `/health` prüft die Datenbank (`select 1`): `200` bei Erfolg, `503` bei Fehler, ohne Details. Der Compose-Healthcheck nutzt das automatisch.

### Live-Logs (optional)

Empfehlung: [Dozzle](https://dozzle.dev). Wird nicht mitgeliefert. Absicherung per OIDC oder `users.yml`. **Achtung:** `docker.sock` gibt weitreichende Rechte auf den Host – nur über einen `docker-socket-proxy` (nur lesend) einbinden und bewusst aufsetzen.
