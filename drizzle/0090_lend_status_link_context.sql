UPDATE "mail_templates" SET "body" = replace(body, $a${{request.statusUrl}}
$a$, $b$Den aktuellen Stand und alle Details zu deiner Anfrage findest du hier:
{{request.statusUrl}}

{{#org.contactEmail}}
Bei Fragen melde dich einfach bei uns: {{org.contactEmail}}

{{/org.contactEmail}}
$b$)
WHERE "variant" = 'system' AND "locale" = 'de' AND "key" IN ('lend-submitted', 'lend-approved')
AND "body" LIKE '%' || E'\n\n{{request.statusUrl}}\n%';--> statement-breakpoint
UPDATE "mail_templates" SET "body" = replace(body, $a$wurde leider abgelehnt.

{{request.statusUrl}}
$a$, $b$wurde leider abgelehnt.

{{#org.contactEmail}}
Bei Fragen melde dich einfach bei uns: {{org.contactEmail}}

{{/org.contactEmail}}
$b$)
WHERE "variant" = 'system' AND "locale" = 'de' AND "key" = 'lend-rejected'
AND "body" LIKE '%' || E'abgelehnt.\n\n{{request.statusUrl}}\n%';
