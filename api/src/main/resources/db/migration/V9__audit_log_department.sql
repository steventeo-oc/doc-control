-- Activity feed plan-back (F1, approved 2026-09-14): department context on
-- every audit row, so "My Department(s)" scope is one indexed predicate
-- instead of per-entityType joins. The service layer populates it at write
-- time (it already holds the department in the same transaction); this
-- migration backfills what a direct join can resolve. NULL stays
-- legitimate: rows with no single department (lookup config, user rows,
-- sweep triggers) are visible only in Mine (if actor) and Admin company
-- scope — never in department scope.
--
-- ON DELETE SET NULL: departments are hard-deleted (lookup admin) and the
-- immutable audit trail must neither block that nor lose rows — a deleted
-- department's rows simply become NULL-department rows, the same semantics
-- as the delete flow's own audit entry.

ALTER TABLE audit_log
    ADD COLUMN department_id INTEGER REFERENCES department (id) ON DELETE SET NULL;

CREATE INDEX idx_audit_log_department_performed
    ON audit_log (department_id, performed_at DESC);
CREATE INDEX idx_audit_log_performed_by
    ON audit_log (performed_by, performed_at DESC);

-- document-anchored rows
UPDATE audit_log a
   SET department_id = d.department_id
  FROM document d
 WHERE a.entity_type = 'document' AND a.entity_id = d.id;

UPDATE audit_log a
   SET department_id = d.department_id
  FROM document_version dv
  JOIN document d ON d.id = dv.document_id
 WHERE a.entity_type = 'document_version' AND a.entity_id = dv.id;

UPDATE audit_log a
   SET department_id = d.department_id
  FROM workflow_instance wi
  JOIN document_version dv ON dv.id = wi.document_version_id
  JOIN document d ON d.id = dv.document_id
 WHERE a.entity_type = 'workflow_instance' AND a.entity_id = wi.id;

UPDATE audit_log a
   SET department_id = d.department_id
  FROM document_acknowledgment da
  JOIN document_version dv ON dv.id = da.document_version_id
  JOIN document d ON d.id = dv.document_id
 WHERE a.entity_type = 'document_acknowledgment' AND a.entity_id = da.id;

UPDATE audit_log a
   SET department_id = d.department_id
  FROM document_acknowledgment_access daa
  JOIN document d ON d.id = daa.document_id
 WHERE a.entity_type = 'document_acknowledgment_access' AND a.entity_id = daa.id;

-- department rows: the audited department is the entity itself
UPDATE audit_log a
   SET department_id = a.entity_id
 WHERE a.entity_type = 'department'
   AND EXISTS (SELECT 1 FROM department d WHERE d.id = a.entity_id);
