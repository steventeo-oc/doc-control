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
 * One row per reminder/escalation notification sent about a workflow task.
 * Kept separate from audit_log because system-generated notifications have
 * no acting user (audit_log.performed_by is a mandatory user FK).
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

    /** e.g. "REMINDER", "ESCALATION". */
    @Column(nullable = false)
    private String kind;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "workflow_instance_id", nullable = false)
    private WorkflowInstance workflowInstance;

    @Column(name = "flowable_task_id")
    private String flowableTaskId;

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

    /** 'log' until the Microsoft Graph sender lands. */
    @Column(nullable = false)
    private String channel;
}
