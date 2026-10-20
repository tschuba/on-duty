# E2E-Checkliste vor Release

Vor jedem Produktions-Deploy manuell durchlaufen.

## Auth

- [ ] OIDC-Login: bekannter User → Weiterleitung zur App
- [ ] OIDC-Login: unbekannter User → Fehlermeldung
- [ ] Admin-Login (`/admin/login`) mit korrektem Passwort
- [ ] Admin-Login: 5 Fehlversuche → Rate-Limit-Meldung
- [ ] Session-Ablauf → OIDC-Redirect mit Rückführung zur ursprünglichen URL
- [ ] Logout invalidiert Session

## Mitglieder

- [ ] Mitglied anlegen (alle Pflichtfelder + mindestens eine Funktion)
- [ ] Inline-Validierung: Speichern ohne Pflichtfeld → Fehlermeldung
- [ ] Statusableitung: aktive Rolle → `aktiv`; kein Eintragsalter unter Jugendgrenze → `jugend`
- [ ] Mitglied bearbeiten (Stammdaten + Zuweisung hinzufügen/entfernen)
- [ ] Archivieren: Austrittsdatum setzen → offene Zuweisungen werden geschlossen
- [ ] Reaktivierung: Reaktivierungs-Dialog erscheint bei `auto_closed`-Zuweisungen
- [ ] Filter (`aktiv / passiv / jugend / kinder / archiviert`) kombinierbar mit Suche
- [ ] Paginierung + Seitengröße-Wechsel bleibt bei aktiven Filtern korrekt
- [ ] Statistik-Karten zeigen korrekte Zahlen

## Jubiläen & Geburtstage

- [ ] Quick-Buttons (3 / 6 / 12 Monate) setzen Datumsbereich korrekt
- [ ] Manuelle Datumseingabe wird respektiert
- [ ] Filter `Alle / Nur Jubiläen / Nur Geburtstage` funktioniert
- [ ] Vergangene Ereignisse erscheinen gedimmt
- [ ] Jubiläumsberechnung: Eintritt vor/auf/nach Stichtag korrekt (siehe docs/jubilaeen.md)

## Export

- [ ] Mitglieder-Export: `.xlsx` mit zwei Blättern (Mitglieder + Funktionszuweisungen)
- [ ] Jubiläen-Export: Modal mit Kontakt-/Adress-Checkboxen; Datei enthält nur angezeigte Zeilen

## Backup

- [ ] Backup manuell auslösen (Cron-Ausdruck auf kurzen Intervall setzen, neu starten)
- [ ] Backup-History in `/admin/backup` sichtbar
- [ ] Fehlendes Backup → Warn-Banner in Admin-Bereich sichtbar

## Pager (Mitglieder, Spender)

- [ ] Pager bleibt beim Scrollen sticky am unteren Viewport-Rand (deckender Hintergrund)
- [ ] Seitengröße ändern (nur Mitglieder) → Liste springt auf Seite 1, Wert bleibt erhalten
- [ ] Seitenwechsel über Zahlen und «/» funktioniert

## Admin

- [ ] Benutzer anlegen / bearbeiten / deaktivieren (inkl. sofortige Session-Invalidierung)
- [ ] Funktion anlegen; Anzeigename nach erster Zuweisung read-only
- [ ] Geschützte Funktionen nicht löschbar
- [ ] Jubiläumsjahr anlegen / löschen

## Release / Deploy

- [ ] Git-Tag pushen: `git tag v1.2.3 && git push --tags`
- [ ] CI-Workflow abwarten (~5 min, Multi-Arch Build auf ghcr.io)
- [ ] In Coolify: `APP_VERSION=1.2.3` setzen → **Redeploy**
