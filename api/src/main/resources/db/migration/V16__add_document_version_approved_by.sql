-- V16: Add approved_by and approved_at to document_version to track and display
-- who approved each specific revision in the revision history.
ALTER TABLE document_version ADD COLUMN approved_by integer REFERENCES "user"(id);
ALTER TABLE document_version ADD COLUMN approved_at timestamp;

-- Backfill approved_by and approved_at for released / approved / obsolete versions:
-- Priority 1: Approver from completed workflow audit log
-- Priority 2: Started_by from completed workflow instance
-- Priority 3: Fallback to uploaded_by for versions released without workflow (e.g. bootstrap/seed)
UPDATE document_version dv
SET approved_by = COALESCE(
    (SELECT a.performed_by FROM audit_log a
     JOIN workflow_instance wi ON wi.id = a.entity_id
     WHERE a.entity_type = 'workflow_instance'
       AND wi.document_version_id = dv.id
       AND a.action IN ('completed', 'task_approved')
     ORDER BY a.performed_at DESC LIMIT 1),
    (SELECT wi.started_by FROM workflow_instance wi
     WHERE wi.document_version_id = dv.id AND wi.status = 'completed'
     ORDER BY wi.id DESC LIMIT 1),
    dv.uploaded_by
),
approved_at = COALESCE(
    (SELECT wi.completed_at FROM workflow_instance wi
     WHERE wi.document_version_id = dv.id AND wi.status = 'completed'
     ORDER BY wi.id DESC LIMIT 1),
    dv.uploaded_at
)
WHERE dv.status IN ('approved', 'current', 'obsolete');
