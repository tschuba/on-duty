-- Merge "1./2. Vorstand" and "1./2. Kommandant" into one role each; the ordinal moves to member_role_assignments.note.
-- Roles are addressed by fixed seed ID (titles are editable). Idempotent: does nothing once the "2." role is gone.
DO $$
DECLARE
  pair record;
  conflicts integer;
BEGIN
  FOR pair IN
    SELECT * FROM (VALUES
      ('8bf6c0be-faa1-4149-b116-ef6bebf7cece'::uuid, '9f1dc72b-bce2-4602-b4f0-fe30369f93d4'::uuid, 'Vorstand'),
      ('9540a309-6b49-48f8-b39b-2349018a6119'::uuid, 'cd40f0d0-9f83-4667-bad2-1c163f3378ad'::uuid, 'Kommandant')
    ) AS v(keep_id, drop_id, title)
  LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM member_roles WHERE id = pair.drop_id);
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM member_roles WHERE id = pair.keep_id);

    SELECT count(*) INTO conflicts FROM (
      SELECT member_id FROM member_role_assignments
      WHERE "to" IS NULL AND member_role_id IN (pair.keep_id, pair.drop_id)
      GROUP BY member_id HAVING count(*) > 1) c;
    RAISE NOTICE '% : % member(s) with simultaneously open assignments get merged', pair.title, conflicts;

    UPDATE member_role_assignments
      SET note = CASE WHEN note IS NULL OR note = '' THEN '1.' ELSE note || '; 1.' END
      WHERE member_role_id = pair.keep_id;
    UPDATE member_role_assignments
      SET note = CASE WHEN note IS NULL OR note = '' THEN '2.' ELSE note || '; 2.' END,
          member_role_id = pair.keep_id
      WHERE member_role_id = pair.drop_id;

    -- Merge simultaneously open rows: earliest "from" survives, notes are joined, others deleted.
    WITH open_rows AS (
      SELECT id, member_id, "from", note,
             row_number() OVER (PARTITION BY member_id ORDER BY "from", id) AS rn
      FROM member_role_assignments
      WHERE "to" IS NULL AND member_role_id = pair.keep_id
    ), merged AS (
      SELECT member_id, string_agg(note, '; ' ORDER BY rn) FILTER (WHERE note IS NOT NULL) AS notes
      FROM open_rows GROUP BY member_id HAVING count(*) > 1
    ), upd AS (
      UPDATE member_role_assignments a SET note = m.notes
      FROM open_rows o JOIN merged m USING (member_id)
      WHERE a.id = o.id AND o.rn = 1
      RETURNING a.id
    )
    DELETE FROM member_role_assignments a
      USING open_rows o JOIN merged m USING (member_id)
      WHERE a.id = o.id AND o.rn > 1;

    DELETE FROM member_roles WHERE id = pair.drop_id;
    UPDATE member_roles SET title = pair.title WHERE id = pair.keep_id;
  END LOOP;
END $$;
