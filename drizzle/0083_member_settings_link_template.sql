INSERT INTO "mail_templates" ("key", "locale", "variant", "category", "audience", "edit_permissions", "topic", "prefix", "subject", "body", "headers_mode") VALUES
('member-settings-link', 'de', 'system', 'member', 'member', ARRAY['events:manage']::"permission"[], NULL, '[{{org.name}}|{{type}}]', $s$Deine Einstellungen bei {{org.name}}$s$, $b$Hallo,

du hast angefragt, deine Einstellungen bei {{org.name}} zu ändern. Der Link ist {{validMinutes}} Minuten gültig:

{{settingsUrl}}

Wenn du das nicht warst, kannst du diese Mail ignorieren.

Viele Grüße
{{org.name}}
$b$, 'fixed')
ON CONFLICT DO NOTHING;
