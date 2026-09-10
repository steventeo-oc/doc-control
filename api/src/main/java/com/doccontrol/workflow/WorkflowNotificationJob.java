package com.doccontrol.workflow;

import com.doccontrol.audit.NotificationLog;
import com.doccontrol.audit.NotificationLogRepository;
import com.doccontrol.audit.SystemActor;
import com.doccontrol.config.ReviewProperties;
import com.doccontrol.config.WorkflowProperties;
import com.doccontrol.document.Document;
import com.doccontrol.document.DocumentRepository;
import com.doccontrol.document.DocumentService;
import com.doccontrol.document.DocumentStatus;
import com.doccontrol.document.DocumentVersion;
import com.doccontrol.document.DocumentVersionRepository;
import com.doccontrol.document.DocumentVersionStatus;
import com.doccontrol.identity.User;
import com.doccontrol.identity.UserRepository;
import com.doccontrol.notification.NotificationSender;
import org.flowable.engine.TaskService;
import org.flowable.task.api.Task;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

/**
 * The daily sweep (Phase 2b reminders/escalations + Phase 2c lifecycle
 * phases), run as ordered phases so the day's effects compose:
 *
 * 1. flip approved versions whose effective date has arrived (state
 *    mutation, audited as the System user) and apply pending review-clock
 *    resets from deferred re-approvals;
 * 2. approval-task reminders and escalations (Phase 2b, unchanged);
 * 3. periodic-review notifications (Phase 2c): REVIEW_DUE to the owner in
 *    the reminder window, REVIEW_OVERDUE to owner + admins once the review
 *    is escalateAfterOverdueDays business days past due.
 *
 * Every phase is idempotent for a given business date — safe to run twice:
 * the flip and clock reset are one-way state transitions, and every
 * notification dedups via notification_log (per day, or once per cycle via
 * a stable dedup_key). Sends go through {@link NotificationSender} — the
 * log-only stub today, Microsoft Graph once the Azure app registration
 * exists.
 */
@Component
public class WorkflowNotificationJob {

    private static final Logger log = LoggerFactory.getLogger(WorkflowNotificationJob.class);

    private final TaskService taskService;
    private final WorkflowInstanceRepository instanceRepository;
    private final UserRepository userRepository;
    private final NotificationLogRepository notificationLogRepository;
    private final NotificationSender notificationSender;
    private final WorkflowProperties properties;
    private final ReviewProperties reviewProperties;
    private final DocumentService documentService;
    private final DocumentRepository documentRepository;
    private final DocumentVersionRepository documentVersionRepository;
    private final SystemActor systemActor;

    public WorkflowNotificationJob(TaskService taskService,
                                   WorkflowInstanceRepository instanceRepository,
                                   UserRepository userRepository,
                                   NotificationLogRepository notificationLogRepository,
                                   NotificationSender notificationSender,
                                   WorkflowProperties properties,
                                   ReviewProperties reviewProperties,
                                   DocumentService documentService,
                                   DocumentRepository documentRepository,
                                   DocumentVersionRepository documentVersionRepository,
                                   SystemActor systemActor) {
        this.taskService = taskService;
        this.instanceRepository = instanceRepository;
        this.userRepository = userRepository;
        this.notificationLogRepository = notificationLogRepository;
        this.notificationSender = notificationSender;
        this.properties = properties;
        this.reviewProperties = reviewProperties;
        this.documentService = documentService;
        this.documentRepository = documentRepository;
        this.documentVersionRepository = documentVersionRepository;
        this.systemActor = systemActor;
    }

    @Scheduled(cron = "${doccontrol.workflow.reminder-cron:0 0 7 * * *}")
    public void runScheduled() {
        run(LocalDate.now());
    }

    void run(LocalDate today) {
        flipDueVersions(today);

        List<WorkflowInstance> instances = instanceRepository
                .findByStatus(WorkflowInstanceStatus.IN_PROGRESS);
        for (WorkflowInstance instance : instances) {
            try {
                sweepInstance(instance, today);
            } catch (Exception e) {
                // one broken instance must not stop the sweep
                log.warn("Reminder/escalation sweep failed for instance {}: {}",
                        instance.getId(), e.getMessage());
            }
        }

        sweepReviewOverdue(today);
    }

    /**
     * Phase 1 — effectivity flips and deferred review-clock resets. Each
     * item runs in its own transaction (the service methods are
     * transactional); a failure is logged and the sweep moves on. Both
     * transitions are one-way, so a re-run on the same date finds nothing.
     */
    private void flipDueVersions(LocalDate today) {
        User system = systemActor.get();
        for (DocumentVersion version : documentVersionRepository
                .findAllByStatusAndEffectiveAtLessThanEqualAndDocument_DeletedAtIsNull(
                        DocumentVersionStatus.APPROVED, today)) {
            try {
                documentService.promoteVersion(version, version.getEffectiveAt(), system);
                log.info("Effective-date flip applied: {} v{} effective {}",
                        version.getDocument().getDocumentNumber(),
                        version.getVersionNumber(), version.getEffectiveAt());
            } catch (Exception e) {
                log.warn("Effective-date flip failed for version {}: {}",
                        version.getId(), e.getMessage());
            }
        }
        for (Document document : documentRepository
                .findAllByPendingReviewEffectiveAtLessThanEqualAndDeletedAtIsNull(today)) {
            try {
                documentService.resetReviewClock(document, document.getPendingReviewEffectiveAt(), system);
                log.info("Review clock reset applied: {} effective {}",
                        document.getDocumentNumber(), document.getPendingReviewEffectiveAt());
            } catch (Exception e) {
                log.warn("Review clock reset failed for document {}: {}",
                        document.getId(), e.getMessage());
            }
        }
    }

    /**
     * Phase 3 — periodic-review notifications (Phase 2c). The owner is
     * responsible; escalation to owner + admins mirrors the approval shape.
     */
    private void sweepReviewOverdue(LocalDate today) {
        if (reviewProperties.intervalMonths() <= 0) {
            return; // review tracking switched off
        }
        List<Document> documents = documentRepository
                .findAllByNextReviewDueIsNotNullAndDeletedAtIsNullAndStatusIn(
                        List.of(DocumentStatus.RELEASED, DocumentStatus.APPROVED));
        for (Document document : documents) {
            try {
                sweepDocumentReview(document, today);
            } catch (Exception e) {
                log.warn("Review sweep failed for document {}: {}",
                        document.getId(), e.getMessage());
            }
        }
    }

    private void sweepDocumentReview(Document document, LocalDate today) {
        LocalDate due = document.getNextReviewDue();
        int overdueDays = BusinessDays.overdueBusinessDays(due, today);
        int untilDue = BusinessDays.businessDaysUntil(today, due);

        if (overdueDays >= reviewProperties.escalateAfterOverdueDays()) {
            // dedup_key carries the due date: a re-approval reset starts a new
            // cycle with a new key, so the next overdue cycle escalates again
            String dedupKey = "review-overdue:doc=" + document.getId() + ":due=" + due;
            List<User> targets = new ArrayList<>(List.of(document.getOwner()));
            targets.addAll(userRepository.findActiveAdmins());
            for (User recipient : targets) {
                notifyDocument(document, "REVIEW_OVERDUE", recipient, today, dedupKey,
                        "Overdue review: " + document.getDocumentNumber(),
                        "The periodic review was due " + due + " and is now " + overdueDays
                                + " business day(s) overdue. Clear it by completing a review re-approval.");
            }
        } else if (overdueDays == 0 && untilDue <= reviewProperties.reminderBeforeDays()) {
            notifyDocument(document, "REVIEW_DUE", document.getOwner(), today, null,
                    "Review due soon: " + document.getDocumentNumber(),
                    "The periodic review is due " + due + ".");
        }
    }

    /**
     * Document-anchored notification (Phase 2c): dedups per day when no
     * dedup_key is given, or once per cycle via the key.
     */
    private void notifyDocument(Document document, String kind, User recipient,
                                LocalDate notificationDate, String dedupKey,
                                String subject, String body) {
        boolean alreadySent = dedupKey != null
                ? notificationLogRepository.existsByKindAndDedupKeyAndRecipientId(
                        kind, dedupKey, recipient.getId())
                : notificationLogRepository.existsByKindAndDocumentIdAndRecipientIdAndNotificationDate(
                        kind, document.getId(), recipient.getId(), notificationDate);
        if (alreadySent) {
            return;
        }
        notificationSender.send(recipient, subject, body);

        NotificationLog entry = new NotificationLog();
        entry.setKind(kind);
        entry.setDocument(document);
        entry.setDedupKey(dedupKey);
        entry.setRecipient(recipient);
        entry.setSubject(subject);
        entry.setNotificationDate(notificationDate);
        entry.setChannel("log");
        notificationLogRepository.save(entry);
    }

    private void sweepInstance(WorkflowInstance instance, LocalDate today) {
        if (instance.getProcessInstanceId() == null) {
            return;
        }
        Document document = instance.getDocumentVersion().getDocument();
        for (Task task : taskService.createTaskQuery()
                .processInstanceId(instance.getProcessInstanceId())
                .active()
                .list()) {
            if (task.getDueDate() == null) {
                continue;
            }
            LocalDate dueDate = task.getDueDate().toInstant()
                    .atZone(ZoneId.systemDefault()).toLocalDate();

            List<User> reviewers = resolveReviewers(task);
            int overdueDays = BusinessDays.overdueBusinessDays(dueDate, today);
            int untilDue = BusinessDays.businessDaysUntil(today, dueDate);

            if (overdueDays >= properties.escalateAfterOverdueDays()) {
                List<User> escalationTargets = new ArrayList<>(List.of(document.getOwner()));
                escalationTargets.addAll(userRepository.findActiveAdmins());
                for (User recipient : escalationTargets) {
                    notify(instance, task, "ESCALATION", recipient, today,
                            "Overdue approval: " + document.getDocumentNumber()
                                    + " v" + instance.getDocumentVersion().getVersionNumber()
                                    + " is " + overdueDays + " business day(s) overdue",
                            "The approval task assigned to " + reviewerNames(task)
                                    + " has not been completed. Please chase or delegate.");
                }
            } else if (overdueDays == 0 && untilDue <= properties.reminderBeforeDays()) {
                for (User reviewer : reviewers) {
                    notify(instance, task, "REMINDER", reviewer, today,
                            "Approval due soon: " + document.getDocumentNumber()
                                    + " v" + instance.getDocumentVersion().getVersionNumber(),
                            "The approval task is due " + dueDate + ".");
                }
            }
        }
    }

    /**
     * Claimed task → the assignee; unclaimed pooled task → every active
     * member of the candidate roles.
     */
    private List<User> resolveReviewers(Task task) {
        if (task.getAssignee() != null) {
            return userRepository.findById(Integer.valueOf(task.getAssignee()))
                    .map(List::of)
                    .orElse(List.of());
        }
        List<String> roleNames = taskService.getIdentityLinksForTask(task.getId()).stream()
                .filter(link -> org.flowable.identitylink.api.IdentityLinkType.CANDIDATE
                        .equals(link.getType()))
                .map(org.flowable.identitylink.api.IdentityLink::getGroupId)
                .toList();
        return roleNames.isEmpty() ? List.of() : userRepository.findActiveByRoleNames(roleNames);
    }

    private void notify(WorkflowInstance instance, Task task, String kind, User recipient,
                        LocalDate notificationDate, String subject, String body) {
        boolean alreadySent = kind.equals("ESCALATION")
                ? notificationLogRepository.existsByKindAndFlowableTaskIdAndRecipientId(
                        kind, task.getId(), recipient.getId())
                : notificationLogRepository.existsByKindAndFlowableTaskIdAndRecipientIdAndNotificationDate(
                        kind, task.getId(), recipient.getId(), notificationDate);
        if (alreadySent) {
            return;
        }
        notificationSender.send(recipient, subject, body);

        NotificationLog entry = new NotificationLog();
        entry.setKind(kind);
        entry.setWorkflowInstance(instance);
        entry.setFlowableTaskId(task.getId());
        entry.setRecipient(recipient);
        entry.setSubject(subject);
        entry.setNotificationDate(notificationDate);
        entry.setChannel("log");
        notificationLogRepository.save(entry);
    }

    private String reviewerNames(Task task) {
        if (task.getAssignee() != null) {
            return userRepository.findById(Integer.valueOf(task.getAssignee()))
                    .map(User::getName).orElse(task.getAssignee());
        }
        return taskService.getIdentityLinksForTask(task.getId()).stream()
                .filter(link -> org.flowable.identitylink.api.IdentityLinkType.CANDIDATE
                        .equals(link.getType()))
                .map(org.flowable.identitylink.api.IdentityLink::getGroupId)
                .reduce((a, b) -> a + ", " + b)
                .orElse("unknown");
    }
}
