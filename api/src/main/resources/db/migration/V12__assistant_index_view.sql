-- V12: the read-only window the "Ask" assistant uses to learn what it may index
-- (AI_Assistant_Design_PlanBack.md, F3/F4/section 2.6).
--
-- The rule is the visibility rule every signed-in user already lives under: a document that is not trashed,
-- whose status is approved or released, and that has a current version. The view lists that current version
-- and nothing else, so everything the assistant indexes is already readable by every authenticated user.
-- Drafts, documents in review, superseded/obsolete documents and trashed documents are absent by construction;
-- a document that leaves this set is dropped from the assistant's index at its next sync.
--
-- The version's file name is not a column: it is the tail of file_reference
-- (documents/{documentId}/{versionId}/{fileName}), exactly as MinioStorageService derives it.
--
-- Access is granted per deployment by a RUNBOOK step, never here (it needs a secret, and this migration must
-- run unchanged on databases that do not have the role):
--   CREATE ROLE assistant_ro LOGIN PASSWORD '...';
--   GRANT SELECT ON assistant_indexable_version TO assistant_ro;
--
-- The columns are a contract with assistant/app/sources.py; AssistantIndexViewTests pins them. A later
-- migration that renames or drops one of the underlying document columns must recreate this view.
CREATE VIEW assistant_indexable_version AS
SELECT d.id                AS document_id,
       d.document_number   AS document_number,
       d.name              AS document_name,
       t.code              AS type_code,
       dep.code            AS department_code,
       v.id                AS version_id,
       v.version_number    AS version_number,
       v.file_reference    AS file_reference,
       v.effective_at      AS effective_at,
       v.uploaded_at       AS uploaded_at,
       d.updated_at        AS document_updated_at
FROM document d
JOIN document_version v ON v.id = d.current_version_id
JOIN document_type t    ON t.id = d.document_type_id
JOIN department dep     ON dep.id = d.department_id
WHERE d.deleted_at IS NULL
  AND d.status IN ('approved', 'released');
