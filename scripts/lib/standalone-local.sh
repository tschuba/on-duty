# Gemeinsame Helfer für test-standalone-local.sh und dev-stack.sh.
# Erwartet ENV_FILE (Compose --env-file), WITH_ERRORS und COMPOSE (Array).

# Erzeugt ENV_FILE (falls fehlend) bzw. ergänzt Bugsink-/SMTP-Werte.
ensure_standalone_env() {
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
SERVICE_PASSWORD_64_BUGSINKSECRET=$(openssl rand -hex 32)
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
}

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
