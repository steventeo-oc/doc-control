-- V6 — Phase 2c: effectivity dates, periodic review, and the plumbing both
-- lifecycle extensions share (designed in Phase2c_2d_Design_PlanBack.md):
--   * document_version.effective_at — when this version takes effect
--     (approval date when immediate, approver-chosen date when deferred).
--   * document.last_reviewed_at / next_review_due — the periodic-review
--     clock; overdue is derived (next_review_due < today), never stored.
--   * document.pending_review_effective_at — a re-approval's chosen future
--     effective date; the daily job consumes it to reset the review clock.
--   * document_version.change_reference — optional free-text Change/CAPA
--     reference (Should priority, no external validation).
--   * workflow_instance.kind — approval vs periodic-review re-approval.
--   * notification_log anchors generalize beyond workflow tasks
--     (document/version refs; workflow_instance_id now optional) plus a
--     dedup_key for once-per-cycle escalations.
--   * a non-login system user as the audit actor for sweep-driven state
--     mutations — audit_log.performed_by stays mandatory (flag F5).

ALTER TABLE document_version ADD COLUMN effective_at date;
ALTER TABLE document_version ADD COLUMN change_reference text;

ALTER TABLE document
    ADD COLUMN last_reviewed_at date,
    ADD COLUMN next_review_due date,
    ADD COLUMN pending_review_effective_at date;

-- 'approved' joins the version lifecycle: approved content awaiting its
-- effective date (plan-back flag F3).
ALTER TABLE document_version DROP CONSTRAINT ck_document_version_status;
ALTER TABLE document_version ADD CONSTRAINT ck_document_version_status
    CHECK (status IN ('draft', 'approved', 'current', 'superseded'));

ALTER TABLE workflow_instance ADD COLUMN kind text NOT NULL DEFAULT 'approval';
ALTER TABLE workflow_instance ADD CONSTRAINT ck_workflow_instance_kind
    CHECK (kind IN ('approval', 'reapproval'));

ALTER TABLE notification_log ALTER COLUMN workflow_instance_id DROP NOT NULL;
ALTER TABLE notification_log
    ADD COLUMN document_id integer REFERENCES document (id),
    ADD COLUMN document_version_id integer REFERENCES document_version (id),
    ADD COLUMN dedup_key text;

INSERT INTO "user" (name, email, active)
SELECT 'System', 'system@doccontrol.internal', false
WHERE NOT EXISTS (SELECT 1 FROM "user" WHERE email = 'system@doccontrol.internal');

-- Backfill: versions already in effect (or superseded from effect) take their
-- effective date from their upload date — the closest available approximation
-- for pre-2c data.
UPDATE document_version SET effective_at = uploaded_at::date
WHERE effective_at IS NULL AND status IN ('current', 'superseded');

-- Backfill the review clock for already-released documents with the default
-- 12-month interval (matches application.yml; later config changes affect
-- future resets only — see plan-back decision D4).
UPDATE document d
SET last_reviewed_at = dv.effective_at,
    next_review_due  = (dv.effective_at + INTERVAL '12 months')::date
FROM document_version dv
WHERE d.current_version_id = dv.id
  AND dv.effective_at IS NOT NULL
  AND d.next_review_due IS NULL;
