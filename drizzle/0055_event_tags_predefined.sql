DELETE FROM event_tags a WHERE lower(a.tag) = lower('Pflichttermin') AND a.tag <> 'mandatory' AND EXISTS (SELECT 1 FROM event_tags b WHERE b.event_id = a.event_id AND b.tag = 'mandatory');--> statement-breakpoint
DELETE FROM event_tags a USING event_tags b WHERE lower(a.tag) = lower('Pflichttermin') AND lower(b.tag) = lower('Pflichttermin') AND a.event_id = b.event_id AND a.tag > b.tag;--> statement-breakpoint
UPDATE event_tags SET tag = 'mandatory' WHERE lower(tag) = lower('Pflichttermin');--> statement-breakpoint
DELETE FROM event_tags a WHERE lower(a.tag) = lower('Übung') AND a.tag <> 'drill' AND EXISTS (SELECT 1 FROM event_tags b WHERE b.event_id = a.event_id AND b.tag = 'drill');--> statement-breakpoint
DELETE FROM event_tags a USING event_tags b WHERE lower(a.tag) = lower('Übung') AND lower(b.tag) = lower('Übung') AND a.event_id = b.event_id AND a.tag > b.tag;--> statement-breakpoint
UPDATE event_tags SET tag = 'drill' WHERE lower(tag) = lower('Übung');--> statement-breakpoint
DELETE FROM event_tags a WHERE lower(a.tag) = lower('Schulung') AND a.tag <> 'training' AND EXISTS (SELECT 1 FROM event_tags b WHERE b.event_id = a.event_id AND b.tag = 'training');--> statement-breakpoint
DELETE FROM event_tags a USING event_tags b WHERE lower(a.tag) = lower('Schulung') AND lower(b.tag) = lower('Schulung') AND a.event_id = b.event_id AND a.tag > b.tag;--> statement-breakpoint
UPDATE event_tags SET tag = 'training' WHERE lower(tag) = lower('Schulung');--> statement-breakpoint
DELETE FROM event_tags a WHERE lower(a.tag) = lower('Feier') AND a.tag <> 'party' AND EXISTS (SELECT 1 FROM event_tags b WHERE b.event_id = a.event_id AND b.tag = 'party');--> statement-breakpoint
DELETE FROM event_tags a USING event_tags b WHERE lower(a.tag) = lower('Feier') AND lower(b.tag) = lower('Feier') AND a.event_id = b.event_id AND a.tag > b.tag;--> statement-breakpoint
UPDATE event_tags SET tag = 'party' WHERE lower(tag) = lower('Feier');--> statement-breakpoint
DELETE FROM event_tags a WHERE lower(a.tag) = lower('Sitzung') AND a.tag <> 'meeting' AND EXISTS (SELECT 1 FROM event_tags b WHERE b.event_id = a.event_id AND b.tag = 'meeting');--> statement-breakpoint
DELETE FROM event_tags a USING event_tags b WHERE lower(a.tag) = lower('Sitzung') AND lower(b.tag) = lower('Sitzung') AND a.event_id = b.event_id AND a.tag > b.tag;--> statement-breakpoint
UPDATE event_tags SET tag = 'meeting' WHERE lower(tag) = lower('Sitzung');
