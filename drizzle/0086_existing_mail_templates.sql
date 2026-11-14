INSERT INTO "mail_templates" ("key", "locale", "variant", "category", "audience", "edit_permissions", "topic", "prefix", "subject", "body", "headers_mode") VALUES
('application-submitted', 'de', 'system', 'membership', 'staff', ARRAY['applications:manage']::"permission"[], NULL, '[{{org.name}}|{{type}}]', $s$Neuer Antrag eingegangen: {{applicant.name}}$s$, $b$Neuer Antrag von {{applicant.name}} ist eingegangen und wartet auf Prüfung.$b$, 'fixed'),
('application-approved', 'de', 'system', 'membership', 'applicant', ARRAY['applications:manage']::"permission"[], NULL, '[{{org.name}}|{{type}}]', $s$Dein Antrag wurde angenommen$s$, $b$Hallo {{recipient.firstName}},

dein Antrag wurde angenommen. Du bist nun{{#rejoin}} wieder{{/rejoin}} Mitglied.

Viele Grüße
{{org.name}}$b$, 'fixed'),
('application-rejected', 'de', 'system', 'membership', 'applicant', ARRAY['applications:manage']::"permission"[], NULL, '[{{org.name}}|{{type}}]', $s$Dein Antrag wurde abgelehnt$s$, $b$Hallo {{recipient.firstName}},

dein Antrag wurde leider abgelehnt.

Viele Grüße
{{org.name}}$b$, 'fixed'),
('lend-notify', 'de', 'system', 'lend', 'staff', ARRAY['lending:manage']::"permission"[], NULL, '[{{org.name}}|{{type}}]', $s$Neue Verleih-Anfrage: {{item.name}}$s$, $b$Neue Anfrage für {{item.name}}. Details: {{request.url}}$b$, 'fixed'),
('lend-submitted', 'de', 'system', 'lend', 'applicant', ARRAY['lending:manage']::"permission"[], NULL, '[{{org.name}}|{{type}}]', $s$Deine Verleih-Anfrage ist eingegangen$s$, $b$Hallo {{recipient.firstName}},

deine Anfrage für {{item.name}} ist eingegangen und wird geprüft. Das ist noch keine Zusage.

{{request.statusUrl}}

Viele Grüße
{{org.name}}$b$, 'fixed'),
('lend-approved', 'de', 'system', 'lend', 'applicant', ARRAY['lending:manage']::"permission"[], NULL, '[{{org.name}}|{{type}}]', $s$Deine Verleih-Anfrage wurde genehmigt$s$, $b$Hallo {{recipient.firstName}},

deine Anfrage für {{item.name}} wurde genehmigt.

{{request.statusUrl}}

Viele Grüße
{{org.name}}$b$, 'fixed'),
('lend-rejected', 'de', 'system', 'lend', 'applicant', ARRAY['lending:manage']::"permission"[], NULL, '[{{org.name}}|{{type}}]', $s$Deine Verleih-Anfrage wurde abgelehnt$s$, $b$Hallo {{recipient.firstName}},

deine Anfrage für {{item.name}} wurde leider abgelehnt.

{{request.statusUrl}}

Viele Grüße
{{org.name}}$b$, 'fixed'),
('registration-pending', 'de', 'system', 'registration', 'staff', ARRAY['system:admin']::"permission"[], NULL, '[{{org.name}}|{{type}}]', $s$Neue Registrierung wartet auf Freigabe$s$, $b${{user.name}} ({{user.email}}) hat sich registriert und wartet auf Freigabe.

{{admin.url}}$b$, 'fixed');
