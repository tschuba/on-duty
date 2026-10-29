# Backup-Überwachung

on-duty sichert die Datenbank **nicht selbst**. Das übernimmt der Container `backup` (`prodrigestivill/postgres-backup-local`, Service `backup` in `docker-compose.prod.yml` und `docker-compose.standalone.yml`). Nach jedem Lauf schreibt ein Hook (`/hooks/10-status`) eine `status.json` in das gemeinsame Volume `backup-status` (im `backup`-Container `rw` unter `/status`, in `app` `ro` unter `/backup-status`). on-duty zeigt den Status unter `/admin/backup`.

## status.json

```json
{"timestamp":"2026-10-15T02:00:03Z","status":"success","lastSuccess":"2026-10-15T02:00:03Z"}
```

`status` ist `success` oder `failed`. Bei `failed` bleibt `lastSuccess` aus der vorherigen Datei erhalten. Das Hook-Skript steht als Compose-`config` `backup-status-hook` in beiden Compose-Dateien; es läuft einmal pro Lauf (für alle DBs).

## Env-Vars

| Variable | Default | Bedeutung |
| --- | --- | --- |
| `BACKUP_STATUS_FILE` | — | Pfad zur `status.json` (im Compose `/backup-status/status.json`). Leer = Überwachung aus |
| `BACKUP_STATUS_MAX_AGE_HOURS` | `26` | Schwellwert; der Container läuft `@daily` |

## Zustände

| Zustand | Bedingung | Banner |
| --- | --- | --- |
| `ok` | `success`, jünger als Schwellwert | nein |
| `failed` | `status=failed` | ja |
| `stale` | `success`, aber älter als Schwellwert | ja |
| `unknown` | Datei fehlt oder ungültig (z. B. vor dem ersten Lauf) | nein |
| nicht eingerichtet | `BACKUP_STATUS_FILE` leer | nein |

Fehlerursache: `docker compose logs backup`. Einen Lauf sofort auslösen: `docker compose exec backup /backup.sh`.

## Externes Backup

Wer ein eigenes Backup betreibt, setzt `BACKUP_STATUS_FILE` und schreibt die `status.json` im obigen Format. S3-Sync der Dumps (z. B. rclone) liegt außerhalb von on-duty.

## Restore

Siehe [standalone-deployment.md](standalone-deployment.md#backup).
