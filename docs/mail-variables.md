<!-- Generiert mit `pnpm mail:docs` aus src/lib/mail-templates.ts – nicht von Hand ändern. -->

# Mail-Variablen

## `event-created`

Kategorie `event`, Audience `member`. Pflichtplatzhalter: `optOutUrl` in `recipients`.

| Variable | Typ | Quelle | Beschreibung | Beispiel |
|---|---|---|---|---|
| `org.name` | text | data | Name der Organisation | Feuerwehr Musterstadt |
| `org.url` | text | data | Basis-URL des Portals | https://portal.example.org |
| `org.contactEmail` | text, optional | data | Kontaktadresse der Organisation | info@example.org |
| `type` | text | data | Typ-Label der Mail | Termin |
| `recipient.name` | text | person | Voller Name des Empfängers | Anna Beispiel |
| `recipient.firstName` | text | person | Vorname des Empfängers | Anna |
| `recipient.lastName` | text | person | Nachname des Empfängers | Beispiel |
| `recipient.email` | text | person | Adresse des Empfängers | anna@example.org |
| `addressee` | text | person | Anrede-Namen, kommagetrennt | Anna, Ben |
| `multiple` | boolean | data | Mehr als ein Mitglied an der Adresse | ja |
| `you` | text | data | „dich“ / „euch“ | dich |
| `event.title` | text | data | Titel des Termins | Übung Atemschutz |
| `event.date` | text | data | Kurzes Datum, für den Betreff | Sa., 12.04.2026 |
| `event.when` | text | data | Zeitangabe (ganztägig/mehrtägig berücksichtigt) | Sa., 12.04.2026, 18:00 bis 20:00 Uhr |
| `event.location` | text, optional | data | Ort; leer: Sektion entfällt | Gerätehaus |
| `event.rsvpEnabled` | boolean | data | Anmeldung aktiv und Termin nicht abgesagt | ja |
| `event.rsvpDeadline` | text, optional | data | Anmeldeschluss | 10.04.2026, 18:00 |
| `event.maxParticipants` | text, optional | data | Maximale Teilnehmerzahl | 20 |
| `event.changes` | text, optional | data | Änderungen, alt → neu (nur event-updated) | Ort: Halle → Gerätehaus |
| `event.url` | text | link | Detailseite im Portal | https://portal.example.org/events/1 |
| `recipients` | list | data | Ein Eintrag je Mitglied der Adresse |  |
| `recipients[].name` | text | person | Name des Mitglieds | Anna Beispiel |
| `recipients[].rsvpYesUrl` | text, optional | link | Zusage-Link (nur bei Anmeldung) | https://portal.example.org/r/yes |
| `recipients[].rsvpNoUrl` | text, optional | link | Absage-Link (nur bei Anmeldung) | https://portal.example.org/r/no |
| `recipients[].optOutUrl` | text | link | Abmelde-Link für Termin-Mails (Pflicht) | https://portal.example.org/o/1 |
| `optOutAllUrl` | text, optional | link | Abmelde-Link für alle Mitglieder der Adresse (nur bei mehreren) | https://portal.example.org/o/all |

## `event-updated`

Kategorie `event`, Audience `member`. Pflichtplatzhalter: `optOutUrl` in `recipients`.

| Variable | Typ | Quelle | Beschreibung | Beispiel |
|---|---|---|---|---|
| `org.name` | text | data | Name der Organisation | Feuerwehr Musterstadt |
| `org.url` | text | data | Basis-URL des Portals | https://portal.example.org |
| `org.contactEmail` | text, optional | data | Kontaktadresse der Organisation | info@example.org |
| `type` | text | data | Typ-Label der Mail | Termin |
| `recipient.name` | text | person | Voller Name des Empfängers | Anna Beispiel |
| `recipient.firstName` | text | person | Vorname des Empfängers | Anna |
| `recipient.lastName` | text | person | Nachname des Empfängers | Beispiel |
| `recipient.email` | text | person | Adresse des Empfängers | anna@example.org |
| `addressee` | text | person | Anrede-Namen, kommagetrennt | Anna, Ben |
| `multiple` | boolean | data | Mehr als ein Mitglied an der Adresse | ja |
| `you` | text | data | „dich“ / „euch“ | dich |
| `event.title` | text | data | Titel des Termins | Übung Atemschutz |
| `event.date` | text | data | Kurzes Datum, für den Betreff | Sa., 12.04.2026 |
| `event.when` | text | data | Zeitangabe (ganztägig/mehrtägig berücksichtigt) | Sa., 12.04.2026, 18:00 bis 20:00 Uhr |
| `event.location` | text, optional | data | Ort; leer: Sektion entfällt | Gerätehaus |
| `event.rsvpEnabled` | boolean | data | Anmeldung aktiv und Termin nicht abgesagt | ja |
| `event.rsvpDeadline` | text, optional | data | Anmeldeschluss | 10.04.2026, 18:00 |
| `event.maxParticipants` | text, optional | data | Maximale Teilnehmerzahl | 20 |
| `event.changes` | text, optional | data | Änderungen, alt → neu (nur event-updated) | Ort: Halle → Gerätehaus |
| `event.url` | text | link | Detailseite im Portal | https://portal.example.org/events/1 |
| `recipients` | list | data | Ein Eintrag je Mitglied der Adresse |  |
| `recipients[].name` | text | person | Name des Mitglieds | Anna Beispiel |
| `recipients[].rsvpYesUrl` | text, optional | link | Zusage-Link (nur bei Anmeldung) | https://portal.example.org/r/yes |
| `recipients[].rsvpNoUrl` | text, optional | link | Absage-Link (nur bei Anmeldung) | https://portal.example.org/r/no |
| `recipients[].optOutUrl` | text | link | Abmelde-Link für Termin-Mails (Pflicht) | https://portal.example.org/o/1 |
| `optOutAllUrl` | text, optional | link | Abmelde-Link für alle Mitglieder der Adresse (nur bei mehreren) | https://portal.example.org/o/all |

## `event-cancelled`

Kategorie `event`, Audience `member`. Pflichtplatzhalter: `optOutUrl` in `recipients`.

| Variable | Typ | Quelle | Beschreibung | Beispiel |
|---|---|---|---|---|
| `org.name` | text | data | Name der Organisation | Feuerwehr Musterstadt |
| `org.url` | text | data | Basis-URL des Portals | https://portal.example.org |
| `org.contactEmail` | text, optional | data | Kontaktadresse der Organisation | info@example.org |
| `type` | text | data | Typ-Label der Mail | Termin |
| `recipient.name` | text | person | Voller Name des Empfängers | Anna Beispiel |
| `recipient.firstName` | text | person | Vorname des Empfängers | Anna |
| `recipient.lastName` | text | person | Nachname des Empfängers | Beispiel |
| `recipient.email` | text | person | Adresse des Empfängers | anna@example.org |
| `addressee` | text | person | Anrede-Namen, kommagetrennt | Anna, Ben |
| `multiple` | boolean | data | Mehr als ein Mitglied an der Adresse | ja |
| `you` | text | data | „dich“ / „euch“ | dich |
| `event.title` | text | data | Titel des Termins | Übung Atemschutz |
| `event.date` | text | data | Kurzes Datum, für den Betreff | Sa., 12.04.2026 |
| `event.when` | text | data | Zeitangabe (ganztägig/mehrtägig berücksichtigt) | Sa., 12.04.2026, 18:00 bis 20:00 Uhr |
| `event.location` | text, optional | data | Ort; leer: Sektion entfällt | Gerätehaus |
| `event.rsvpEnabled` | boolean | data | Anmeldung aktiv und Termin nicht abgesagt | ja |
| `event.rsvpDeadline` | text, optional | data | Anmeldeschluss | 10.04.2026, 18:00 |
| `event.maxParticipants` | text, optional | data | Maximale Teilnehmerzahl | 20 |
| `event.changes` | text, optional | data | Änderungen, alt → neu (nur event-updated) | Ort: Halle → Gerätehaus |
| `event.url` | text | link | Detailseite im Portal | https://portal.example.org/events/1 |
| `recipients` | list | data | Ein Eintrag je Mitglied der Adresse |  |
| `recipients[].name` | text | person | Name des Mitglieds | Anna Beispiel |
| `recipients[].rsvpYesUrl` | text, optional | link | Zusage-Link (nur bei Anmeldung) | https://portal.example.org/r/yes |
| `recipients[].rsvpNoUrl` | text, optional | link | Absage-Link (nur bei Anmeldung) | https://portal.example.org/r/no |
| `recipients[].optOutUrl` | text | link | Abmelde-Link für Termin-Mails (Pflicht) | https://portal.example.org/o/1 |
| `optOutAllUrl` | text, optional | link | Abmelde-Link für alle Mitglieder der Adresse (nur bei mehreren) | https://portal.example.org/o/all |

## `event-uncancelled`

Kategorie `event`, Audience `member`. Pflichtplatzhalter: `optOutUrl` in `recipients`.

| Variable | Typ | Quelle | Beschreibung | Beispiel |
|---|---|---|---|---|
| `org.name` | text | data | Name der Organisation | Feuerwehr Musterstadt |
| `org.url` | text | data | Basis-URL des Portals | https://portal.example.org |
| `org.contactEmail` | text, optional | data | Kontaktadresse der Organisation | info@example.org |
| `type` | text | data | Typ-Label der Mail | Termin |
| `recipient.name` | text | person | Voller Name des Empfängers | Anna Beispiel |
| `recipient.firstName` | text | person | Vorname des Empfängers | Anna |
| `recipient.lastName` | text | person | Nachname des Empfängers | Beispiel |
| `recipient.email` | text | person | Adresse des Empfängers | anna@example.org |
| `addressee` | text | person | Anrede-Namen, kommagetrennt | Anna, Ben |
| `multiple` | boolean | data | Mehr als ein Mitglied an der Adresse | ja |
| `you` | text | data | „dich“ / „euch“ | dich |
| `event.title` | text | data | Titel des Termins | Übung Atemschutz |
| `event.date` | text | data | Kurzes Datum, für den Betreff | Sa., 12.04.2026 |
| `event.when` | text | data | Zeitangabe (ganztägig/mehrtägig berücksichtigt) | Sa., 12.04.2026, 18:00 bis 20:00 Uhr |
| `event.location` | text, optional | data | Ort; leer: Sektion entfällt | Gerätehaus |
| `event.rsvpEnabled` | boolean | data | Anmeldung aktiv und Termin nicht abgesagt | ja |
| `event.rsvpDeadline` | text, optional | data | Anmeldeschluss | 10.04.2026, 18:00 |
| `event.maxParticipants` | text, optional | data | Maximale Teilnehmerzahl | 20 |
| `event.changes` | text, optional | data | Änderungen, alt → neu (nur event-updated) | Ort: Halle → Gerätehaus |
| `event.url` | text | link | Detailseite im Portal | https://portal.example.org/events/1 |
| `recipients` | list | data | Ein Eintrag je Mitglied der Adresse |  |
| `recipients[].name` | text | person | Name des Mitglieds | Anna Beispiel |
| `recipients[].rsvpYesUrl` | text, optional | link | Zusage-Link (nur bei Anmeldung) | https://portal.example.org/r/yes |
| `recipients[].rsvpNoUrl` | text, optional | link | Absage-Link (nur bei Anmeldung) | https://portal.example.org/r/no |
| `recipients[].optOutUrl` | text | link | Abmelde-Link für Termin-Mails (Pflicht) | https://portal.example.org/o/1 |
| `optOutAllUrl` | text, optional | link | Abmelde-Link für alle Mitglieder der Adresse (nur bei mehreren) | https://portal.example.org/o/all |

## `event-mail-info`

Kategorie `event`, Audience `member`. Pflichtplatzhalter: `optOutUrl` in `recipients`.

| Variable | Typ | Quelle | Beschreibung | Beispiel |
|---|---|---|---|---|
| `org.name` | text | data | Name der Organisation | Feuerwehr Musterstadt |
| `org.url` | text | data | Basis-URL des Portals | https://portal.example.org |
| `org.contactEmail` | text, optional | data | Kontaktadresse der Organisation | info@example.org |
| `type` | text | data | Typ-Label der Mail | Termin |
| `recipient.name` | text | person | Voller Name des Empfängers | Anna Beispiel |
| `recipient.firstName` | text | person | Vorname des Empfängers | Anna |
| `recipient.lastName` | text | person | Nachname des Empfängers | Beispiel |
| `recipient.email` | text | person | Adresse des Empfängers | anna@example.org |
| `addressee` | text | person | Anrede-Namen, kommagetrennt | Anna, Ben |
| `multiple` | boolean | data | Mehr als ein Mitglied an der Adresse | ja |
| `recipients` | list | data | Ein Eintrag je Mitglied der Adresse |  |
| `recipients[].name` | text | person | Name des Mitglieds | Anna Beispiel |
| `recipients[].optOutUrl` | text | link | Abmelde-Link für Termin-Mails (Pflicht) | https://portal.example.org/o/1 |
| `optOutAllUrl` | text, optional | link | Abmelde-Link für alle Mitglieder der Adresse (nur bei mehreren) | https://portal.example.org/o/all |

## `member-settings-link`

Kategorie `member`, Audience `member`. Pflichtplatzhalter: `settingsUrl`.

| Variable | Typ | Quelle | Beschreibung | Beispiel |
|---|---|---|---|---|
| `org.name` | text | data | Name der Organisation | Feuerwehr Musterstadt |
| `org.url` | text | data | Basis-URL des Portals | https://portal.example.org |
| `org.contactEmail` | text, optional | data | Kontaktadresse der Organisation | info@example.org |
| `type` | text | data | Typ-Label der Mail | Termin |
| `recipient.name` | text | person | Voller Name des Empfängers | Anna Beispiel |
| `recipient.firstName` | text | person | Vorname des Empfängers | Anna |
| `recipient.lastName` | text | person | Nachname des Empfängers | Beispiel |
| `recipient.email` | text | person | Adresse des Empfängers | anna@example.org |
| `settingsUrl` | text | link | Link zur Einstellungsseite (zeitlich begrenzt) | https://portal.example.org/link/abc |
| `validMinutes` | text | data | Gültigkeit des Links in Minuten | 30 |

## `application-submitted`

Kategorie `membership`, Audience `staff`. Pflichtplatzhalter: keine.

| Variable | Typ | Quelle | Beschreibung | Beispiel |
|---|---|---|---|---|
| `org.name` | text | data | Name der Organisation | Feuerwehr Musterstadt |
| `org.url` | text | data | Basis-URL des Portals | https://portal.example.org |
| `org.contactEmail` | text, optional | data | Kontaktadresse der Organisation | info@example.org |
| `type` | text | data | Typ-Label der Mail | Termin |
| `applicant.name` | text | person | Name des Antragstellers | Anna Beispiel |

## `application-approved`

Kategorie `membership`, Audience `applicant`. Pflichtplatzhalter: keine.

| Variable | Typ | Quelle | Beschreibung | Beispiel |
|---|---|---|---|---|
| `org.name` | text | data | Name der Organisation | Feuerwehr Musterstadt |
| `org.url` | text | data | Basis-URL des Portals | https://portal.example.org |
| `org.contactEmail` | text, optional | data | Kontaktadresse der Organisation | info@example.org |
| `type` | text | data | Typ-Label der Mail | Termin |
| `recipient.name` | text | person | Voller Name des Empfängers | Anna Beispiel |
| `recipient.firstName` | text | person | Vorname des Empfängers | Anna |
| `recipient.lastName` | text | person | Nachname des Empfängers | Beispiel |
| `recipient.email` | text | person | Adresse des Empfängers | anna@example.org |
| `rejoin` | boolean | data | Wieder Mitglied nach Austritt | ja |

## `application-rejected`

Kategorie `membership`, Audience `applicant`. Pflichtplatzhalter: keine.

| Variable | Typ | Quelle | Beschreibung | Beispiel |
|---|---|---|---|---|
| `org.name` | text | data | Name der Organisation | Feuerwehr Musterstadt |
| `org.url` | text | data | Basis-URL des Portals | https://portal.example.org |
| `org.contactEmail` | text, optional | data | Kontaktadresse der Organisation | info@example.org |
| `type` | text | data | Typ-Label der Mail | Termin |
| `recipient.name` | text | person | Voller Name des Empfängers | Anna Beispiel |
| `recipient.firstName` | text | person | Vorname des Empfängers | Anna |
| `recipient.lastName` | text | person | Nachname des Empfängers | Beispiel |
| `recipient.email` | text | person | Adresse des Empfängers | anna@example.org |

## `lend-notify`

Kategorie `lend`, Audience `staff`. Pflichtplatzhalter: keine.

| Variable | Typ | Quelle | Beschreibung | Beispiel |
|---|---|---|---|---|
| `org.name` | text | data | Name der Organisation | Feuerwehr Musterstadt |
| `org.url` | text | data | Basis-URL des Portals | https://portal.example.org |
| `org.contactEmail` | text, optional | data | Kontaktadresse der Organisation | info@example.org |
| `type` | text | data | Typ-Label der Mail | Termin |
| `item.name` | text | data | Name des Gegenstands | Zelt |
| `request.url` | text | link | Anfrage in der Verwaltung | https://portal.example.org/inventory/requests/1 |

## `lend-submitted`

Kategorie `lend`, Audience `applicant`. Pflichtplatzhalter: keine.

| Variable | Typ | Quelle | Beschreibung | Beispiel |
|---|---|---|---|---|
| `org.name` | text | data | Name der Organisation | Feuerwehr Musterstadt |
| `org.url` | text | data | Basis-URL des Portals | https://portal.example.org |
| `org.contactEmail` | text, optional | data | Kontaktadresse der Organisation | info@example.org |
| `type` | text | data | Typ-Label der Mail | Termin |
| `recipient.name` | text | person | Voller Name des Empfängers | Anna Beispiel |
| `recipient.firstName` | text | person | Vorname des Empfängers | Anna |
| `recipient.lastName` | text | person | Nachname des Empfängers | Beispiel |
| `recipient.email` | text | person | Adresse des Empfängers | anna@example.org |
| `item.name` | text | data | Name des Gegenstands | Zelt |
| `request.statusUrl` | text | link | Statusseite der Anfrage | https://portal.example.org/lend/status/abc |

## `lend-approved`

Kategorie `lend`, Audience `applicant`. Pflichtplatzhalter: keine.

| Variable | Typ | Quelle | Beschreibung | Beispiel |
|---|---|---|---|---|
| `org.name` | text | data | Name der Organisation | Feuerwehr Musterstadt |
| `org.url` | text | data | Basis-URL des Portals | https://portal.example.org |
| `org.contactEmail` | text, optional | data | Kontaktadresse der Organisation | info@example.org |
| `type` | text | data | Typ-Label der Mail | Termin |
| `recipient.name` | text | person | Voller Name des Empfängers | Anna Beispiel |
| `recipient.firstName` | text | person | Vorname des Empfängers | Anna |
| `recipient.lastName` | text | person | Nachname des Empfängers | Beispiel |
| `recipient.email` | text | person | Adresse des Empfängers | anna@example.org |
| `item.name` | text | data | Name des Gegenstands | Zelt |
| `request.statusUrl` | text | link | Statusseite der Anfrage | https://portal.example.org/lend/status/abc |

## `lend-rejected`

Kategorie `lend`, Audience `applicant`. Pflichtplatzhalter: keine.

| Variable | Typ | Quelle | Beschreibung | Beispiel |
|---|---|---|---|---|
| `org.name` | text | data | Name der Organisation | Feuerwehr Musterstadt |
| `org.url` | text | data | Basis-URL des Portals | https://portal.example.org |
| `org.contactEmail` | text, optional | data | Kontaktadresse der Organisation | info@example.org |
| `type` | text | data | Typ-Label der Mail | Termin |
| `recipient.name` | text | person | Voller Name des Empfängers | Anna Beispiel |
| `recipient.firstName` | text | person | Vorname des Empfängers | Anna |
| `recipient.lastName` | text | person | Nachname des Empfängers | Beispiel |
| `recipient.email` | text | person | Adresse des Empfängers | anna@example.org |
| `item.name` | text | data | Name des Gegenstands | Zelt |
| `request.statusUrl` | text | link | Statusseite der Anfrage | https://portal.example.org/lend/status/abc |

## `registration-pending`

Kategorie `registration`, Audience `staff`. Pflichtplatzhalter: keine.

| Variable | Typ | Quelle | Beschreibung | Beispiel |
|---|---|---|---|---|
| `org.name` | text | data | Name der Organisation | Feuerwehr Musterstadt |
| `org.url` | text | data | Basis-URL des Portals | https://portal.example.org |
| `org.contactEmail` | text, optional | data | Kontaktadresse der Organisation | info@example.org |
| `type` | text | data | Typ-Label der Mail | Termin |
| `user.name` | text | person | Name des Benutzers | Anna Beispiel |
| `user.email` | text | person | Adresse des Benutzers | anna@example.org |
| `admin.url` | text | link | Benutzerverwaltung | https://portal.example.org/admin/users |
