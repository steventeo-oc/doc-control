ALTER TABLE document_tier RENAME TO document_level;
ALTER TABLE document_level RENAME COLUMN tier_number TO level_number;
ALTER TABLE document_type RENAME COLUMN tier_id TO level_id;

UPDATE audit_log
   SET entity_type = 'document_level'
 WHERE entity_type = 'document_tier';

UPDATE audit_log
   SET details = details
       - 'tier_number'
       - 'tier_id'
       || CASE WHEN details ? 'tier_number'
               THEN jsonb_build_object('level_number', details -> 'tier_number')
               ELSE '{}'::jsonb END
       || CASE WHEN details ? 'tier_id'
               THEN jsonb_build_object('level_id', details -> 'tier_id')
               ELSE '{}'::jsonb END
 WHERE details ?| ARRAY['tier_number', 'tier_id'];
