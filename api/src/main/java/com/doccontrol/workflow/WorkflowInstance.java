package com.doccontrol.workflow;

import com.doccontrol.document.DocumentVersion;
import com.doccontrol.identity.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * Thin link between a document version and the Flowable process instance
 * that runs its approval (Phase 2b). Task/assignee state lives in Flowable;
 * this row exists for domain correlation, ISO audit, and the notification
 * job.
 */
@Entity
@Table(name = "workflow_instance")
@Getter
@Setter
@NoArgsConstructor
public class WorkflowInstance {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Integer id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "document_version_id", nullable = false)
    private DocumentVersion documentVersion;

    /** Flowable process instance id; null between row creation and engine start. */
    @Column(name = "process_instance_id")
    private String processInstanceId;

    private WorkflowInstanceStatus status;

    /**
     * APPROVAL (draft-version approval) or REAPPROVAL (periodic-review
     * re-approval of the current version) — Phase 2c. Defaults to APPROVAL;
     * the DB column carries the same default for pre-existing rows.
     */
    private WorkflowInstanceKind kind = WorkflowInstanceKind.APPROVAL;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "started_by", nullable = false)
    private User startedBy;

    @CreationTimestamp
    @Column(name = "started_at", nullable = false, updatable = false)
    private LocalDateTime startedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;
}
