# Beitragen

Beiträge sind willkommen. Bitte halte dich an folgende Konventionen.

## Branch-Benennung

Branch-Namen sind immer auf **Englisch**.

```
feature/<description>
fix/<description>
chore/<description>
```

## Commit-Nachrichten

Dieses Projekt verwendet [Conventional Commits](https://www.conventionalcommits.org/). Commit-Titel und -Text sind immer auf **Englisch**.

```
<type>[optional scope]: <description>
```

Erlaubte Typen: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`, `revert`

Beispiele:
```
feat: add member export
fix(auth): fix session expiry on OIDC redirect
chore: update dependencies
```

Ein Git-Hook prüft das Format automatisch. Einmalig einrichten:

```bash
pnpm install  # richtet den Hook automatisch ein
```

## Pull Requests

- PR-Titel und -Beschreibung sind immer auf **Englisch**.
- Der PR-Titel muss dem Conventional-Commits-Format (`<type>[optional scope]: <description>`, erlaubte Typen siehe oben) entsprechen und den Check **PR Title** bestehen (`.github/workflows/pr-version-bump.yml`).

## Sprache

| Bereich | Sprache |
|---|---|
| Quellcode, Bezeichner, Routen, Logs | Englisch |
| Dokumentation (README, Docs) | Deutsch |
| UI-Texte | i18n-Dateien (`src/i18n/de.ts` + `src/i18n/en.ts`) |

Keine UI-Texte direkt in Templates — ausschließlich über i18n-Schlüssel.

## i18n

Neue UI-Texte müssen in beiden Sprachdateien ergänzt werden:

- `src/i18n/de.ts` — Deutsch
- `src/i18n/en.ts` — Englisch

## Konstanten statt Magic Values

Zahlen und Strings dürfen nicht direkt im Code stehen — sie erhalten einen benannten Bezeichner.

**Neuer Code** darf keine Magic Values enthalten. **Bestehender Code** wird bereinigt, sobald eine Datei angefasst wird.

Wo Konstanten ablegen:

- Modullokal: als `const` exportieren in derselben Datei
- Projektübergreifend: in `src/lib/constants.ts`

Dasselbe gilt für projektübergreifend genutzte **Funktionen** (nicht nur Konstanten): in eine thematisch benannte `src/lib/*.ts`-Datei (z. B. `flash.ts`, `format.ts`, `list-query.ts`), nicht in eine Catch-all-`utils.ts`/`helpers.ts`.

```ts
// ❌
if (member.age >= 18) { ... }
if (member.status === "active") { ... }

// ✅
const MIN_ADULT_AGE = 18;
const ACTIVE_STATUS = "active";
if (member.age >= MIN_ADULT_AGE) { ... }
if (member.status === ACTIVE_STATUS) { ... }
```

## Lokale Entwicklung

Siehe [README](README.md).

## Datenbankmigrationen

Nach Schema-Änderungen Migration generieren und committen:

```bash
pnpm db:generate
```

## Tests

Vor jedem PR:

```bash
pnpm test
```

Geteilte Test-Helper (z. B. Request-Builder) gehören nach `src/tests/test-utils.ts`, geteilte Daten-Fixtures nach `src/tests/fixtures.ts` — nicht pro Testdatei neu definieren.

### Coverage

CI blockt PRs, die die Coverage ggü. `master` verschlechtern, sowie neue Zeilen mit <80% Abdeckung (siehe PR-Kommentar).

Beim Nachziehen von Coverage auf Code, der Entscheidungen mit I/O mischt (z. B. Auth-/Berechtigungsprüfungen): nicht die Logik mit `v8 ignore` wegkommentieren oder in eine separate Pure-Function extrahieren, die die echten Verzweigungen nur nachbildet — beides lässt die eigentliche Entscheidung ungetestet und macht die Metrik hohl. Stattdessen an einer dünnen, stabilen Grenze mocken (der eine externe Call, die eine Query) und die echte Funktion end-to-end durchlaufen lassen.

## Pull Requests

- Kein direktes Pushen auf `main` — ausschließlich per PR
- Squash Merge wird verwendet

## Release

Der PR-Titel ist ein Conventional Commit (Squash-Merge übernimmt ihn als Commit-Nachricht). Der Check `Bump Version` setzt daraus die Version in `package.json` und pusht einen Bump-Commit auf den PR-Branch:

| Titel | Bump |
| --- | --- |
| `fix:`, `perf:` | patch |
| `feat:` | minor |
| `feat!:` / `BREAKING CHANGE` im PR-Text | major |
| `chore:`, `docs:`, `test:`, `ci:`, `style:`, `build:`, `refactor:`, `revert:` | kein Bump |

Ändert ein PR Dateien, die ins Image einfließen (`src/`, `drizzle/`, `public/`, `package.json`, Lockfile, `Dockerfile`, Build-Configs, `scripts/zitadel-init.mjs`, `scripts/copy-*.mjs`), ist ein Bump-Typ (`fix`/`feat`/`perf`) Pflicht, sonst schlägt der Check fehl.

Nach dem Merge mit neuer Version entstehen Tag `vX.Y.Z` und ein Release-**Draft**. Das Veröffentlichen des Drafts baut die Docker-Tags `latest`, `X.Y.Z`, `X.Y`, `X`; `edge` kommt bei jedem Push auf `master`.
