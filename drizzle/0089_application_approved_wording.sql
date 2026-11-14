UPDATE "mail_templates" SET "body" = $b$Hallo {{recipient.firstName}},

gute Nachrichten: Dein Antrag wurde angenommen.{{#rejoin}} Schön, dass du wieder dabei bist!{{/rejoin}}

Willkommen bei {{org.name}}!

Viele Grüße
{{org.name}}$b$
WHERE "key" = 'application-approved' AND "variant" = 'system' AND "locale" = 'de'
AND "body" LIKE '%Du bist nun{{#rejoin}} wieder{{/rejoin}} Mitglied.%';
