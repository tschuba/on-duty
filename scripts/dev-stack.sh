#!/usr/bin/env bash
# Dev-Stack im Host-Modus: DB, Zitadel (+Login, Init), Caddy und optional Bugsink
# laufen in Docker, die App selbst per `pnpm dev` auf dem Host (https://app.localhost).
# Basis sind docker-compose.standalone.yml + docker-compose.standalone.local.yml
# (ohne Profil `app` → kein on-duty-Container).
#
#   scripts/dev-stack.sh up [--with-errors] | down | reset
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=on-duty-dev-stack
ENV_FILE=.env.standalone.dev # Compose --env-file
APP_ENV_FILE=.env.dev-stack  # für `pnpm dev`
OUT_DIR=.dev-stack           # CA + Webhook-Secret für den Host
COMPOSE=(docker compose -p "$PROJECT" -f docker-compose.standalone.yml -f docker-compose.standalone.local.yml --env-file "$ENV_FILE")

CMD=${1:-}
shift || true
WITH_ERRORS=0
for arg in "$@"; do
  case "$arg" in
    --with-errors) WITH_ERRORS=1 ;;
    *) echo "Unbekannte Option: $arg" >&2; exit 1 ;;
  esac
done

source scripts/lib/standalone-local.sh

# Lesen aus einem Compose-Volume über den (ohnehin vorhandenen) Init-Container.
volume_cat() { "${COMPOSE[@]}" run --rm --no-deps -T --entrypoint cat "$1" "$2"; }
wait_exited() {
  until [[ "$(docker inspect -f '{{.State.Status}}' "$("${COMPOSE[@]}" ps -aq "$1")")" == "exited" ]]; do sleep 2; done
}
env_get() { grep "^$1=" "$ENV_FILE" | cut -d= -f2-; }

case "$CMD" in
  up)
    [[ $WITH_ERRORS -eq 1 ]] && COMPOSE+=(--profile errors)
    ensure_standalone_env
    # Host-Modus: Caddy und Zitadel-Webhook erreichen die App über den Host.
    grep -q '^APP_UPSTREAM=' "$ENV_FILE" || cat >> "$ENV_FILE" <<EOT
APP_UPSTREAM=host.docker.internal:3000
WEBHOOK_URL=http://host.docker.internal:3000/hooks/zitadel
EOT

    echo "Baue Image für die Init-Container..."
    "${COMPOSE[@]}" --profile app build app
    SERVICES=(db zitadel zitadel-login zitadel-init caddy)
    [[ $WITH_ERRORS -eq 1 ]] && SERVICES+=(bugsink bugsink-init)
    "${COMPOSE[@]}" up -d "${SERVICES[@]}"

    echo "Warte auf zitadel-init..."
    wait_exited zitadel-init
    # hooks braucht das Admin-Token von zitadel-init und startet deshalb erst danach (kein app-Healthcheck mehr als Bremse).
    "${COMPOSE[@]}" up -d zitadel-init-hooks
    echo "Warte auf Caddys lokales CA-Zertifikat..."
    until "${COMPOSE[@]}" exec -T caddy test -f /data/caddy/pki/authorities/local/root.crt 2>/dev/null; do sleep 1; done
    mkdir -p "$OUT_DIR"
    "${COMPOSE[@]}" cp caddy:/data/caddy/pki/authorities/local/root.crt "$OUT_DIR/caddy-root.crt"

    echo "Warte auf zitadel-init-hooks..."
    wait_exited zitadel-init-hooks
    volume_cat zitadel-init-hooks /zitadel/bootstrap/webhook.secret > "$OUT_DIR/webhook.secret" || true

    # shellcheck disable=SC1090
    eval "$(volume_cat zitadel-init /zitadel/bootstrap/oidc.env | sed 's/^/export /')"
    DSN=""
    ERROR_TRACKER_URL=""
    if [[ $WITH_ERRORS -eq 1 ]]; then
      wait_exited bugsink-init
      DSN=$(volume_cat bugsink-init /bugsink/dsn)
      ERROR_TRACKER_URL="https://errors.localhost"
    fi

    cat > "$APP_ENV_FILE" <<EOT
DATABASE_URL=postgres://onduty:$(env_get SERVICE_PASSWORD_POSTGRES)@127.0.0.1:5433/onduty
ORG_NAME="$(env_get ORG_NAME)"
BETTER_AUTH_SECRET=$(env_get SERVICE_PASSWORD_BETTERAUTH)
ADMIN_PASSWORD=$(env_get SERVICE_PASSWORD_ADMIN)
OIDC_PROVIDER=https://$(env_get SERVICE_FQDN_ZITADEL)
OIDC_APP_URL=https://$(env_get SERVICE_FQDN_APP)
OIDC_CLIENT_ID=$OIDC_CLIENT_ID
OIDC_CLIENT_SECRET=$OIDC_CLIENT_SECRET
NODE_EXTRA_CA_CERTS=$PWD/$OUT_DIR/caddy-root.crt
ZITADEL_WEBHOOK_SECRET_FILE=$PWD/$OUT_DIR/webhook.secret
SENTRY_DSN=$DSN
ERROR_TRACKER_URL=$ERROR_TRACKER_URL
EOT

    echo "Migriere DB + lege Admin an..."
    (set -a; . "./$APP_ENV_FILE"; set +a; pnpm db:setup)

    cat <<EOT

Stack läuft. App starten: pnpm dev  →  https://$(env_get SERVICE_FQDN_APP)
Admin-Login: /admin/login, Passwort: $(env_get SERVICE_PASSWORD_ADMIN)

Zitadel-Console: https://$(env_get SERVICE_FQDN_ZITADEL)
  Login-Name: $(zitadel_login_name)
  Passwort:   $(env_get SERVICE_PASSWORDWITHSYMBOLS_ZITADELADMIN)Aa1! (nach der erzwungenen Änderung beim ersten Login gilt dein neues Passwort)
$(if [[ $WITH_ERRORS -eq 1 ]]; then cat <<BUGSINK

Bugsink: https://$(env_get SERVICE_FQDN_BUGSINK)
  Login: admin@bugsink.local / $(env_get SERVICE_PASSWORD_BUGSINK)
BUGSINK
fi)
Stoppen: pnpm stack:down — alles löschen: pnpm stack:reset
EOT
    ;;
  down)
    [[ -f "$ENV_FILE" ]] && "${COMPOSE[@]}" --profile errors --profile app down
    ;;
  reset)
    [[ -f "$ENV_FILE" ]] && "${COMPOSE[@]}" --profile errors --profile app down -v
    rm -rf "$ENV_FILE" "$APP_ENV_FILE" "$OUT_DIR"
    ;;
  *)
    echo "Usage: $0 up [--with-errors] | down | reset" >&2
    exit 1
    ;;
esac
