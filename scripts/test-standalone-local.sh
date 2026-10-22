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

CLEAN=0
WITH_ERRORS=0
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=1 ;;
    --with-errors) WITH_ERRORS=1 ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--clean] [--with-errors]

  --clean        Vorherigen lokalen Teststack samt Volumes entfernen und $ENV_FILE neu erzeugen
  --with-errors  Zusätzlich Bugsink (Compose-Profil errors) starten: https://errors.localhost
  -h, --help     Diese Hilfe anzeigen
EOF
      exit 0
      ;;
    *)
      echo "Unbekannte Option: $arg (siehe --help)" >&2
      exit 1
      ;;
  esac
done

if [[ $CLEAN -eq 1 ]]; then
  echo "Räume vorherigen lokalen Teststack weg (Volumes inklusive)..."
  # --profile errors, damit auch ein früher gestartetes Bugsink samt Volumes entfernt wird
  [[ -f "$ENV_FILE" ]] && "${COMPOSE[@]}" --profile errors down -v || true
  rm -f "$ENV_FILE"
fi

[[ $WITH_ERRORS -eq 1 ]] && COMPOSE+=(--profile errors)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Erzeuge $ENV_FILE (Fake-Domains + zufällige Secrets)..."
  cat > "$ENV_FILE" <<EOF
SERVICE_FQDN_APP=app.localhost
SERVICE_FQDN_ZITADEL=auth.localhost
# lokal teilt sich das Login-UI die Domain mit Zitadel (Pfad-Routing in Caddyfile.standalone.local)
SERVICE_FQDN_ZITADELLOGIN=auth.localhost

# In Coolify generiert (Magic Vars) — lokal selbst erzeugt
SERVICE_PASSWORD_POSTGRES=$(openssl rand -hex 32)
SERVICE_PASSWORD_ZITADELDB=$(openssl rand -hex 32)
SERVICE_PASSWORD_BETTERAUTH=$(openssl rand -hex 32)
SERVICE_PASSWORD_ADMIN=$(openssl rand -hex 16)
SERVICE_PASSWORD_ZITADELMASTER=$(openssl rand -hex 16)
SERVICE_PASSWORD_ZITADELCOOKIE=$(openssl rand -hex 32)
SERVICE_PASSWORDWITHSYMBOLS_ZITADELADMIN=Aa1@$(openssl rand -hex 20)
ORG_NAME=on-duty Standalone Local Test
EOF
fi

if [[ $WITH_ERRORS -eq 1 ]] && ! grep -q '^SERVICE_FQDN_BUGSINK=' "$ENV_FILE"; then
  cat >> "$ENV_FILE" <<EOF
SERVICE_FQDN_BUGSINK=errors.localhost
SERVICE_PASSWORD_BUGSINKSECRET=$(openssl rand -hex 32)
SERVICE_PASSWORD_BUGSINK=$(openssl rand -hex 16)
EOF
fi

# Dummy-SMTP: zitadel-init trägt die Werte nur als Konfiguration in Zitadel ein, ein Mailserver ist nicht nötig.
if ! grep -q '^SMTP_HOST=' "$ENV_FILE"; then
  cat >> "$ENV_FILE" <<EOF
SMTP_HOST=smtp.localhost
SMTP_PORT=587
SMTP_USER=first-user
SMTP_PASS=dummy-pass
SMTP_FROM=on-duty <noreply@app.localhost>
EOF
fi

# Zitadel appends the org domain to the bootstrap username automatically
# (default, see cmd/setup/steps.yaml) unless the username is an email address —
# so the real login name is NOT the username alone. Read it from the running
# instance instead of guessing it from ORG_NAME.
zitadel_login_name() {
  local user db_user db_name name
  user=zitadel-admin
  db_user=zitadel
  db_name=zitadel
  name=$("${COMPOSE[@]}" exec -T db psql -U "$db_user" -d "$db_name" -tAc \
    "select login_name from projections.login_names3 where login_name_lower like '${user}@%' order by login_name limit 1;" \
    2>/dev/null | tr -d '[:space:]')
  echo "${name:-$user}"
}

echo "Baue App-Image aus lokalem Dockerfile..."
"${COMPOSE[@]}" build app

echo "Starte kompletten Stack (ohne backup — für den lokalen Test irrelevant)..."
# On the very first Zitadel setup, zitadel-init creates project + OIDC app and writes
# client id/secret to the bootstrap volume; app reads them from there.
SERVICES=(db zitadel zitadel-login zitadel-init caddy app zitadel-init-hooks)
[[ $WITH_ERRORS -eq 1 ]] && SERVICES+=(bugsink bugsink-init)
"${COMPOSE[@]}" up -d "${SERVICES[@]}"

# bugsink-init must finish before the app restart below, so the app reads the DSN file on that one restart.
if [[ $WITH_ERRORS -eq 1 ]]; then
  echo "Warte auf bugsink-init (legt Projekt an, schreibt DSN)..."
  until [[ "$(docker inspect -f '{{.State.Status}}' "$("${COMPOSE[@]}" ps -aq bugsink-init)")" == "exited" ]]; do sleep 2; done
  "${COMPOSE[@]}" run --rm --no-deps -T --entrypoint test bugsink-init -s /bugsink/dsn \
    || { echo "FEHLER: bugsink-init hat keine DSN geschrieben" >&2; "${COMPOSE[@]}" logs bugsink-init >&2; exit 1; }
  echo "OK: DSN-Datei vorhanden"
fi

echo "Warte auf Caddys lokales CA-Zertifikat..."
until "${COMPOSE[@]}" exec -T caddy test -f /data/caddy/pki/authorities/local/root.crt 2>/dev/null; do
  sleep 1
done
# app only reads NODE_EXTRA_CA_CERTS at start — restart it once the CA certificate exists.
"${COMPOSE[@]}" restart app >/dev/null

# Fragt den aktiven SMTP-Provider per Zitadel-API ab (PAT liegt im zitadel-admin-Volume, nur im Init-Container gemountet).
zitadel_smtp_user() {
  "${COMPOSE[@]}" run --rm --no-deps -T --entrypoint node zitadel-init -e '
    const { readFileSync } = require("node:fs");
    const pat = readFileSync("/zitadel/admin/admin.pat", "utf8").trim();
    // node:http statt fetch: fetch ignoriert den Host-Header, Zitadel löst die Instanz darüber auf.
    require("node:http").get(
      { host: "zitadel", port: 8080, path: "/admin/v1/email", headers: { host: process.env.ZITADEL_DOMAIN, "x-forwarded-proto": "https", authorization: `Bearer ${pat}` } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => console.log(JSON.parse(b).config?.smtp?.user ?? "NONE"));
      },
    );
  ' | tail -n1 | tr -d '[:space:]'
}
assert_smtp_user() {
  local got
  got=$(zitadel_smtp_user)
  if [[ "$got" != "$1" ]]; then
    echo "FEHLER: Zitadel-SMTP-User ist '$got', erwartet '$1'" >&2
    exit 1
  fi
  echo "OK: Zitadel-SMTP-User = $1"
}

echo "Prüfe SMTP-Sync (erster Lauf)..."
assert_smtp_user "$(grep '^SMTP_USER=' "$ENV_FILE" | cut -d= -f2)"
echo "Prüfe SMTP-Sync (erneuter Lauf mit geändertem SMTP_USER, muss idempotent aktualisieren)..."
SMTP_USER=second-user "${COMPOSE[@]}" run --rm --no-deps -T zitadel-init
assert_smtp_user second-user

APP_DOMAIN=$(grep '^SERVICE_FQDN_APP=' "$ENV_FILE" | cut -d= -f2)
ADMIN_PASS=$(grep '^SERVICE_PASSWORD_ADMIN=' "$ENV_FILE" | cut -d= -f2)
ZITADEL_DOMAIN=$(grep '^SERVICE_FQDN_ZITADEL=' "$ENV_FILE" | cut -d= -f2)
ZITADEL_PASS=$(grep '^SERVICE_PASSWORDWITHSYMBOLS_ZITADELADMIN=' "$ENV_FILE" | cut -d= -f2)Aa1!
ZITADEL_LOGIN_NAME=$(zitadel_login_name)
BUGSINK_INFO=""
if [[ $WITH_ERRORS -eq 1 ]]; then
  BUGSINK_INFO="Bugsink: https://$(grep '^SERVICE_FQDN_BUGSINK=' "$ENV_FILE" | cut -d= -f2)
  Login: admin@example.org / $(grep '^SERVICE_PASSWORD_BUGSINK=' "$ENV_FILE" | cut -d= -f2)
  Link auch unter Admin → Konfiguration (Tab \"Fehler-Tracker\")

"
fi
cat <<EOF

Fertig. https://$APP_DOMAIN ist erreichbar (Zertifikatswarnung akzeptieren).

Admin-Login: /admin/login, Passwort: $ADMIN_PASS

Zitadel-Console: https://$ZITADEL_DOMAIN
  Login-Name: $ZITADEL_LOGIN_NAME
  Passwort:   $ZITADEL_PASS (nach der erzwungenen Änderung beim ersten Login
              gilt dein neues Passwort)

OIDC-Login-Test: passenden Benutzer unter Admin → Benutzer anlegen, oder
Selbstregistrierung testen:
  1. Zitadel: Settings → Login Behavior and Security → "Register allowed"
     (Bestätigungsmails brauchen SMTP — Zitadel: Notification settings)
  2. on-duty: https://$APP_DOMAIN/admin/config → registrationEnabled
     (und ggf. registrationAutoApprove + registrationDefaultRoleId)
  Siehe docs/oidc.md, Abschnitt "Selbstregistrierung".

${BUGSINK_INFO}Neustart nach Codeänderungen: einfach erneut ausführen (baut App neu, Volumes
bleiben erhalten). Fresh-Install-Test: $0 --clean
EOF
