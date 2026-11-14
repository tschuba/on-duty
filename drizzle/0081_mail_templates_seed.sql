INSERT INTO "mail_templates" ("key", "locale", "variant", "category", "audience", "edit_permissions", "topic", "prefix", "subject", "body", "headers_mode") VALUES
('event-created', 'de', 'system', 'event', 'member', ARRAY['events:manage']::"permission"[], 'events', '[{{org.name}}|{{type}}]', $s$Neuer Termin: {{event.title}}, {{event.date}}$s$, $b$Hallo {{addressee}},

wir laden {{you}} zu einem neuen Termin ein:

{{event.title}}
Wann:  {{event.when}}
{{#event.location}}
Wo:    {{event.location}}
{{/event.location}}
{{#event.rsvpEnabled}}
{{#event.rsvpDeadline}}
Anmeldung bis: {{event.rsvpDeadline}}
{{/event.rsvpDeadline}}
{{#event.maxParticipants}}
Plätze: {{event.maxParticipants}}
{{/event.maxParticipants}}
{{/event.rsvpEnabled}}

{{#recipients}}
{{#multiple}}
--- {{name}} ---
{{/multiple}}
{{#event.rsvpEnabled}}
Zusagen:  {{rsvpYesUrl}}
Absagen:  {{rsvpNoUrl}}
{{/event.rsvpEnabled}}
Keine Termin-Mails mehr{{#multiple}} für {{name}}{{/multiple}}: {{optOutUrl}}

{{/recipients}}
Alle Details im Portal: {{event.url}}
{{#multiple}}
Keine Termin-Mails mehr für alle Mitglieder dieser Adresse: {{optOutAllUrl}}
{{/multiple}}

Viele Grüße
{{org.name}}$b$, 'fixed'),
('event-updated', 'de', 'system', 'event', 'member', ARRAY['events:manage']::"permission"[], 'events', '[{{org.name}}|{{type}}]', $s$Termin geändert: {{event.title}}, {{event.date}}$s$, $b$Hallo {{addressee}},

bei folgendem Termin gibt es eine Änderung:

{{event.title}}
Wann:  {{event.when}}
{{#event.location}}
Wo:    {{event.location}}
{{/event.location}}
{{#event.rsvpEnabled}}
{{#event.rsvpDeadline}}
Anmeldung bis: {{event.rsvpDeadline}}
{{/event.rsvpDeadline}}
{{#event.maxParticipants}}
Plätze: {{event.maxParticipants}}
{{/event.maxParticipants}}
{{/event.rsvpEnabled}}
{{event.changes}}

{{#recipients}}
{{#multiple}}
--- {{name}} ---
{{/multiple}}
{{#event.rsvpEnabled}}
Zusagen:  {{rsvpYesUrl}}
Absagen:  {{rsvpNoUrl}}
{{/event.rsvpEnabled}}
Keine Termin-Mails mehr{{#multiple}} für {{name}}{{/multiple}}: {{optOutUrl}}

{{/recipients}}
Alle Details im Portal: {{event.url}}
{{#multiple}}
Keine Termin-Mails mehr für alle Mitglieder dieser Adresse: {{optOutAllUrl}}
{{/multiple}}

Viele Grüße
{{org.name}}$b$, 'fixed'),
('event-cancelled', 'de', 'system', 'event', 'member', ARRAY['events:manage']::"permission"[], 'events', '[{{org.name}}|{{type}}]', $s$Termin abgesagt: {{event.title}}, {{event.date}}$s$, $b$Hallo {{addressee}},

leider müssen wir folgenden Termin absagen:

{{event.title}}
Wann:  {{event.when}}
{{#event.location}}
Wo:    {{event.location}}
{{/event.location}}
{{#event.rsvpEnabled}}
{{#event.rsvpDeadline}}
Anmeldung bis: {{event.rsvpDeadline}}
{{/event.rsvpDeadline}}
{{#event.maxParticipants}}
Plätze: {{event.maxParticipants}}
{{/event.maxParticipants}}
{{/event.rsvpEnabled}}

{{#recipients}}
{{#multiple}}
--- {{name}} ---
{{/multiple}}
Keine Termin-Mails mehr{{#multiple}} für {{name}}{{/multiple}}: {{optOutUrl}}

{{/recipients}}
Alle Details im Portal: {{event.url}}
{{#multiple}}
Keine Termin-Mails mehr für alle Mitglieder dieser Adresse: {{optOutAllUrl}}
{{/multiple}}

Viele Grüße
{{org.name}}$b$, 'fixed'),
('event-uncancelled', 'de', 'system', 'event', 'member', ARRAY['events:manage']::"permission"[], 'events', '[{{org.name}}|{{type}}]', $s$Termin findet statt: {{event.title}}, {{event.date}}$s$, $b$Hallo {{addressee}},

folgender Termin findet statt:

{{event.title}}
Wann:  {{event.when}}
{{#event.location}}
Wo:    {{event.location}}
{{/event.location}}
{{#event.rsvpEnabled}}
{{#event.rsvpDeadline}}
Anmeldung bis: {{event.rsvpDeadline}}
{{/event.rsvpDeadline}}
{{#event.maxParticipants}}
Plätze: {{event.maxParticipants}}
{{/event.maxParticipants}}
{{/event.rsvpEnabled}}
Die Absage wurde zurückgenommen.

{{#recipients}}
{{#multiple}}
--- {{name}} ---
{{/multiple}}
{{#event.rsvpEnabled}}
Zusagen:  {{rsvpYesUrl}}
Absagen:  {{rsvpNoUrl}}
{{/event.rsvpEnabled}}
Keine Termin-Mails mehr{{#multiple}} für {{name}}{{/multiple}}: {{optOutUrl}}

{{/recipients}}
Alle Details im Portal: {{event.url}}
{{#multiple}}
Keine Termin-Mails mehr für alle Mitglieder dieser Adresse: {{optOutAllUrl}}
{{/multiple}}

Viele Grüße
{{org.name}}$b$, 'fixed');
