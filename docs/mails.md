# Ausgehende E-Mails

Übersicht aller Mails, die on-duty und Zitadel versenden — Grundlage für Weiterleitungen und Filterregeln im Postfach.

## Schema

**Betreff:** `[<Org-Name>|<Typ>] <Betreff>`

`<Org-Name>` ist `ORG_NAME` aus der Umgebung; `|`, `[`, `]` und Zeilenumbrüche werden durch Leerzeichen ersetzt, ohne Wert gilt `on-duty`. **Wer den Namen ändert, muss seine Filter anpassen.** Die Beispiele unten zeigen `on-duty` als Platzhalter.

Enthält `ORG_NAME` eines dieser Zeichen, meldet der App-Start das: eine Warnung ohne SMTP-Konfiguration, ein Startabbruch (`logger.fatal` + Exit) sobald `SMTP_HOST` und `SMTP_FROM` gesetzt sind — ein kaputtes Präfix soll dann nicht unbemerkt verschickt werden (`src/env.ts`).

| Typ (fest, lokalisiert) | `X-On-Duty-Category` | Inhalt |
|---|---|---|
| `Mitgliedsantrag` | `membership` | Eingang, Zusage, Absage von Mitgliedsanträgen |
| `Verleih` | `lend` | Verleih-Anfragen |
| `Registrierung` | `registration` | Freigabe neuer Benutzer |
| `Termin` | `event` | Termin-Mails (neu, geändert, abgesagt, findet statt) |
| `Mitteilung` | `custom` | Freie Vorlagen (vorbereitet, noch ohne Versand) |
| `Benutzerkonto` | – (nur Zitadel) | E-Mail-Bestätigung, Passwort-Reset, Einladung |

Bei on-duty-Mails mit Vorlage (Termin-Mails) lassen sich Betreff und Text im Editor ändern; das Präfix nur bei freien Vorlagen. Betreff-Filter sind daher nur eingeschränkt stabil, verlässlich sind nur die Header `X-On-Duty-*`. Für Zitadel-Mails („Benutzerkonto“, keine eigenen Header möglich) bleibt das Label fest und ist der einzige Filteranker. Variablen der Vorlagen: [mail-variables.md](mail-variables.md).

**Header** (nur on-duty-Mails; Zitadel kann keine eigenen Header setzen):

- `X-On-Duty-Category`: `membership` | `lend` | `registration` | `event` | `custom`
- `X-On-Duty-Event`: siehe Tabelle unten (stabil, nicht lokalisiert)
- `X-On-Duty-Audience`: `staff` (Verwaltung) | `applicant` (Antragsteller/Betroffene) | `member` (Mitglieder)

**Sonstiges:** `From` ist überall `SMTP_FROM` (auch bei Zitadel). Reiner Text, keine Anhänge, kein `Reply-To`. Versand über nodemailer (`src/lib/mail.ts`, Port `SMTP_PORT`, Standard 587/STARTTLS). Ohne `SMTP_HOST`/`SMTP_FROM` wird nichts gesendet. Adressen auf `.invalid` werden bei Admin-Benachrichtigungen übersprungen.

## Mails von on-duty

| Auslöser | Empfänger | Betreff | Event | Audience |
|---|---|---|---|---|
| Mitgliedsantrag eingegangen | Benachrichtigungsadresse¹ | `[on-duty\|Mitgliedsantrag] Neuer Antrag eingegangen: <Name>` | `application-submitted` | `staff` |
| Mitgliedsantrag angenommen | Antragsteller | `[on-duty\|Mitgliedsantrag] Ihr Antrag wurde angenommen` | `application-approved` | `applicant` |
| Mitgliedsantrag abgelehnt | Antragsteller | `[on-duty\|Mitgliedsantrag] Ihr Antrag wurde abgelehnt` | `application-rejected` | `applicant` |
| Verleih-Anfrage eingegangen | Benachrichtigungsadresse¹ | `[on-duty\|Verleih] Neue Verleih-Anfrage: <Gegenstand>` | `lend-notify` | `staff` |
| Verleih-Anfrage: Eingangsbestätigung | Antragsteller (falls E-Mail) | `[on-duty\|Verleih] Deine Verleih-Anfrage ist eingegangen` | `lend-submitted` | `applicant` |
| Verleih-Anfrage genehmigt | Antragsteller | `[on-duty\|Verleih] Deine Verleih-Anfrage wurde genehmigt` | `lend-approved` | `applicant` |
| Verleih-Anfrage abgelehnt | Antragsteller | `[on-duty\|Verleih] Deine Verleih-Anfrage wurde abgelehnt` | `lend-rejected` | `applicant` |
| Neue Registrierung wartet auf Freigabe | alle Admins (Rollen mit Rechten) | `[on-duty\|Registrierung] Neue Registrierung wartet auf Freigabe` | `registration-pending` | `staff` |

¹ Org-Einstellung `notificationEmail`, sonst `orgContactEmail`; beides leer → keine Mail.

Termin-Mails (Vorlagen in der DB, Standardtexte „du“):

| Auslöser | Betreff (Standard) | Event | Audience |
|---|---|---|---|
| Neuer Termin | `[on-duty\|Termin] Neuer Termin: <Titel>, <Datum>` | `event-created` | `member` |
| Termin geändert | `[on-duty\|Termin] Termin geändert: …` | `event-updated` | `member` |
| Termin abgesagt | `[on-duty\|Termin] Termin abgesagt: …` | `event-cancelled` | `member` |
| Absage zurückgenommen | `[on-duty\|Termin] Termin findet statt: …` | `event-uncancelled` | `member` |

Versand: nach „Mail senden“ im Modal auf der Termin-Detailseite, eine Mail je Adresse (gemeinsame Adressen mit einem Block je Mitglied). Jede Mail enthält Opt-Out-Links (`/link/<Token>`, signiert, ohne Login); bei genau einem Mitglied zusätzlich `List-Unsubscribe` und `List-Unsubscribe-Post`. Abbestellungen stehen in `mail_preferences`, das Versandprotokoll in `mail_log`.

Rezepte mit konkretem Betreff gelten nur für das feste Präfix, nicht für den änderbaren Betreff.

## Mails von Zitadel

Betreff `[<Org-Name>|Benutzerkonto] <Zitadel-Standardbetreff>`. `zitadel-init` setzt das Präfix bei jedem Deploy für die deutschen Nachrichtentexte (init, passwordreset, verifyemail, verifyphone, domainclaim, passwordchange, inviteuser); der restliche Text bleibt unverändert. Der Rest des Betreffs ist Zitadel-Vorgabe (Version/Sprache) und im Repo nicht definiert. Keine `X-On-Duty-*`-Header.

## Bugsink

Außerhalb des Schemas: Bugsink (nur Standalone-Stack) versendet bei gesetztem `SMTP_HOST` Passwort-Resets und Benachrichtigungen mit eigenen Betreffs und demselben `From`.

## Filter-Rezepte

- Alles von on-duty und Zitadel: Betreff beginnt mit `[<Org-Name>|`
- Eine Kategorie: Betreff beginnt mit `[on-duty|Verleih]` (bzw. `Mitgliedsantrag`, `Registrierung`, `Benutzerkonto`)
- Verwaltung (eine Weiterleitungsregel): Header `X-On-Duty-Audience: staff`
- Genau ein Ereignis: Header `X-On-Duty-Event: lend-notify`
- Zitadel-Mails (nur per Betreff möglich): `[on-duty|Benutzerkonto]`
