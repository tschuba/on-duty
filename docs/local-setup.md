# Lokaler Admin-Login

Der lokale Admin-Account ist unabhängig vom OIDC-Login und wird über ein eigenes Formular aufgerufen.

## Login

URL: `/admin/login`  
E-Mail: `admin@localhost.invalid`  
Passwort: Wert der Umgebungsvariable `ADMIN_PASSWORD` aus `.env`

## Account anlegen

Beim ersten Setup oder nach einem Reset:

```sh
pnpm db:seed
```

Das Passwort kann jederzeit in `.env` geändert werden — es wird beim nächsten Login automatisch übernommen, ohne Re-Seed.
