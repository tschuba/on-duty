UPDATE "mail_templates" SET "body" = replace(body, $a$melde dich gern bei uns.
$a$, $b$melde dich gern bei uns.

{{#org.contactEmail}}
Du erreichst uns unter: {{org.contactEmail}}

{{/org.contactEmail}}
$b$)
WHERE "variant" = 'system' AND "locale" = 'de' AND "key" = 'application-rejected'
AND "body" LIKE '%melde dich gern bei uns.' || E'\n%' AND "body" NOT LIKE '%org.contactEmail%';
