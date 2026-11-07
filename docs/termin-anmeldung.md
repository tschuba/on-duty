# Anmeldung zu Terminen

Umsetzung: `src/lib/events.ts` (`setRsvp`, `rsvpLock`, `invitedMembers`), `src/routes/events.tsx` (Abschnitt „Anmeldung“ auf `GET /events/:id`), Schema `src/db/schema/events.ts`.

## Einschalten

Im Termin-Formular „Anmeldung aktivieren“ (Standard: aus). Optional:

| Feld | Bedeutung |
|---|---|
| Maximale Teilnehmer | Zahl ≥ 1, leer = unbegrenzt. Gezählt werden nur Zusagen aktiver Mitglieder. |
| Anmeldeschluss | Leer = Beginn des Termins. Darf nicht nach dem Beginn liegen. |

Schaltet man die Anmeldung wieder aus, bleiben die Antworten erhalten.

## Wer darf was

| | Mitglied | `events:manage` |
|---|---|---|
| Selbst zu-/absagen | ja, wenn eingeladen, aktiv und mit Login verknüpft; Wechsel Zusage ↔ Absage möglich | nur als eingeladenes Mitglied |
| Auf „offen“ zurücksetzen | nein | ja |
| Für andere eintragen | nein | ja, für jedes aktive Mitglied (auch ohne Login, auch nicht eingeladen) |
| Nach Anmeldeschluss ändern | nein | ja |
| Limit überschreiten | nein | ja (Anzeige dann z. B. „22/20“) |
| Namen und Antworten sehen | nein, nur Zahlen und der eigene Status | ja, inkl. Gruppe „offen“ |

Eingeladen sind alle aktiven Mitglieder, bei Sichtbarkeit „Nur ausgewählte Mitglieder“ nur die Einladungsliste. Ausgetretene und Verstorbene zählen nie. Auf `/events/public` gibt es keine Anmeldung.

## Sperren

- **Limit erreicht:** Zusagen von Mitgliedern werden abgelehnt (Prüfung in einer Transaktion, Termin-Zeile mit `FOR UPDATE` gesperrt). Absagen und der Wechsel auf Absage bleiben möglich. Wer beim letzten Platz verliert, bekommt den Abschnitt mit Status 422 und Hinweis. Wird das Limit unter die Zahl der Zusagen gesenkt, wird nichts gelöscht.
- **Anmeldeschluss verstrichen:** Mitglieder können nichts mehr ändern.
- **Termin abgesagt:** Niemand kann etwas ändern, auch die Führung nicht. Die Antworten bleiben, niemand wird benachrichtigt.

## Absagen und Löschen

„Termin absagen“ / „Absage zurücknehmen“ stehen im Kopf der Detailseite. Der Termin bleibt mit Badge „Abgesagt“ sichtbar, auch öffentlich. Löschen ist nur für abgesagte oder vergangene Termine möglich (serverseitig 422). Der Dialog nennt die Zahl der Antworten, die dabei verloren gehen.

## Verwaltung (Führung)

Tabelle aller Eingeladenen und Antwortenden, sortierbar nach Name oder Antwort, mit Suchfeld. Pro Zeile Zusage/Absage (Klick auf die aktive Antwort setzt zurück). „Weiteres Mitglied eintragen“ sucht alle aktiven Mitglieder ohne Antwort.

## Datenschutz

Antworten hängen an `members.id` und werden beim Löschen des Mitglieds oder Termins mitgelöscht (Cascade). Es gibt keine Notiz und keine Mails.

## Nicht enthalten

Anwesenheit, Ausbildungseintrag aus Terminen, Erinnerungs-Mails, Warteliste.
