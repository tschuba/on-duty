UPDATE member_roles SET title = 'Feuerwehr-Anwärter' WHERE id = 'f2dd276b-027b-4b82-8313-918bc4f9d5c5';--> statement-breakpoint
DELETE FROM member_role_assignments WHERE member_role_id = '1e2e2581-a5f5-4780-905a-0535ebf93ead';--> statement-breakpoint
DELETE FROM member_roles WHERE id = '1e2e2581-a5f5-4780-905a-0535ebf93ead';
