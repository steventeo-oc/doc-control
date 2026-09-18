package com.doccontrol.audit;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.repository.query.Param;
import org.springframework.data.jpa.repository.Query;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface AuditLogRepository
        extends JpaRepository<AuditLog, Integer>, JpaSpecificationExecutor<AuditLog> {

    /**
     * The task_approved rows for the given Flowable task ids — the approver
     * is performed_by (the engine's own task history does not persist task
     * assignees reliably, so the audit trail is the approver record).
     */
    @Query(value = "SELECT * FROM audit_log WHERE entity_type = 'workflow_instance' " +
            "AND action = 'task_approved' AND details ->> 'task_id' IN (:taskIds)",
            nativeQuery = true)
    List<AuditLog> findTaskApprovedByTaskIds(@Param("taskIds") Collection<String> taskIds);

    @Query(value = "SELECT * FROM audit_log WHERE entity_type = 'workflow_instance' " +
            "AND action IN ('task_delegated', 'task_delegation_recalled') " +
            "AND details ->> 'task_id' IN (:taskIds) ORDER BY performed_at ASC",
            nativeQuery = true)
    List<AuditLog> findTaskDelegationsByTaskIds(@Param("taskIds") Collection<String> taskIds);

    @Query(value = "SELECT * FROM audit_log WHERE entity_type = 'workflow_instance' " +
            "AND entity_id = :instanceId AND action IN ('rejected', 'cancelled') " +
            "ORDER BY performed_at DESC LIMIT 1",
            nativeQuery = true)
    Optional<AuditLog> findLatestRejectionOrCancellation(@Param("instanceId") Integer instanceId);

    @Query(value = "SELECT * FROM audit_log WHERE (entity_type = 'document' AND entity_id = :documentId) " +
            "OR details ->> 'document_id' = CAST(:documentId AS TEXT) " +
            "ORDER BY performed_at DESC, id DESC",
            nativeQuery = true)
    List<AuditLog> findByDocumentId(@Param("documentId") Integer documentId);
}

