INSERT INTO "mail_templates" ("key", "locale", "variant", "category", "audience", "edit_permissions", "topic", "prefix", "subject", "body", "headers_mode") VALUES
('event-mail-info', 'de', 'system', 'event', 'member', ARRAY['events:manage']::"permission"[], 'events', '[{{org.name}}|{{type}}]', $s$Künftig Termine per Mail$s$, $b$Hallo {{addressee}},

{{org.name}} informiert künftig per Mail über neue und geänderte Termine. Zu- und Absagen sind direkt aus der Mail möglich, ohne Anmeldung im Portal.

Das ist freiwillig. Wer diese Mails nicht möchte, klickt auf den Link „Keine Termin-Mails mehr“. Wer sie erhalten möchte, muss nichts tun.

{{#recipients}}
{{#multiple}}
--- {{name}} ---
{{/multiple}}
Keine Termin-Mails mehr: {{optOutUrl}}

{{/recipients}}
{{#multiple}}
Keine Termin-Mails mehr für alle Mitglieder dieser Adresse: {{optOutAllUrl}}

{{/multiple}}
Die Einstellung lässt sich jederzeit ohne Anmeldung ändern: {{org.url}}/me

Viele Grüße
{{org.name}}
$b$, 'fixed')
ON CONFLICT DO NOTHING;
