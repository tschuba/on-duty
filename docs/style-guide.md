# Styleguide

Soll-Zustand für Layout, Farben, Typografie, Tabellen und Buttons in on-duty. Basiert auf einer Bestandsaufnahme des Codes (Stand 2026-09-30) — wo der aktuelle Code abweicht, ist das unten explizit vermerkt ("⚠️ Abweichung im Code"). Ziel: neue Views folgen diesen Regeln von Anfang an; bestehende Abweichungen werden bei Gelegenheit angeglichen (separater Task, nicht automatisch).

**Nicht abgedeckt** (bewusst zurückgestellt, nicht bewusst ausgeschlossen): Modals, Formulare, Cards, Badges, Dropdowns, Terminologie/Wortwahl. Ergänzung folgt bei Bedarf in einer späteren Runde.

## Farben/Theme

Definiert in `src/styles/app.css`. daisyUI liest Tailwind-v4-Farbtokens aus `:root`, daher stehen die Werte doppelt in `@theme` und `:root` (siehe Kommentar dort zur Layer-Reihenfolge — nicht versehentlich doppelt, sondern ein Workaround).

| Token | Wert | Verwendung |
|---|---|---|
| `--color-primary` | `#cc0000` | Aktiv genutzt — Feuerwehr-Rot, treibt daisyUIs `primary`-Klassen (`btn-primary`, `text-primary`, Badges etc.) |
| `--color-primary-dark` | `#990000` | Abgeleiteter dunklerer Rotton |
| `--color-gold` | `#f0a500` | ⚠️ Reserviert, aktuell **ungenutzt** im Code |
| `--color-dark` | `#1c1c1c` | ⚠️ Reserviert, aktuell **ungenutzt** im Code |
| `--color-surface` | `#f8f8f8` | ⚠️ Reserviert, aktuell **ungenutzt** im Code |

**Regel:** `gold`/`dark`/`surface` nicht "weil sie schon da sind" verwenden. Wird ein Anwendungsfall gebraucht, den Zweck hier dokumentieren. Bleiben sie dauerhaft ungenutzt, sind sie Kandidat zum Entfernen aus `app.css`.

Für alles andere: daisyUI-Semantikfarben verwenden (`base-100`/`base-200`/`base-300`, `error`, `success`, `info`, `warning`, `neutral`), keine Hex-Werte oder Arbitrary-Values im Markup.

## Typografie

Zwei Font-Families, als CSS-Variablen definiert:

- `--font-heading`: **Oswald** (700) — für `<h1>`
- `--font-body`: **Inter** (400/500) — Standard-Body-Font (kein expliziter Klassenaufruf nötig, ist Browser-Default über `app.css`)

**Regel für Seitentitel:**

```html
<h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">…</h1>
```

Detail-Seiten (z.B. Mitglieder-/Spender-Detailansicht), die unter einem Breadcrumb/Kontext-Element sitzen, bekommen zusätzlich `mt-1`:

```html
<h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">…</h1>
```

Keine weiteren Heading-Ebenen (`h2`/`h3`) mit eigener Konvention etabliert — bei Bedarf hier ergänzen, bevor neue Varianten frei erfunden werden.

## Seiten-Layout-Struktur

Jede Seite wird über `Layout` (`src/components/layout.tsx`) gerendert: `<main class="container mx-auto px-4 py-6">` als äußerer Wrapper, direkt darin der Seiteninhalt.

**Header-Zeile** (Titel + primäre Aktionen), durchgängiges Muster:

```html
<div class="flex items-center justify-between mb-4">
  <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">{title}</h1>
  <div class="flex items-center gap-2">
    <!-- Sekundäre Aktion(en) -->
    <!-- Primäre Aktion zuletzt -->
  </div>
</div>
```

Bei nur einer Aktion kann die innere `<div class="flex items-center gap-2">` entfallen, das `<a>`/`<button>` steht dann direkt als zweites Kind (siehe `donors.tsx`).

Kein Breadcrumb/"Zurück"-Link-Pattern im Code vorhanden — Navigation läuft über die Navbar bzw. Browser-Back. Nicht neu einführen, ohne das hier festzuhalten.

## Tabellen

Zwei Kategorien, bewusst unterschiedlich behandelt — nicht alles muss wie die großen Listen aussehen:

### Haupt-Listen-Tabellen
(members, donors, donations, applications — die primäre Datenliste einer Seite)

- `class="table table-zebra w-full"`
- Sortierbare Spalten wo fachlich sinnvoll (Klick auf Spaltenkopf, `SortIcon`-Komponente als Indikator) — nicht zwingend auf jeder Spalte
- Pagination bei potenziell langen Listen
- Empty State: `<tr><td colspan={N} class="text-center opacity-50 py-8">{leerer-Text}</td></tr>`

⚠️ Abweichung im Code: `anniversaries.tsx` nutzt `table table-sm` ohne Zebra für seine Hauptliste — sollte auf `table-zebra` angeglichen werden. `admin.tsx` hat vier verschiedene Table-Klassen-Kombinationen über seine Tabs hinweg — beim Angleichen einheitlich nach Kategorie sortieren (welche Tabs sind Haupt-Listen, welche Sub-Tabellen, siehe unten).

### Kleine Inline-Sub-Tabellen
(z.B. Rollen-/Berechtigungs-Listen in `admin.tsx` — wenige Zeilen, meist innerhalb eines Formular-/Admin-Kontexts)

- `class="table w-full"` (kein `table-zebra`)
- Keine Sortierung, keine Pagination
- Empty State: `<tr><td colspan={N} class="text-center opacity-50 py-4">{leerer-Text}</td></tr>` (`py-4` statt `py-8` — kompakter, passend zur kleineren Tabelle)

**Regel:** Innerhalb einer Kategorie ist die Klassenkombination und das Empty-State-Padding identisch. Eine neue Tabelle zuerst einer der beiden Kategorien zuordnen, dann deren Muster kopieren — nicht neu erfinden.

## Buttons

daisyUI-`btn`-Klassen, Bedeutung ist an die Farbe/Outline-Kombination gebunden, nicht an Kontext-Intuition:

| Klasse | Bedeutung |
|---|---|
| `btn btn-primary` (solid) | Primäre Aktion / Haupt-CTA (Speichern, Anlegen) |
| `btn btn-error` (solid) | Destruktive Aktion, die **direkt** ausführt (z.B. Löschen-Button im Formular) |
| `btn btn-outline btn-error` | Destruktiver **Trigger**, der zuerst einen Bestätigungsdialog öffnet — nie solid für den Trigger, solid ist reserviert für den tatsächlich ausführenden Button im Dialog |
| `btn btn-ghost` | Sekundäre/tertiäre Aktion, Navigation (Navbar-Links, Dropdown-Trigger) |
| `btn btn-outline btn-primary` (in `join-item`-Gruppe) | Aktiver Zustand in Filter-/Quick-Link-Pillen; inaktive Geschwister nutzen `btn-ghost` |
| `btn` (ohne Farb-Modifier, `join-item`) | Neutrale Pagination-Controls |

Größen: `btn-sm` ist Standard für Aktionen innerhalb einer Seite (Header-Zeile, Tabellen-Zeilen), `btn-xs` für sehr kompakte Kontexte (z.B. innerhalb einer Tabellenzelle), `btn` ohne Größen-Modifier nur für große, isolierte CTAs (z.B. Login).

⚠️ Abweichung im Code: aktuell nutzt nur `applications.tsx` (Antrag ablehnen) das Outline/Solid-Trigger/Confirm-Muster für eine destruktive Aktion. Andere destruktive Trigger in `admin.tsx` (z.B. Nutzer löschen/deaktivieren) öffnen zwar korrekt ein Bestätigungs-Modal, sind aber als `btn-ghost btn-xs text-error` statt `btn-outline btn-error` gestylt — beim Angleichen auf `btn-outline btn-error` umstellen.
