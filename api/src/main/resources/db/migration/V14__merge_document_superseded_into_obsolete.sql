-- V14: document-level superseded was an unused lifecycle state. Version-level
-- superseded remains unchanged; only retired document rows are consolidated.
UPDATE document
SET status = 'obsolete'
WHERE status = 'superseded';

ALTER TABLE document DROP CONSTRAINT ck_document_status;
ALTER TABLE document ADD CONSTRAINT ck_document_status
    CHECK (status IN ('draft', 'in_review', 'approved', 'released', 'obsolete'));
