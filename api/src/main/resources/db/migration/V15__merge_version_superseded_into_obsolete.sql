-- V15: consolidate version-level superseded into obsolete, completely eliminating
-- the superseded state from the document control lifecycle.
ALTER TABLE document_version DROP CONSTRAINT IF EXISTS ck_document_version_status;

UPDATE document_version
SET status = 'obsolete'
WHERE status = 'superseded';

ALTER TABLE document_version ADD CONSTRAINT ck_document_version_status
    CHECK (status IN ('draft', 'approved', 'current', 'obsolete'));
