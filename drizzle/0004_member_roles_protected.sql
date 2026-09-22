ALTER TABLE member_roles ADD COLUMN is_protected boolean NOT NULL DEFAULT false;
UPDATE member_roles SET is_protected = true WHERE id = '1e2e2581-a5f5-4780-905a-0535ebf93ead';
