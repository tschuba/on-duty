# Rollen × Berechtigungen (Standardrollen)

Quelle der Wahrheit: `APP_ROLES` in `src/db/seed.ts`, Permission-Liste in `src/lib/roles.ts`.
Diese Matrix bei jeder Änderung dort mitpflegen. Aufgeführt sind die Werte aus dem Seed.

| Permission                 | Administrator | Bearbeiter | Leser | Vorstand | Führung | Finanzen |
|----------------------------|:---:|:---:|:---:|:---:|:---:|:---:|
| `members:read`             |   | ✔ | ✔ | ✔ | ✔ | ✔ |
| `members:write`            |   | ✔ |   | ✔ | ✔ |   |
| `members:bank-data:read`   |   |   |   |   |   |  ✔ |
| `members:bank-data:write`  |   |   |   |   |   |  ✔ |
| `members:delete`           |   |   |   | ✔ | ✔ |   |
| `system:admin`             | ✔ |   |   |   |   |   |
| `donations:read`           |   | ✔ |   | ✔ |   |   |
| `donations:record`         |   | ✔ |   | ✔ |   |   |
| `donations:delete`         |   |   |   | ✔ |   |   |
| `donations:issue-receipts` |   |   |   | ✔ |   |   |
| `applications:read`        |   | ✔ |   | ✔ |   |   |
| `applications:record`      |   | ✔ |   | ✔ |   |   |
| `applications:review`      |   |   |   | ✔ |   |   |
| `applications:manage-forms`| ✔ | ✔ |   | ✔ |   |   |
| `inventory:read`           |   |   | ✔ | ✔ | ✔ |   |
| `inventory:manage`         |   |   |   | ✔ | ✔ |   |
| `lending:read`             |   |   | ✔ | ✔ | ✔ |   |
| `lending:manage`           |   |   |   | ✔ |   |   |
| `org:read`                 |   |   | ✔ | ✔ | ✔ | ✔ |
| `org:write`                |   | ✔ |   | ✔ | ✔ |   |
| `org:tax-data:read`        |   |   |   | ✔ |   | ✔ |
| `org:tax-data:write`       |   |   |   |   |   | ✔ |
| `import:run`               | ✔ |   |   |   |   |   |

## Hinweis

- Änderungen an Standardrollen brauchen immer eine Migration, weil der Seed nur fehlende Einträge ergänzt (zuletzt `drizzle/0026_role_permissions_backfill.sql`).
