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
| `member-roles:read`        | ✔ | ✔ |   | ✔ | ✔ |   |
| `member-roles:write`       | ✔ | ✔ |   |   |   |   |
| `member-roles:delete`      | ✔ |   |   |   |   |   |
| `member-role-types:read`   | ✔ | ✔ |   | ✔ | ✔ |   |
| `member-role-types:write`  | ✔ |   |   |   |   |   |
| `member-role-types:delete` | ✔ |   |   |   |   |   |
| `anniversary-years:read`   | ✔ | ✔ |   | ✔ | ✔ |   |
| `anniversary-years:write`  | ✔ | ✔ |   |   |   |   |
| `anniversary-years:delete` | ✔ |   |   |   |   |   |

## Hinweis

- Änderungen an Standardrollen brauchen immer eine Migration, weil der Seed nur fehlende Einträge ergänzt (zuletzt `drizzle/0026_role_permissions_backfill.sql`).
- Neue Permission-Werte (Enum) und ihre Vergabe an Standardrollen dürfen nicht in derselben Migration stehen, und Drizzle führt alle offenen Migrationen in einer Transaktion aus (Postgres: „unsafe use of new value"). Deshalb legt eine Migration nur den Enum-Wert an, die Vergabe übernimmt `APP_ROLES` im Seed beim nächsten Start (`src/entrypoint.ts` führt Migration und Seed nacheinander aus).
