package com.doccontrol.audit;

import com.doccontrol.identity.User;
import com.doccontrol.workflow.WorkflowInstance;
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

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * One row per system-generated notification (reminders, escalations, and —
 * since Phase 2c — review and acknowledgment notices). Kept separate from
 * audit_log because system-generated notifications have no acting user
 * (audit_log.performed_by is a mandatory user FK). Each row anchors to
 * whatever it concerns: a workflow task, a document, and/or a version —
 * the nullable FKs below; dedup is per kind (plan-back §4/§5).
 */
@Entity
@Table(name = "notification_log")
@Getter
@Setter
@NoArgsConstructor
public class NotificationLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Integer id;

    /** e.g. "REMINDER", "ESCALATION", "REVIEW_DUE", "ACK_REMINDER". */
    @Column(nullable = false)
    private String kind;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "workflow_instance_id")
    private WorkflowInstance workflowInstance;

    @Column(name = "flowable_task_id")
    private String flowableTaskId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "document_id")
    private com.doccontrol.document.Document document;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "document_version_id")
    private com.doccontrol.document.DocumentVersion documentVersion;

    /**
     * Stable key for once-per-cycle dedup (e.g. "review-overdue:doc=8:due=
     * 2026-10-01") — re-fires only when the key changes (plan-back §2.5).
     */
    @Column(name = "dedup_key")
    private String dedupKey;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "recipient", nullable = false)
    private User recipient;

    @Column
    private String subject;

    @CreationTimestamp
    @Column(name = "sent_at", nullable = false, updatable = false)
    private LocalDateTime sentAt;

    /** The business date the notification was issued for (dedup key). */
    @Column(name = "notification_date")
    private LocalDate notificationDate;

    /** The transport that delivered it — 'log' (default) or 'graph'. */
    @Column(nullable = false)
    private String channel;
}
