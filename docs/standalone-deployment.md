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

`SERVICE_PASSWORDWITHSYMBOLS_ZITADELADMIN` ist ein Zufallswert; erfüllt er ausnahmsweise Zitadels Passwort-Policy nicht (Groß-/Kleinbuchstabe, Ziffer, Symbol), schlägt die Ersteinrichtung fehl → Wert in Coolify neu generieren und redeployen.

### 4. Deployen und anmelden

Deploy in Coolify starten. `https://<on-duty-domain>` ist danach erreichbar. Login zunächst über `/admin/login` (lokaler Admin, `SERVICE_PASSWORD_ADMIN`) — OIDC-Benutzer müssen vorab unter **Admin → Benutzer** angelegt werden (oder per Selbstregistrierung, siehe [docs/oidc.md](oidc.md)).

Zitadel-Console: `https://<zitadel-domain>`, Benutzername `zitadel-admin` (Zitadel hängt automatisch die Org-Domain an; Login-Name per `psql` im `db`-Container aus `projections.login_names3` ermitteln). Passwort: Wert von `SERVICE_PASSWORDWITHSYMBOLS_ZITADELADMIN` aus den Coolify-Variablen; der erste Login erzwingt eine Passwortänderung.

### Wie die Automatisierung funktioniert

- Zitadel legt beim allerersten Setup einen Machine-User `onduty-init` (Rolle `IAM_OWNER`) samt PAT im Bootstrap-Volume an.
- `zitadel-init` nutzt diesen PAT, erzeugt Projekt `on-duty` und eine Web-Application (Authorization Code + PKCE, Redirect-URI `https://<on-duty-domain>/auth/callback/oidc`), schreibt `oidc.env` und **löscht den Machine-User samt PAT wieder**.
- Bei späteren Starts tut `zitadel-init` nichts (`oidc.env` existiert bzw. `OIDC_CLIENT_ID` ist gesetzt).
- Das Bootstrap-Volume enthält `oidc.env` mit dem Client-Secret (`0600`) — wie `.env.standalone` als Geheimnis behandeln.

### Webhook und SMTP (optional)

Zusätzlich richtet die Ersteinrichtung zwei Komfortfunktionen ein. Scheitert eine davon, läuft der Stack trotzdem — die Benutzer entstehen dann wie bei jedem anderen Provider beim ersten Login.

- **Webhook:** `zitadel-init-hooks` legt (sobald `app` läuft) ein Zitadel-Target auf `http://app:3000/hooks/zitadel` an, mit Executions für `user.human.added` und `user.human.email.verified`. on-duty prüft die Signatur (`ZITADEL-Signature`, HMAC-SHA256 mit dem Signing-Key, den Zitadel beim Anlegen liefert; Schlüssel liegt als `webhook.secret` im Bootstrap-Volume) und legt bei `registrationEnabled` den Benutzer **bei der Registrierung** an (`emailVerified=false`, Zitadel-Benutzer-ID als `account`-Bindung). Nach der E-Mail-Bestätigung in Zitadel setzt das zweite Event `emailVerified=true`. Ein Benutzer ist **aktiv**, wenn die E-Mail bestätigt ist und er mindestens eine Rolle hat. Bis dahin sieht er `/pending`, der Admin ein Badge in der Navigation. Ohne Webhook entsteht der Benutzer erst beim ersten Login — die Regel bleibt gleich.
- **SMTP:** Sind `SMTP_*` in Coolify gesetzt, trägt `zitadel-init` dieselben Werte als Zitadel-SMTP-Provider ein (Bestätigungsmails); on-duty nutzt sie für die Admin-Benachrichtigung. Beides ist unabhängig voneinander nutzbar: Zitadel versendet die Mail an den Benutzer, on-duty die Mail an die Admins.
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
- **Domains** (`app`, `zitadel`, `zitadel-login`) stecken teilweise in Zitadel. `zitadel-init` merkt sich diese im Bootstrap-Volume (`domains`) und warnt im Log, wenn sie sich später ändern. Eine automatische Korrektur gibt es nicht (der Bootstrap-PAT wird nach dem Setup gelöscht). Der lokale Admin-Login (`/admin/login`) funktioniert weiterhin. Anleitung: [Domain nachträglich ändern](#domain-nachträglich-ändern).
- Masterkey und DB-Passwörter (`SERVICE_PASSWORD_*`) nie neu generieren und ins Backup aufnehmen.

## Domain nachträglich ändern

Domain in Coolify ändern und redeployen. Zitadel akzeptiert eine neue `zitadel`-Domain beim Start von selbst (Issuer und Discovery folgen `ZITADEL_EXTERNALDOMAIN`). Diese Werte bleiben aber auf der alten Domain und müssen von Hand angepasst werden (Zitadel-Console, als `zitadel-admin` angemeldet):

| Geänderte Domain | Was anpassen |
|---|---|
| `app` | Projekt `on-duty` → Anwendung `on-duty` → Redirect Settings: Redirect-URI `https://<app-domain>/auth/callback/oidc` und Post-Logout-URI ergänzen (Symptom sonst: `invalid_request … redirect_uri is missing`). Webhook-Target (Actions → Targets, bzw. `/v2/actions/targets`): Endpoint auf `https://<app-domain>/hooks/zitadel` setzen, sonst werden Selbstregistrierungen nicht synchronisiert. |
| `zitadel` oder `zitadel-login` | Login-V2-Basis-URL der Instanz auf `https://<login-domain>/ui/v2/login/` setzen (`PUT /v2/features/instance` mit `{"loginV2":{"required":true,"baseUri":"…"}}`; Symptom sonst: Weiterleitung beim Login zur alten Domain). Die Redirect-URI der App bleibt gleich. |

`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` bleiben unverändert, `oidc.env` muss nicht neu erzeugt werden.

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
| on-duty-Login schlägt fehl, obwohl OIDC-Vars gesetzt sind | Redirect-URI in der Zitadel-Application stimmt nicht exakt mit `https://<on-duty-domain>/auth/callback/oidc` überein | URI in der Zitadel-Console korrigieren |
| Caddy bekommt kein Let's-Encrypt-Zertifikat | DNS zeigt noch nicht auf den Server, oder Port 80/443 ist blockiert | DNS-Propagation abwarten, Firewall prüfen (`docker compose logs caddy`) |
