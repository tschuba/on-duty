# Jubiläumsberechnung

Umsetzung: `generateEvents` und `getCeremonyYear` in `src/lib/anniversaries.ts`.

## Begriffe

| Begriff | Bedeutung |
| --- | --- |
| Bezugsdatum | Dienstjubiläum: `firstEntryDate`, sonst `entryDate`. Mitgliedsjubiläum: `entryDate`. |
| Jubiläumsjahre | Konfigurierte Jahreszahlen (Admin → Jubiläumsjahre), z. B. 25, 40, 50. |
| Ehrungstermin | `ANNIVERSARY_CUTOFF` (`MM-DD`, Standard `01-06`), der feste Tag im Jahr, an dem geehrt wird. |

Dienstjubiläen gibt es nur für aktive Mitglieder, Mitgliedsjubiläen für alle, die nicht ausgetreten oder verstorben sind. Fallen beide auf denselben Ehrungstermin und dieselbe Jahreszahl, erscheint eine zusammengeführte Zeile.

## Regel

1. Das Jubiläum fällt auf Eintrittsjahr + n.
2. Geehrt wird am **nächsten Ehrungstermin danach**. Liegt der Eintritt (Tag/Monat) **nach** dem Ehrungstermin, wird das Ehrungsjahr um 1 erhöht, bei Eintritt am Ehrungstermin oder davor nicht:

   `Ehrungsjahr = Eintrittsjahr + n + (Tag/Monat des Eintritts > Ehrungstermin ? 1 : 0)`

3. Das **Datum des Events** ist der Jubiläumstag (`Eintrittsjahr + n`, Tag/Monat des Eintritts; 29.02. → 01.03. in Nicht-Schaltjahren, auch bei Geburtstagen). Danach laufen Filterung, Sortierung und Gruppierung. Der Ehrungstermin (`Ehrungsjahr-ANNIVERSARY_CUTOFF`) ist Zusatzinfo (`ceremonyDate`).

Das Schaltjahr-Problem (29.02.) entfällt, weil das Datum nie aus dem Eintrittstag berechnet wird.

## Beispiele (`ANNIVERSARY_CUTOFF=01-06`)

| Jubiläum | Eintritt | Jubiläumstag | Ehrungsjahr | Ehrungstermin |
| --- | --- | --- | --- | --- |
| 25 Jahre | 01.07.2000 | 01.07.2025 | 2000 + 25 + 1 = 2026 | **06.01.2026** |
| 50 Jahre | 01.01.1977 | 01.01.2027 | 1977 + 50 + 0 = 2027 | **06.01.2027** |
| 25 Jahre | 06.01.2000 | 06.01.2025 | 2000 + 25 + 0 = 2025 | **06.01.2025** (Eintritt am Ehrungstermin zählt noch dazu) |
| 25 Jahre | 07.01.2000 | 07.01.2025 | 2000 + 25 + 1 = 2026 | **06.01.2026** |

Dienst und Mitgliedschaft: Mitglied seit 15.06.1990 in der Feuerwehr, bei uns seit 15.06.2000, jeweils 25 Jahre: Dienstjubiläum am 06.01.2016, Mitgliedsjubiläum am 06.01.2026. Zwei getrennte Zeilen, da die Jahre verschieden sind. Bei gleichem Bezugsdatum gäbe es eine Zeile „Dienst- und Mitgliedsjubiläum“.

## Anzeige

- **Liste, Export, Druckansicht** filtern und sortieren nach dem Ehrungstermin. Mehrere Mitglieder mit demselben Termin werden nach Nachname sortiert.
- **Erste Spalte der Liste** zeigt den Jubiläumstag, darunter in grau den Ehrungstermin. Dienst- und Mitgliedsjubiläum derselben Person (gleicher Ehrungstermin und gleiche Jahre) werden zu einer Zeile mit zwei Tagen verschmolzen, wenn sie in der gefilterten Liste direkt aufeinander folgen. Ausgegraut wird nach Ehrungstermin. Der Export hat eine Zeile je Ereignis mit Spalte „Ehrungstermin“.
