#!/usr/bin/env bash
# Testet docker-compose.standalone.yml lokal end-to-end: Fake-Domains via
# *.localhost (RFC 6761, löst lokal auf Loopback auf — kein /etc/hosts nötig
# und unabhängig vom Router-DNS, anders als z. B. *.localtest.me, das manche
# Router als DNS-Rebinding filtern), Caddy mit `tls internal` statt echtem
# Let's Encrypt, App aus dem lokalen Dockerfile gebaut. Siehe
# docs/standalone-deployment.md, Abschnitt "Lokal testen".
#
# Eigener --env-file und -p (Projektname) sind Pflicht, nicht optional: ohne
# --env-file würde Compose das reale .env im Repo-Root laden (Secrets!),
# ohne -p würden Volumes mit anderen Compose-Stacks in diesem Verzeichnis
# kollidieren (Compose-Default-Projektname ist der Verzeichnisname).
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=on-duty-standalone-local
ENV_FILE=.env.standalone.local
COMPOSE=(docker compose -p "$PROJECT" -f docker-compose.standalone.yml -f docker-compose.standalone.local.yml --env-file "$ENV_FILE")

case "${1:-}" in
  --clean)
    echo "Räume vorherigen lokalen Teststack weg (Volumes inklusive)..."
    [[ -f "$ENV_FILE" ]] && "${COMPOSE[@]}" down -v || true
    rm -f "$ENV_FILE"
    ;;
  -h|--help)
    cat <<EOF
Usage: $0 [--clean]

  --clean      Vorherigen lokalen Teststack samt Volumes entfernen und $ENV_FILE neu erzeugen
  -h, --help   Diese Hilfe anzeigen
EOF
    exit 0
    ;;
  "") ;;
  *)
    echo "Unbekannte Option: $1 (siehe --help)" >&2
    exit 1
    ;;
esac

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Erzeuge $ENV_FILE (Fake-Domains + zufällige Secrets)..."
  cat > "$ENV_FILE" <<EOF
APP_DOMAIN=app.localhost
ZITADEL_DOMAIN=auth.localhost

POSTGRES_USER=onduty
POSTGRES_DB=onduty
SERVICE_PASSWORD_POSTGRES=$(openssl rand -hex 32)

ZITADEL_DB_USER=zitadel
ZITADEL_DB_NAME=zitadel
SERVICE_PASSWORD_ZITADEL_DB=$(openssl rand -hex 32)

SERVICE_PASSWORD_BETTERAUTH=$(openssl rand -hex 32)
SERVICE_PASSWORD_ADMIN=$(openssl rand -hex 16)
ORG_NAME=on-duty Standalone Local Test

ZITADEL_MASTERKEY=$(openssl rand -hex 16)
ZITADEL_SESSION_COOKIE_SECRET=$(openssl rand -base64 32)
ZITADEL_ADMIN_USERNAME=zitadel-admin
SERVICE_PASSWORD_ZITADEL_ADMIN=Aa1@$(openssl rand -hex 20)

OIDC_CLIENT_ID=REPLACE_ME
OIDC_CLIENT_SECRET=REPLACE_ME
EOF
fi

echo "Baue App-Image aus lokalem Dockerfile..."
"${COMPOSE[@]}" build app

echo "Starte Infrastruktur (db, zitadel, zitadel-login, caddy)..."
"${COMPOSE[@]}" up -d db zitadel zitadel-login caddy
# caddy hängt (wie in Prod) per depends_on auch an app — Compose startet ihn
# also automatisch mit. Vor dem manuellen Zitadel-Setup wieder anhalten, er
# hat an dieser Stelle ohnehin nur Platzhalter-OIDC-Credentials.
"${COMPOSE[@]}" stop app >/dev/null 2>&1 || true

echo "Warte auf Zitadel..."
until [[ "$(docker inspect -f '{{.State.Health.Status}}' "$("${COMPOSE[@]}" ps -q zitadel)" 2>/dev/null)" == "healthy" ]]; do
  sleep 2
done

if grep -q '^OIDC_CLIENT_ID=REPLACE_ME' "$ENV_FILE"; then
  APP_DOMAIN=$(grep '^APP_DOMAIN=' "$ENV_FILE" | cut -d= -f2)
  ZITADEL_DOMAIN=$(grep '^ZITADEL_DOMAIN=' "$ENV_FILE" | cut -d= -f2)
  ADMIN_USER=$(grep '^ZITADEL_ADMIN_USERNAME=' "$ENV_FILE" | cut -d= -f2)
  ADMIN_PASS=$(grep '^SERVICE_PASSWORD_ZITADEL_ADMIN=' "$ENV_FILE" | cut -d= -f2)
  ZITADEL_DB_USER=$(grep '^ZITADEL_DB_USER=' "$ENV_FILE" | cut -d= -f2)
  ZITADEL_DB_NAME=$(grep '^ZITADEL_DB_NAME=' "$ENV_FILE" | cut -d= -f2)
  # Zitadel hängt an den Bootstrap-Username automatisch die Org-Domain an
  # (Default, siehe cmd/setup/steps.yaml), sofern der Username keine
  # E-Mail-Adresse ist — der echte Login-Name ist also NICHT $ADMIN_USER
  # allein. Aus der laufenden Instanz auslesen statt aus ORG_NAME zu raten.
  ADMIN_LOGIN_NAME=$("${COMPOSE[@]}" exec -T db psql -U "$ZITADEL_DB_USER" -d "$ZITADEL_DB_NAME" -tAc \
    "select login_name from projections.login_names3 where login_name_lower like '${ADMIN_USER}@%' order by login_name limit 1;" \
    2>/dev/null | tr -d '[:space:]')
  ADMIN_LOGIN_NAME=${ADMIN_LOGIN_NAME:-$ADMIN_USER}
  cat <<EOF

Zitadel läuft: https://$ZITADEL_DOMAIN (Zertifikatswarnung akzeptieren, ist
das selbstsignierte lokale CA von Caddy).

Einmaliger manueller Schritt (Zitadel erlaubt keine vorab gesetzte
Client-ID/Secret, siehe docs/standalone-deployment.md):
  1. Login mit Benutzername "$ADMIN_LOGIN_NAME", Passwort "$ADMIN_PASS"
     (Passwortänderung wird beim ersten Login erzwungen)
  2. Projects → New Project (z. B. "on-duty")
  3. Im Projekt: New Application
       Type: Web, Authentication Method: Code
       Redirect URI:             https://$APP_DOMAIN/auth/callback/oidc
       Post Logout Redirect URI: https://$APP_DOMAIN
  4. Client-ID/Secret in $ENV_FILE eintragen:
       OIDC_CLIENT_ID=...
       OIDC_CLIENT_SECRET=...
  5. Dieses Skript erneut ausführen: $0

EOF
  exit 0
fi

echo "Warte auf Caddys lokales CA-Zertifikat..."
until "${COMPOSE[@]}" exec -T caddy test -f /data/caddy/pki/authorities/local/root.crt 2>/dev/null; do
  sleep 1
done

echo "Baue und starte kompletten Stack (ohne backup — für den lokalen Test irrelevant)..."
"${COMPOSE[@]}" build app
"${COMPOSE[@]}" up -d db zitadel zitadel-login caddy app

APP_DOMAIN=$(grep '^APP_DOMAIN=' "$ENV_FILE" | cut -d= -f2)
ADMIN_PASS=$(grep '^SERVICE_PASSWORD_ADMIN=' "$ENV_FILE" | cut -d= -f2)
cat <<EOF

Fertig. https://$APP_DOMAIN ist erreichbar (Zertifikatswarnung akzeptieren).

Admin-Login: /admin/login, Passwort: $ADMIN_PASS
Für den OIDC-Login-Test vorher passenden Benutzer unter Admin → Benutzer
anlegen (kein JIT, siehe docs/oidc.md).

Neustart nach Codeänderungen: einfach erneut ausführen (baut App neu, Volumes
bleiben erhalten). Fresh-Install-Test: $0 --clean
EOF
