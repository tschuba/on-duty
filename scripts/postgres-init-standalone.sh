#!/bin/sh
# Läuft einmalig beim allerersten Start des db-Containers (leeres Datenverzeichnis),
# siehe /docker-entrypoint-initdb.d/-Mechanismus des offiziellen postgres-Images.
# Legt die zweite Datenbank für Zitadel + einen eigenen, nicht-privilegierten
# DB-User an (statt des onduty-Superusers) — siehe 08_Standalone-Deployment.md.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER "$ZITADEL_DB_USER" WITH PASSWORD '$ZITADEL_DB_PASSWORD';
    CREATE DATABASE "$ZITADEL_DB_NAME" OWNER "$ZITADEL_DB_USER";
    REVOKE ALL ON DATABASE "$ZITADEL_DB_NAME" FROM PUBLIC;
    GRANT ALL PRIVILEGES ON DATABASE "$ZITADEL_DB_NAME" TO "$ZITADEL_DB_USER";
EOSQL
