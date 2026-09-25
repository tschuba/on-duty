# GitHub-Konfiguration

Einmalige Einrichtung für ein neues Repository.

## Secrets

### `REPO_SETTINGS_TOKEN`

Wird von `.github/workflows/apply-repo-settings.yml` verwendet, um Branch-Schutzregeln und Merge-Strategie über die GitHub Rulesets API anzuwenden.

**Token erstellen:** GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens

Berechtigungen (Repository-spezifisch):
- `Administration` → Read and write (für Rulesets)
- `Contents` → Read-only (für Checkout)

**Secret hinterlegen:** Repository → Settings → Secrets and variables → Actions → New repository secret → Name: `REPO_SETTINGS_TOKEN`

### `GITHUB_TOKEN`

Wird von `.github/workflows/ci.yml` verwendet (Coverage-Report-Kommentar in PRs). Ist automatisch vorhanden — kein manuelles Secret nötig.

## Branch-Schutz & CI-Enforcement

Die Regeln liegen in `.github/repo-settings.yml` und werden automatisch angewendet:

- Bei jedem Push auf `master` (wenn die Datei geändert wurde)
- Täglich um 02:00 UTC (Drift-Korrektur)
- Manuell: Actions → "Apply repo settings" → Run workflow

**Enthaltene Regeln (aktuell):**
- PRs required (kein direktes Pushen auf `master`)
- Status-Check `test` required (CI-Job aus `ci.yml` muss grün sein)
- Non-fast-forward gesperrt
- Squash Merge only, Branch nach Merge löschen

## Ersteinrichtung (neues Repository)

```bash
# 1. Token erstellen (siehe oben) und als Secret hinterlegen

# 2. Regeln initial anwenden
# Actions → "Apply repo settings" → Run workflow
# (oder: push auf master mit Änderung an .github/repo-settings.yml)
```

## Actions-Berechtigungen

Für den Coverage-Report-Kommentar braucht `ci.yml` Schreibzugriff auf Pull Requests.
Die Permission ist im Workflow deklariert (`pull-requests: write`) — keine manuelle Einstellung nötig, sofern Actions standardmäßig aktiviert sind.
