# GitHub-Konfiguration

Einmalige Einrichtung für ein neues Repository.

## `REPO_SETTINGS_TOKEN` anlegen

Wird von `.github/workflows/apply-repo-settings.yml` benötigt, um Branch-Schutzregeln und Merge-Strategie anzuwenden.

**Token erstellen:** GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens

Berechtigungen (Repository-spezifisch):
- `Administration` → Read and write
- `Contents` → Read-only

**Secret hinterlegen:** Repository → Settings → Secrets and variables → Actions → New repository secret → Name: `REPO_SETTINGS_TOKEN`

Danach einmalig den Workflow triggern: Actions → "Apply repo settings" → Run workflow.
