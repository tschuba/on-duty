# Backup

on-duty sichert die Postgres-DB per `pg_dump` (custom format `-Fc`). Der Scheduler läuft im App-Prozess via `node-cron`. Zwei Ziele unabhängig voneinander konfigurierbar, Fan-out möglich.

- [Lokales Ziel (Entwicklung / Test)](#lokales-ziel-entwicklung--test)
- [S3-Ziel (Produktion) — MinIO auf Ugreen NAS DXP 2800](#s3-ziel-produktion--einrichtung-minio)
  - [MinIO einrichten (einmalig)](#minio-einrichten-einmalig)
  - [on-duty konfigurieren (Coolify Env-Vars)](#on-duty-konfigurieren-coolify-env-vars)
- [Retention](#retention)
- [Zeitplan](#zeitplan)
- [Startup-Validierungen](#startup-validierungen)
- [Restore](#restore)

---

## Lokales Ziel (Entwicklung / Test)

```bash
mkdir backups
```

`.env.local`:

```env
BACKUP_LOCAL_PATH=./backups
```

Backup manuell auslösen: `/admin/backup` → „Backup jetzt starten".  
Dateien landen als `backup_YYYY-MM-DD-HH-MM-SS.dump` im Verzeichnis.

Dump inspizieren:

```bash
pg_restore --list backups/backup_*.dump
```

---

## S3-Ziel (Produktion) — Einrichtung MinIO

### MinIO einrichten (einmalig)

1. Container erstellen:
   - Image: `minio/minio`
   - Port: `9000:9000` (S3 API), `9001:9001` (Web UI)
   - Env: `MINIO_ROOT_USER=admin`, `MINIO_ROOT_PASSWORD=<sicheres-passwort>`
   - Volume: NAS-Pfad → `/data`
   - Start-Befehl: `server /data --console-address :9001`
2. Web UI aufrufen: `http://<DOCKER-HOST-IP>:9001`
3. Bucket anlegen: `on-duty`
4. Access Key erstellen: Identity → Service Accounts → **Create access key**  
   → Access Key + Secret Key notieren

### on-duty konfigurieren (Coolify Env-Vars)

```env
S3_ENDPOINT=http://<NAS-IP>:9000
S3_BUCKET=on-duty
S3_ACCESS_KEY=<access-key>
S3_SECRET_KEY=<secret-key>
S3_PREFIX=backups/
```

`S3_REGION` kann leer bleiben (MinIO ignoriert es, Default `us-east-1` wird gesetzt).

---

## Retention

`BACKUP_RETENTION_COUNT=4` (Default) — älteste Dumps werden nach einem erfolgreichen Lauf gelöscht, pro Ziel unabhängig.

---

## Zeitplan

`BACKUP_SCHEDULE=0 2 * * 0` — wöchentlich Sonntag 02:00 (Default).  
Cron-Syntax: Standard POSIX, 5 Felder.

---

## Startup-Validierungen

| Bedingung | Verhalten |
| --- | --- |
| `S3_*` nur teilweise gesetzt | App startet nicht |
| `BACKUP_LOCAL_PATH` gesetzt aber nicht schreibbar | App startet nicht |
| Kein Ziel konfiguriert | App startet, Warn-Banner im Admin-Bereich |

---

## Restore

```bash
# Datenbank leeren und wiederherstellen
pg_restore --clean --if-exists -d "$DATABASE_URL" backup_*.dump
```
