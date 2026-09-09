package com.doccontrol.workflow;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface WorkflowInstanceRepository extends JpaRepository<WorkflowInstance, Integer> {

    Optional<WorkflowInstance> findByProcessInstanceId(String processInstanceId);

    List<WorkflowInstance> findByStatus(WorkflowInstanceStatus status);

    boolean existsByDocumentVersionIdAndStatus(Integer documentVersionId, WorkflowInstanceStatus status);

    /** In-progress instances across all versions of a document (reviewer visibility). */
    @Query("SELECT wi FROM WorkflowInstance wi WHERE wi.documentVersion.document.id = :documentId " +
            "AND wi.status = com.doccontrol.workflow.WorkflowInstanceStatus.IN_PROGRESS")
    List<WorkflowInstance> findInProgressByDocumentId(@Param("documentId") Integer documentId);
}
