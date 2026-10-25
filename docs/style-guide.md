# Styleguide

Soll-Zustand für Layout, Farben, Typografie, Tabellen und Buttons in on-duty. Basiert auf einer Bestandsaufnahme des Codes (Stand 2026-09-30) — wo der aktuelle Code abweicht, ist das unten explizit vermerkt ("⚠️ Abweichung im Code"). Ziel: neue Views folgen diesen Regeln von Anfang an; bestehende Abweichungen werden bei Gelegenheit angeglichen (separater Task, nicht automatisch).

**Nicht abgedeckt** (bewusst zurückgestellt, nicht bewusst ausgeschlossen): Modals, Cards, Badges, Dropdowns, Terminologie/Wortwahl. Ergänzung folgt bei Bedarf in einer späteren Runde.

## Formulare & Labels

daisyUI v5. Die v4-Klassen `form-control`, `label-text`, `input-bordered`, `select-bordered` sind verboten (Grep-Test `daisyui-v4-classes.test.ts`).

- **Text/Select/Textarea:** `Field` (`src/components/field.tsx`) mit Floating Label; `placeholder` wiederholt den Labeltext. Pflichtstern (`text-error ml-1`) sitzt in `Field`.
- **Datumsfelder** (`date`, `datetime-local`, `month`): `Field floating={false}` (`fieldset` + festes Label darüber), da das Browser-Format mit Floating Label kollidiert.
- **Checkbox/Toggle/Radio:** `<label class="label cursor-pointer justify-start gap-2 pointer-coarse:min-h-11">` um Input + Text.
- **Gruppen** (Radio-Liste, Von/Bis): `FieldGroup` (`fieldset` + `legend.fieldset-legend`).
- **Beispiele/Formatvorgaben:** als `hint` unter dem Feld, nicht als Placeholder.
- **Sonderfälle:** `ChipInput` und Such-Inputs mit Icon bleiben ohne `Field`, nur v5-Klassen.

## Farben/Theme

Definiert in `src/styles/app.css`. daisyUI liest Tailwind-v4-Farbtokens aus `:root`, daher stehen die Werte doppelt in `@theme` und `:root` (siehe Kommentar dort zur Layer-Reihenfolge — nicht versehentlich doppelt, sondern ein Workaround).

| Token | Wert | Verwendung |
|---|---|---|
| `--color-primary` | `#cc0000` | Aktiv genutzt — Feuerwehr-Rot, treibt daisyUIs `primary`-Klassen (`btn-primary`, `text-primary`, Badges etc.) |
| `--color-primary-dark` | `#990000` | Abgeleiteter dunklerer Rotton |
| `--color-gold` | `#f0a500` | ⚠️ Reserviert, aktuell **ungenutzt** im Code |
| `--color-dark` | `#0f2338` | ⚠️ Reserviert, aktuell **ungenutzt** im Code |
| `--color-surface` | `#f8f8f8` | ⚠️ Reserviert, aktuell **ungenutzt** im Code |

**Regel:** `gold`/`dark`/`surface` nicht "weil sie schon da sind" verwenden. Wird ein Anwendungsfall gebraucht, den Zweck hier dokumentieren. Bleiben sie dauerhaft ungenutzt, sind sie Kandidat zum Entfernen aus `app.css`.

Für alles andere: daisyUI-Semantikfarben verwenden (`base-100`/`base-200`/`base-300`, `error`, `success`, `info`, `warning`, `neutral`), keine Hex-Werte oder Arbitrary-Values im Markup.

## Typografie

Zwei Font-Families, als CSS-Variablen definiert:

- `--font-heading`: **Oswald** (700) — für `<h1>`
- `--font-body`: **Inter** (400/500) — Standard-Body-Font (kein expliziter Klassenaufruf nötig, ist Browser-Default über `app.css`)

**Regel für Seitentitel:** Der `<h1>` entsteht ausschließlich in `PageHeader` (`src/components/page-header.tsx`), nie freistehend (Ausnahme: Fehlerseiten 403/404/500 und Login-Karten ohne `Layout`-Nav).

Keine weiteren Heading-Ebenen (`h2`/`h3`) mit eigener Konvention etabliert — bei Bedarf hier ergänzen, bevor neue Varianten frei erfunden werden.

## Seiten-Layout-Struktur

Jede Seite wird über `Layout` (`src/components/layout.tsx`) gerendert: `<main class="container mx-auto px-4 py-6">` als äußerer Wrapper, direkt darin der Seiteninhalt.

**Seitenkopf:** `PageHeader` (`title`, `backHref?`/`backLabel?`, `subtitle?`, `actions?`) — Titel links, Aktionen rechtsbündig (Primär zuletzt). Aktionen sind `HeaderAction` (`variant`, `icon`, `label`; setzt `aria-label` + `title`) bzw. `FormActions` (Abbrechen / Speichern & Neu / Speichern).

**Such-/Filterleiste:** Listenseiten mit Suche/Filtern setzen die Klasse `filter-bar` (`src/styles/app.css`) auf den Wrapper der Leiste. Sticky-Verhalten siehe unten.

**Zeitraum-Filter:** Seiten mit Von/Bis-Filter nutzen `QuickRangeFilter` (`src/components/quick-range-filter.tsx`) und lösen die URL über `parseRange` (`src/lib/quick-range.ts`) auf. Das Dropdown bietet Presets, „Relativ" und „Benutzerdefiniert"; Datumsfelder erscheinen nur bei „Benutzerdefiniert". URL: `range=<preset-id>|rel|custom`; bei `rel` zusätzlich `rel=P<n><D|W|M|Y>` und `dir=past|future|both`. Angewendet wird mit dem gemeinsamen `ApplyButton` (unter `sm` nur Icon). Links, die den Bereich erhalten sollen, übernehmen `rangeParams(range)`.

**Formulare:** Speichern/Abbrechen/Löschen stehen im Kopf, nicht unter dem Formular. Jedes Formular bekommt eine feste `id`; der Kopf-Button verweist per `form="<id>"` darauf (kein JS, Enter im Feld funktioniert weiter). Löschen = eigenes kleines `<form>` im Inhalt, Button im Kopf zeigt per `form=` darauf. Bei mehreren Formularen zeigt der Kopf nur auf das Hauptformular.

**Icon-only (Container-Queries):** Stufe 1 (Kopf < `@xl`): Labels der sekundären Aktionen entfallen; Stufe 2 (< `@md`): auch das Label der primären Aktion. Icon bleibt, `aria-label`/`title` tragen den Namen.

**Untermenü:** `SubNav` (`src/components/sub-nav.tsx`) ersetzt alle `tabs-lifted`: `tabs-sm` (~32 px), `bg-base-300`, 1 px Rahmen unten, aktiver Tab mit `primary`-Unterstrich.

**Sticky:** Gestapelt von oben nach unten, jede Ebene klebt direkt unter der vorigen:

| Ebene | Element | z-index | Sichtbar |
|---|---|---|---|
| 1 | Hauptnav | 40 | immer |
| 2 | Untermenü (`.subnav`) | 30 | ab `md` |
| 3 | `PageHeader` | 20 | immer |
| 4 | Such-/Filterleiste (`.filter-bar`) | 15 | ab `md` (darunter `static`, da mehrzeilig zu hoch) |
| unten | `Pager` (gekürztes Fenster: erste/letzte Seite, aktuelle ±1, „…“; ab 8 Seiten Sprechblase über der aktuellen Seite zur Seitenwahl; unter `md` nur aktuelle Seite mit Sprechblase, immer einzeilig) | 10 (30 solange die Seitenwahl offen ist) | immer |

Regeln:
- Offsets laufen über CSS-Variablen in `app.css` (`--nav-h`, `--subnav-h`, `--header-h`); nie feste Pixel/rem-Werte inline. Neue sticky Ebene = neue Variable + Eintrag in dieser Tabelle.
- Sticky-Elemente brauchen einen deckenden Hintergrund (`bg-base-100`/`bg-base-300`).
- Popover/Dropdowns (`MultiSelectFilter`) liegen über allen Ebenen (`z-50` bzw. Top Layer); neue Ebenen bleiben unter 20.
- Kein Vorfahr darf `overflow` ≠ `visible` haben, sonst bricht Sticky. Deshalb stehen Pager und Leiste **außerhalb** von `overflow-x-auto`-Wrappern.
- Sticky gilt nur innerhalb des Eltern-Elements: Leiste und Liste/Tabelle müssen im selben Container liegen, ohne Zwischen-Wrapper mit kurzer Höhe. Fehlerbild: Leiste scrollt nach kurzer Strecke weg (so zuvor in `/anniversaries`).
- `display: contents` am Sticky-Element selbst ist wirkungslos; Klasse an das umgebende `<div>` setzen.
- `--header-h` ist geschätzt (3.5rem); ändert sich die Höhe des `PageHeader`, muss der Wert mit.

**Zurück-Link:** Detail- und Formularseiten setzen `backHref` auf die Liste.

## Tabellen

Zwei Kategorien, bewusst unterschiedlich behandelt — nicht alles muss wie die großen Listen aussehen:

### Haupt-Listen-Tabellen
(members, donors, donations, applications — die primäre Datenliste einer Seite)

- `class="table table-zebra w-full"`
- Sortierbare Spalten wo fachlich sinnvoll (Klick auf Spaltenkopf, `SortIcon`-Komponente als Indikator) — nicht zwingend auf jeder Spalte
- Pagination bei potenziell langen Listen: `<Pager>` (`src/components/pager.tsx`), sticky am unteren Viewport-Rand (`sticky bottom-6 z-10 bg-base-100 border-t` (`bottom-6` = Höhe des fixen Versions-Footers, damit die Version sichtbar bleibt), deckender Hintergrund). Sticky bezieht sich auf den nächsten Scroll-Container: Vorfahren dürfen kein `overflow` ≠ `visible` haben, der Pager steht daher **außerhalb** des `overflow-x-auto`-Tabellen-Wrappers. Mobil (unter `md`) bricht der Pager nie um: Zähler, Seitengrößen-Select (ohne Label, nur `aria-label`) und nur die aktuelle Seite; die Seitenwahl läuft immer über die Sprechblase, auch bei ≤ 7 Seiten.
- Empty State: `<tr><td colspan={N} class="text-center opacity-50 py-8">{leerer-Text}</td></tr>`

Die Kategorie richtet sich nur danach, ob die Tabelle die **primäre Datenliste ihres Tabs/ihrer Seite** ist — nicht danach, ob zusätzlich eine Breiten-Einschränkung (`max-w-*`) angewendet wird. `max-w-*` gehört auf den Wrapper/die Tabelle als zusätzlicher Modifier, entscheidet aber nicht die Kategorie (Haupt-Liste vs. Sub-Tabelle).

⚠️ Abweichung im Code: keine — `anniversaries.tsx` (Hauptliste) und alle `admin.tsx`-Tabs nutzen konsistent `table-zebra w-full`; `admin.tsx`s Rollen-/Berechtigungs-Sub-Tabellen sowie `members.tsx`s Rollen-Zuweisungszeilen nutzen konsistent die Sub-Tabellen-Klasse unten.

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
| `btn` (ohne Farb-Modifier, `join-item`) | Neutrale Pagination-Controls; Ausnahme: aktuelle Seite = `btn btn-primary` |

Größen: `btn` ohne Größen-Modifier nur für große ist Standard für Aktionen innerhalb einer Seite (Header-Zeile, Tabellen-Zeilen), `btn-sm` für kompakte oder `btn-xs` für sehr kompakte Kontexte (z.B. innerhalb einer Tabellenzelle).

### Zeilenaktionen

Jede Aktion in einer Tabellenzeile (Bearbeiten, Löschen inkl. Modal-Auslöser, Kopieren, Aktivieren, ↑/↓) ist eine `RowAction` (`src/components/row-action.tsx`): `btn btn-xs` mit Icon, das Label verschwindet unter `md` (`max-md:hidden`). `aria-label` ist immer das Label, `title` standardmäßig ebenfalls; bei deaktivierten Buttons trägt `title` die Begründung. Icons: Bearbeiten `pencil`, Löschen `trash`, Kopieren `document-duplicate`, Aktivieren `check`, Ablehnen `x-mark`, Deaktivieren `no-symbol`, ↑/↓ `arrow-up`/`arrow-down`. Nicht betroffen: Formular-Buttons, Filter-Buttons und Buttons außerhalb von Tabellen.

## Responsive Schwellen

- **Mobil = `md` (768 px / `48rem`).** Darunter: Burger-Menü, kompakter Pager, icon-only Zeilenaktionen, statische Filterleiste und Untermenü. Neue Mobil-Umschaltungen nutzen `md`, nicht `sm`.
- **Ausnahmen:** `sm:` für Formular-Grids (`sm:grid-cols-`, `sm:col-span-`); Spalten-Ausblendung (`md:`/`lg:`/`xl:table-cell`); Container-Queries im Seitenkopf (`HeaderAction`) und in der Kategorie-Auswahl des Inventar-Formulars (`@container`: `<select>` unter `@sm`, nur Icons bis `@xl`, darüber Icon + Text; Radios bleiben die einzige submittete Quelle, das `<select>` hat keinen `name`); PageHeader und Monatszeilen der Jubiläumsliste bleiben auch unter `md` sticky.

## Touch-Ziele

Bei `pointer: coarse` (Handy, Tablet) sind interaktive Elemente mindestens 44×44 px. Das regelt zentral `src/styles/app.css` (`min-height: 2.75rem` für `.btn`, `.join-item`, Menü-Einträge; `min-width` nur für icon-only Buttons). Checkboxen bleiben klein (daisyUI-Größe); die Trefferfläche entsteht über das umgebende `<label>` mit `pointer-coarse:min-h-11`. Einzelne Buttons bekommen dafür keine eigenen Klassen; mit Maus bleibt die kompakte Größe.
