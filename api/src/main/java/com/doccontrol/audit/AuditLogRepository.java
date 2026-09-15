package com.doccontrol.audit;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.repository.query.Param;
import org.springframework.data.jpa.repository.Query;

import java.util.Collection;
import java.util.List;

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
}
