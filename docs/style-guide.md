# Styleguide

Soll-Zustand für die UI von on-duty. Neue Views folgen diesen Regeln von Anfang an. Bekannte Abweichungen im Bestand sind mit „⚠️ Abweichung im Code“ markiert und werden bei Gelegenheit in einem eigenen Task angeglichen.

**Noch nicht abgedeckt:** Modals, Cards (außer Auswahl-Cards), Dropdowns, Terminologie/Wortwahl.

## Farben/Theme

Definiert in `src/styles/app.css`. daisyUI liest die Farbtokens aus `:root`, daher stehen die Werte absichtlich doppelt in `@theme` und `:root` (Workaround, siehe Kommentar dort).

| Token | Wert | Verwendung |
|---|---|---|
| `--color-primary` | `#2a5280` (Dark: `#5b8fd0`) | Blau; treibt alle daisyUI-`primary`-Klassen (`btn-primary`, `text-primary`, Badges, Datumsblock) |
| `--color-error` | `#cc0000` (Dark: `#ff6b6b`) | Feuerwehr-Rot, nur für Fehler und Destruktives |
| `--color-gold` | `#ffc107` | Nur für die Menü-Icons (`text-gold`) |

Sonst daisyUI-Semantikfarben (`base-100`/`-200`/`-300`, `error`, `success`, `info`, `warning`, `neutral`), keine Hex-Werte oder Arbitrary-Values im Markup.

## Typografie

- `--font-heading`: **Oswald** (700) für `<h1>`.
- `--font-body`: **Inter** (400/500), Standard über `app.css`, keine Klasse nötig.
- `font-mono` nur für technische Werte (Schlüssel, Thema, Betreff/Text mit Platzhaltern, Header); Rechte-Auswahl und übrige Felder bleiben in Body-Schrift.

**Seitentitel:** Der `<h1>` entsteht nur in `PageHeader`, nie freistehend (Ausnahme: Fehlerseiten 403/404/500, Login-Karten ohne `Layout`-Nav).

**Listenabschnitte:** `h2` mit `text-lg font-semibold mb-2`. Selbst angelegte Inhalte (z. B. „Eigene Vorlagen“ in `/mail/templates`) stehen vor mitgelieferten, mit `border-l-4 border-primary pl-4`, `text-primary` und einem `divider` davor.

Weitere Heading-Ebenen (`h3`) sind nicht festgelegt. Bei Bedarf hier ergänzen, nicht frei erfinden.

## Icons

Quelle: [Tabler Icons](https://tabler.io/icons) (Outline), Stroke 1,5. Neue Icons nur über die `ICONS`-Liste in `scripts/generate-icons.mjs` ergänzen (Name im Code → Tabler-Dateiname) und `pnpm icons:generate` ausführen; `icons.generated.ts` nie von Hand editieren. Es werden nur `<path>`-Icons unterstützt.

## Formulare & Labels

daisyUI v5. Die v4-Klassen `form-control`, `label-text`, `input-bordered`, `select-bordered` sind verboten (Grep-Test `daisyui-v4-classes.test.ts`).

- **Text/Select/Textarea/Datum** (`date`, `datetime-local`, `month`): `Field` (`src/components/field.tsx`) mit Floating Label; `placeholder` wiederholt den Labeltext. Pflichtstern (`text-error ml-1`) sitzt in `Field`. Das native Datumsformat kollidiert nicht mit dem Floating Label (geprüft in `inventory.tsx`, leer und vorbelegt, Desktop und mobil).
- **Checkbox/Toggle/Radio:** `<label class="label cursor-pointer justify-start gap-2 pointer-coarse:min-h-11">` um Input + Text.
- **Gruppen** (Radio-Liste, Von/Bis, Kategorie-/Rollen-Auswahl): `Field floating={false}` (`fieldset` + festes Label darüber) bzw. `FieldGroup`.
- **Beispiele/Formatvorgaben:** als `hint` unter dem Feld, nicht als Placeholder.
- **Sonderfälle:** `ChipInput` und Such-Inputs mit Icon bleiben ohne `Field`, nur v5-Klassen.

## Navigation

- Sidebar (`src/components/nav-menu.tsx`) statt Tab-Leisten: ab `lg` dauerhaft links (`w-64`, einklappbar auf Icon-Leiste `w-14`), darunter Drawer per Hamburger in der Navbar.
- Untermenüs sind `<details name="nav">` (Akkordeon); die Menüstruktur steht nur in `menuDefinition()`. Neue Seiten dort eintragen, nicht pro Route.
- Dritte Ebene: Ein Eintrag kann `children` haben (z. B. Inventar > Bestand > Prüfvorlagen/Felder). Er bleibt ein Link; die Kinder stehen als verschachteltes `<ul>` (daisyUI-`menu`) darunter und sind nur sichtbar, wenn er oder ein Kind aktiv ist. Kinder erscheinen nur bei sichtbarem Eltern-Eintrag.
- Aktive Unterseite `menu-active`, Obermenü der aktiven Seite fett und offen. Zähler `badge badge-sm badge-warning` (`badge-primary` für Fristen, `badge-error`, sobald im Eintrag etwas überfällig ist, z. B. Verleih); Obermenü zeigt die Summe, außer es ist aktiv.

## Seiten-Layout-Struktur

Jede Seite wird über `Layout` (`src/components/layout.tsx`) gerendert: `<main class="container mx-auto px-4 py-6">` als äußerer Wrapper, direkt darin der Seiteninhalt.

### Seitenkopf

`PageHeader` (`title`, `backHref?`/`backLabel?`, `subtitle?`, `actions?`) — Titel links, Aktionen rechtsbündig (Primär zuletzt). Detail- und Formularseiten setzen `backHref` auf die Liste. Aktionen sind `HeaderAction` (`variant`, `icon`, `label`; setzt `aria-label` + `title`) bzw. `FormActions` (Abbrechen / Speichern & Neu / Speichern).

### Such-/Filterleiste

Listenseiten mit Suche/Filtern setzen die Klasse `filter-bar` (`src/styles/app.css`) auf den Wrapper der Leiste. Sticky-Verhalten siehe „Sticky“.

### Zeitraum-Filter

Seiten mit Von/Bis-Filter nutzen `QuickRangeFilter` (`src/components/quick-range-filter.tsx`) und lösen die URL über `parseRange` (`src/lib/quick-range.ts`) auf. Das Dropdown bietet Presets, „Relativ" und „Benutzerdefiniert"; Datumsfelder erscheinen nur bei „Benutzerdefiniert". URL: `range=<preset-id>|rel|custom`; bei `rel` zusätzlich `rel=P<n><D|W|M|Y>` und `dir=past|future|both`. Angewendet wird mit dem gemeinsamen `ApplyButton` (unter `sm` nur Icon). Links, die den Bereich erhalten sollen, übernehmen `rangeParams(range)`.

### Status-Filter

Wenige feste Zustände (z. B. Alle/Anstehend/Erledigt) als daisyUI-`filter`: eigenes `<form method="get" class="filter">` in der `filter-bar` mit Radios `btn name="status"`, Reset-Radio `btn btn-square filter-reset` (Wert leer = „Alle", Standard) und `onchange="this.form.submit()"`. Zeitraum- und weitere Filter-Parameter als Hidden-Felder mitführen. Muster: `/inventory/inspections`.

### Formulare im Seitenkopf

Speichern/Abbrechen/Löschen stehen im Kopf, nicht unter dem Formular. Jedes Formular bekommt eine feste `id`; der Kopf-Button verweist per `form="<id>"` darauf (kein JS, Enter im Feld funktioniert weiter). Löschen = eigenes kleines `<form>` im Inhalt, Button im Kopf zeigt per `form=` darauf. Bei mehreren Formularen zeigt der Kopf nur auf das Hauptformular.

### Icon-only (Container-Queries)

Stufe 1 (Kopf < `@xl`): Labels der sekundären Aktionen entfallen; Stufe 2 (< `@md`): auch das Label der primären Aktion. Icon bleibt, `aria-label`/`title` tragen den Namen.

### Sticky

Gestapelt von oben nach unten, jede Ebene klebt direkt unter der vorigen:

| Ebene | Element | z-index | Sichtbar |
|---|---|---|---|
| 1 | Hauptnav | 40 | immer |
| 2 | `PageHeader` | 20 | immer |
| 3 | Such-/Filterleiste (`.filter-bar`) | 15 | ab `md` (darunter `static`, da mehrzeilig zu hoch) |

Der `Pager` klebt unten am Viewport (`z-10`, `z-30` solange die Seitenwahl offen ist) und ist immer sichtbar; Details siehe „Haupt-Listen-Tabellen“.

- Offsets laufen über CSS-Variablen in `app.css` (`--nav-h`, `--header-h`, `--filter-h`); nie feste Pixel/rem-Werte inline. Neue sticky Ebene = neue Variable + Eintrag in dieser Tabelle.
- Sticky-Elemente brauchen einen deckenden Hintergrund (`bg-base-100`/`bg-base-300`).
- Popover/Dropdowns (`MultiSelectFilter`, `TitleSwitch`, Pager-Seitenwahl) liegen über allen sticky Ebenen (`z-20` bis `z-50` bzw. Top Layer); neue sticky Ebenen bleiben unter 20.
- Kein Vorfahr darf `overflow` ≠ `visible` haben, sonst bricht Sticky. Deshalb stehen Pager und Leiste **außerhalb** von `overflow-x-auto`-Wrappern.
- Sticky gilt nur innerhalb des Eltern-Elements: Leiste und Liste/Tabelle müssen im selben Container liegen, ohne Zwischen-Wrapper mit kurzer Höhe. Fehlerbild: Leiste scrollt nach kurzer Strecke weg (so zuvor in `/anniversaries`).
- `display: contents` am Sticky-Element selbst ist wirkungslos; Klasse an das umgebende `<div>` setzen.
- `--header-h` ist geschätzt (4rem); `--filter-h` wird im Layout gemessen. Ändert sich die Höhe des `PageHeader`, muss der Wert mit.

## Ansichten-Umschalter

Wenn eine Seite zwei bis drei gleichwertige Ansichten derselben Daten hat (z. B. `/donations`: Zuwendungen | Spender), stehen sie als Umschalter im Seitentitel statt als eigene Menüeinträge: `TitleSwitch` (`src/components/title-switch.tsx`) als `title` des `PageHeader`.
- Ansicht in der URL (`?view=…`), Links behalten Suche, Zeitraum und `pageSize`; Seite und Sortierung beginnen neu. Standardansicht = kein Parameter. Der Browser-Titel nennt die Ansicht („Spender · Spenden").
- Ab `sm`: feste Reihenfolge, dünner Trenner (1 px, `bg-base-content/20`). Aktiv: `text-2xl` (Header-Standard), fett, Linie `border-b-2 border-gold/60`, `aria-current="page"`. Inaktiv: `text-xl`, `font-normal`, `text-base-content/50`; Hover voller Text plus 1-px-Unterstreichung.
- Unter `sm`: ein Button mit Rahmen (`btn btn-ghost border`) zeigt die aktive Ansicht plus Chevron; das Menü zeigt alle Ansichten, Haken am aktiven, Klick daneben schließt.
- Ein Eintrag kann einen Zähler (`count`, `badge badge-sm badge-warning`) tragen; er erscheint nur, solange die Ansicht **nicht** aktiv ist
- Nicht für Unterseiten mit eigenen Rechten/Zählern (dort Sidebar) und nicht für Filter (dort `filter`/`ToggleFilter`). Ansichtsspezifische Filter und Aktionen (z. B. Quittungsfilter, „Neuer Spender") erscheinen nur in ihrer Ansicht.

## Statistikkarten

Kennzahlen über der Liste (`/members`, `/donations`, `/inventory/lending`); als Überblick, nicht als Daten.

- Wrapper `hidden sm:block @container mb-6` (unter `sm` aus), darin `grid grid-cols-2 @4xl:grid-cols-<N> gap-2 @4xl:gap-4`; ab sechs Karten zusätzlich `@xl:grid-cols-3`.
- Karte: immer über `StatCard` (`src/components/stat-card.tsx`), nie lokal nachbauen: `stat bg-base-200 rounded-box px-3 py-2 @4xl:p-4` mit `stat-title text-xs`, `stat-value text-2xl @4xl:text-3xl`, optional `stat-desc text-sm`.
- Zahlenfarbe nur mit Bedeutung: `text-error` Überfälliges (nur bei > 0), `text-warning` Offenes, `text-info`/`text-success` Zustände; sonst neutral.
- Klickbare Karte (`href`): `hover:bg-base-300`, `focus-visible`-Rahmen und ein Icon oben rechts (`opacity-50`), das auch auf Touch sichtbar ist: `funnel` = filtert die Liste, `arrow-right` = wechselt die Ansicht. Die Karte bleibt auch bei Wert 0 klickbar. Nicht klickbare Karten haben kein Icon.
- Zustandszahlen (Anzahl je Status, z. B. Mitglieder, Verleih) zählen über den ganzen Bestand und ignorieren Suche und Filter der Liste. Summen und Durchschnitte über einen Zeitraum (z. B. Spenden) folgen dem Filter der Liste; der Zeitraum steht im Filter sichtbar daneben.
- Der Link einer Karte muss die Liste so öffnen, dass sie dieselbe Zahl zeigt: Zustandskarten heben einen Standardzeitraum der Liste auf (z. B. `start=&end=` im Verleih), Zeitraumkarten behalten die aktuellen Filter (z. B. Spenden „Offen“).
- Umschalter „Statistik“ (Icon `chart-bar`, `toggle`) im Seitenkopf, Zustand in `localStorage` unter `<seite>_statsVisible`. Nur in der Ansicht, die Karten hat.
- ⚠️ Abweichung im Code: Das Umschalt-Skript steht dreimal kopiert (members, donations, lending); Zusammenführen in einem eigenen Task.

## Tabs

Tabs (`role="tablist"`, daisyUI `tabs`) schalten Inhalte **innerhalb eines Formulars oder Panels** um. Seitenweite Ansichten sind Sache von `TitleSwitch`, Filter von `filter`/`ToggleFilter`.

- **Panel mit Inhalt** (z. B. Bearbeiten/Vorschau im Vorlagen-Editor): `tabs tabs-lift`, Inhalt in `tab-content bg-base-100 border-base-300 p-4`. Umschaltung per Radio-`input.tab` (kein JS), `aria-label` trägt den Namen.
- **Auswahlleiste ohne eigenes Panel** (z. B. Rollen-Typ-Auswahl): `tabs tabs-border`, `button.tab` mit `tab-active`.

## Buttons

Die Bedeutung hängt an der Farb-/Outline-Kombination:

| Klasse | Bedeutung |
|---|---|
| `btn btn-primary` (solid) | Primäre Aktion / Haupt-CTA (Speichern, Anlegen) |
| `btn btn-error` (solid) | Destruktive Aktion, die **direkt** ausführt (z. B. Löschen-Button im Bestätigungsdialog) |
| `btn btn-outline btn-error` | Destruktiver **Trigger**, der zuerst einen Bestätigungsdialog öffnet — solid nur für den ausführenden Button im Dialog |
| `btn btn-ghost` | Sekundäre/tertiäre Aktion, Navigation (Navbar-Links, Dropdown-Trigger) |
| `btn btn-outline btn-primary` (in `join-item`-Gruppe) | Aktiver Zustand in Filter-/Quick-Link-Pillen; inaktive Geschwister nutzen `btn-ghost` |
| `btn` (ohne Farb-Modifier, `join-item`) | Neutrale Pagination-Controls; Ausnahme: aktuelle Seite = `btn btn-primary` |

Größen: `btn` (ohne Modifier) für Aktionen innerhalb einer Seite (Header-Zeile), `btn-sm` für kompakte, `btn-xs` für sehr kompakte Kontexte (z. B. Tabellenzelle).

## Tabellen

Zwei Kategorien. Entscheidend ist nur, ob die Tabelle die **primäre Datenliste ihres Tabs/ihrer Seite** ist, nicht eine Breiten-Einschränkung (`max-w-*` ist ein zusätzlicher Modifier auf Wrapper/Tabelle). Neue Tabelle zuerst einer Kategorie zuordnen, dann deren Muster kopieren; innerhalb einer Kategorie sind Klassen und Empty-State-Padding identisch.

### Haupt-Listen-Tabellen
(members, donors, donations, applications, anniversaries, `admin.tsx`-Tabs)

- `class="table table-zebra w-full"`
- Sortierbare Spalten, wo fachlich sinnvoll (Klick auf Spaltenkopf, `SortIcon` als Indikator).
- Pagination bei potenziell langen Listen: `Pager` (`src/components/pager.tsx`, gekürztes Fenster: erste/letzte Seite, aktuelle ±1, „…“; ab 8 Seiten Sprechblase zur Seitenwahl) mit `sticky bottom-6 z-10 bg-base-100 border-t` (`bottom-6` = Höhe des fixen Versions-Footers). Der Pager steht **außerhalb** des `overflow-x-auto`-Wrappers (siehe Sticky-Regeln). Unter `md` bricht er nie um: Zähler, Seitengrößen-Select (nur `aria-label`) und aktuelle Seite; die Seitenwahl läuft immer über die Sprechblase, auch bei ≤ 7 Seiten.
- Empty State: Ist die Liste leer, entfällt die Tabelle samt Kopf. Stattdessen steht `<p class="text-center opacity-50 py-8">{leerer-Text}</p>`, der erklärt, warum nichts angezeigt wird (z. B. Filter, Zeitraum). Filterleiste und Pager bleiben sichtbar. ⚠️ Abweichung im Code: Die übrigen Haupt-Listen (members, donors, donations, applications, anniversaries, `admin.tsx`) zeigen noch eine Leerzeile `<tr><td colspan={N} class="text-center opacity-50 py-8">` in der Tabelle; Umstellung in einem eigenen Task.

### Kleine Inline-Sub-Tabellen
(alle Tabellen, die nicht die primäre Datenliste sind, z. B. Rollen-/Berechtigungs-Listen in `admin.tsx`, Zuweisungen in `members.tsx`, Teilnehmer-/Prüfungs-Tabellen in `events`, `training`, `inventory`, `import`)

- `class="table w-full"` (kein `table-zebra`); `w-full` ist der Standard, `table-sm` oder `max-w-*` nur, wenn der Platz es verlangt (z. B. `table-sm` in `mail-templates.tsx`, `max-w-2xl` in `donations.tsx`)
- Keine Sortierung, keine Pagination
- Empty State: `<tr><td colspan={N} class="text-center opacity-50 py-4">{leerer-Text}</td></tr>` (`py-4` statt `py-8`, kompakter)

### Zeilenaktionen

Jede Aktion in einer Tabellenzeile (Bearbeiten, Löschen inkl. Modal-Auslöser, Kopieren, Aktivieren, ↑/↓) ist eine `RowAction` (`src/components/row-action.tsx`): `btn btn-xs` mit Icon, das Label verschwindet unter `md` (`max-md:hidden`). `aria-label` ist immer das Label, `title` standardmäßig ebenfalls; bei deaktivierten Buttons trägt `title` die Begründung. Icons: Bearbeiten `pencil`, Löschen `trash`, Kopieren `document-duplicate`, Aktivieren `check`, Ablehnen `x-mark`, Deaktivieren `no-symbol`, ↑/↓ `arrow-up`/`arrow-down`. Nicht betroffen: Buttons außerhalb von Tabellenzeilen.

## Terminliste (Datumsblock-Liste)

Chronologische Einträge mit hervorgehobenem Datum (`/events`, `/events/public`, Komponente `EventCards`) sind **keine Tabelle und keine Card**: kein Zebra, kein Rahmen, kein Schatten, keine Kartenfläche (Rahmen/Schatten wirkten im Test unschön); Trennung allein durch Abstand.

- Monatsüberschrift `h2 text-xl font-bold` über dem ersten Eintrag des Monats (technisch im Wrapper dieses Eintrags).
- Eintrag: `flex gap-3 sm:gap-4`, Wrapper mit `mb-6`. Links Datumsblock `bg-primary text-primary-content rounded-box w-14 sm:w-16` (Tag fett groß, Monat in Versalien, Jahr abgeblasst), rechts Textspalte `min-w-0` (Titel `font-medium`, Zeitzeile/Beschreibung `text-sm opacity-70`, Tag-Badges zuletzt).
- Aktionen (Löschen) rechtsbündig in der Zeile als `RowAction`.

## Zeitleisten-Listen mit Zuständen (Verleih)

`/inventory/lending` zeigt Vorgänge und offene Anfragen in einer Monats-Zeitleiste (eine Tabelle, Monatszeilen als Zwischenüberschriften, ein `thead`). Der linke Zeilenrand (`border-l-4` an der ersten Zelle, sonst transparent) trägt die Dringlichkeit:

| Zeile | Rand | Badge |
|---|---|---|
| Überfällig | `border-l-error` (Zeitraum `text-error`) | `badge-error` |
| Offene Anfrage | `border-l-primary` | `badge-primary badge-outline` |
| Offene Anfrage mit Konflikt | `border-l-warning` + Dreieck `text-warning` vor dem Zeitraum | wie oben |
| Abgelehnte Anfrage | transparent, Zeile `opacity-60` (nur auf Auswahl im Filter) | `badge-ghost` |

Rot = eingetreten, Primär = wartet auf Entscheidung, Gelb = drohender Konflikt. Am selben Tag stehen Anfragen vor Vorgängen. Ist der Standard eines Mehrfach-Filters nicht „alles“, nennt der Button genau, was gilt („Alle außer Abgelehnt“).

## Badges

- Tag-Badges: `badge badge-sm`, neutral (`badge-ghost`) als Standard.
- Die mitgelieferten Vorlagennamen haben feste Stile (`TAG_STYLES` in `components/tag-badges.tsx`, Name ohne Groß-/Kleinschreibung): Fahrzeug `badge-primary`, Atemschutz `badge-info`, Gerät `badge-secondary`, PSA `badge-accent`, Sonstiges `badge-neutral`, Hydrant `badge-secondary badge-outline`. Bei mehreren Treffern erscheinen alle als Badge, das Icon trägt der erste.
- Ergebnis-Anzeige (z. B. Prüfergebnis): daisyUI-`status`-Punkt (`status status-success` / `status-error` / `status-neutral`) mit Klartext daneben, kein Badge.
- `badge-success`, `badge-warning` und `badge-error` sind dem Status vorbehalten (Prüffrist, Verleih), nie für Tags.

## Auswahl-Cards

Muster für „eine von wenigen Optionen wählen" (z. B. Vorlagenauswahl in `GET /inventory/new`); nicht für Listen oder Daten.

- Raster: 1 Spalte, ab `sm` 2, ab `lg` 3, ab `2xl` auf `max-w-6xl` begrenzt; alle Cards gleich hoch (`h-full`), ab `sm` mindestens `min-h-28`.
- Größe wächst mit dem Viewport: bis `sm` `p-4`, Avatar `size-10`; ab `sm` `p-5`, `size-12`, `gap-4`; ab `lg` `p-6`, `size-14`, Titel `text-lg`, Beschreibung `line-clamp-3`. Inhalt oben ausgerichtet.
- Die ganze Card ist ein Link (`card card-border bg-base-100 border-base-300`), Hover `border-primary`, Tastaturfokus `focus-visible`-Rahmen.
- Inhalt: `TagAvatar` (Icon + Farbe aus `TAG_STYLES`, ohne Eintrag dezent neutral) links, rechts Textblock mit `space-y-1` (ab `lg` `space-y-1.5`): Titel (`font-medium`), Beschreibung (`text-sm opacity-70 line-clamp-2`), Zählzeile (`text-sm opacity-60`, Nullteile entfallen).
- Die Option „leer/ohne" steht zuerst und ist gestrichelt (`border-dashed`).

## Detail-Seiten (Read-only/Edit)

Jede Detailseite im Umfang (members, inventory, events, roles, role-types, donors, donations, admin/users, admin/permissions) öffnet zuerst read-only:

- `GET /:id` = Read-only-Ansicht (`ViewGrid` + `ViewField` aus `src/components/field.tsx`, nie lokal neu definieren), `GET /:id/edit` = Formular. Ohne Schreibrecht leitet `/:id/edit` auf `/:id` um (entfällt bei `/inventory/fields`, `/inventory/inspection-templates`, `/inventory/templates`: ein einziges Recht `inventory:configure`, kein Leserecht). „Neu“-Formulare öffnen direkt im Bearbeiten-Modus.
- Listen-Zeilenklick (auch bei Einträgen der Terminliste) führt auf `/:id`. Nach Speichern: Redirect auf `/:id` + Toast; bei Validierungsfehler im Formular bleiben.
- Read-only-Header: `DetailActions` (`src/components/page-header.tsx`) – „Löschen“ (`btn-outline btn-error`, nur mit Löschrecht), optional „Kopieren“ (`copyHref`, `btn-outline btn-primary`), rechts davon „Bearbeiten“ (`btn-primary`, `pencil`, nur mit Schreibrecht).
- Formular-Header: `FormActions` mit `cancelHref` (Abbrechen → `/:id`, Rückfrage bei Änderungen), Verwerfen, Speichern. Kein Löschen im Formular.
- Ausgenommen: anniversary-years, applications, Einstellungsseiten ohne Datensatz (`/admin/config`, `/organisation`, `/account`).

## Responsive Schwellen

- **Mobil = `md` (768 px / `48rem`).** Darunter: Burger-Menü, kompakter Pager, icon-only Zeilenaktionen, statische Filterleiste. Neue Mobil-Umschaltungen nutzen `md`, nicht `sm`.
- **Ausnahmen:** `sm:` für Formular-Grids (`sm:grid-cols-`, `sm:col-span-`) und das Label des `ApplyButton`; Spalten-Ausblendung (`md:`/`lg:`/`xl:table-cell`); Container-Queries im Seitenkopf (`HeaderAction`) und in der Kategorie-Auswahl des Inventar-Formulars (`@container`: `<select>` unter `@sm`, nur Icons bis `@xl`, darüber Icon + Text; Radios bleiben die einzige submittete Quelle, das `<select>` hat keinen `name`); PageHeader und Monatszeilen der Jubiläumsliste bleiben auch unter `md` sticky.

## Touch-Ziele

Bei `pointer: coarse` (Handy, Tablet) sind interaktive Elemente mindestens 44×44 px. Das regelt zentral `src/styles/app.css` (`min-height: 2.75rem` für `.btn`, `.join-item`, Menü-Einträge; `min-width` nur für icon-only Buttons). Checkboxen bleiben klein (daisyUI-Größe); die Trefferfläche entsteht über das umgebende `<label>` mit `pointer-coarse:min-h-11`. Einzelne Buttons bekommen dafür keine eigenen Klassen.
