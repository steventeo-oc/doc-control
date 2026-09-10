package com.doccontrol.workflow;

import com.doccontrol.acknowledgment.AcknowledgmentService;
import com.doccontrol.audit.NotificationLog;
import com.doccontrol.audit.NotificationLogRepository;
import com.doccontrol.audit.SystemActor;
import com.doccontrol.config.AcknowledgmentProperties;
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
import org.springframework.transaction.support.TransactionTemplate;

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
 *    is escalateAfterOverdueDays business days past due;
 * 4. acknowledgment notifications (Phase 2d): ACK_REMINDER to department
 *    members who still owe one near the window close, ACK_OVERDUE summary
 *    to owner + admins past the close — record-only, nothing is gated.
 *
 * Every phase is idempotent for a given business date — safe to run twice:
 * the flip and clock reset are one-way state transitions, and every
 * notification dedups via notification_log (per day, or once per cycle via
 * a stable dedup_key). Each item runs in its own transaction (via
 * {@link TransactionTemplate}): the scheduled job executes outside any
 * transaction, so entities must be re-fetched inside one — otherwise lazy
 * relations fail and detached mutations are silently lost. Sends go through
 * {@link NotificationSender} — the log-only stub today, Microsoft Graph
 * once the Azure app registration exists.
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
    private final AcknowledgmentProperties acknowledgmentProperties;
    private final DocumentService documentService;
    private final DocumentRepository documentRepository;
    private final DocumentVersionRepository documentVersionRepository;
    private final SystemActor systemActor;
    private final AcknowledgmentService acknowledgmentService;
    private final TransactionTemplate transactionTemplate;

    public WorkflowNotificationJob(TaskService taskService,
                                   WorkflowInstanceRepository instanceRepository,
                                   UserRepository userRepository,
                                   NotificationLogRepository notificationLogRepository,
                                   NotificationSender notificationSender,
                                   WorkflowProperties properties,
                                   ReviewProperties reviewProperties,
                                   AcknowledgmentProperties acknowledgmentProperties,
                                   DocumentService documentService,
                                   DocumentRepository documentRepository,
                                   DocumentVersionRepository documentVersionRepository,
                                   SystemActor systemActor,
                                   AcknowledgmentService acknowledgmentService,
                                   TransactionTemplate transactionTemplate) {
        this.taskService = taskService;
        this.instanceRepository = instanceRepository;
        this.userRepository = userRepository;
        this.notificationLogRepository = notificationLogRepository;
        this.notificationSender = notificationSender;
        this.properties = properties;
        this.reviewProperties = reviewProperties;
        this.acknowledgmentProperties = acknowledgmentProperties;
        this.documentService = documentService;
        this.documentRepository = documentRepository;
        this.documentVersionRepository = documentVersionRepository;
        this.systemActor = systemActor;
        this.acknowledgmentService = acknowledgmentService;
        this.transactionTemplate = transactionTemplate;
    }

    @Scheduled(cron = "${doccontrol.workflow.reminder-cron:0 0 7 * * *}")
    public void runScheduled() {
        run(LocalDate.now());
    }

    void run(LocalDate today) {
        flipDueVersions(today);
        sweepApprovalTasks(today);
        sweepReviewOverdue(today);
        sweepAcknowledgments(today);
    }

    /**
     * Phase 1 — effectivity flips and deferred review-clock resets. Both
     * transitions are one-way, so a re-run on the same date finds nothing.
     */
    private void flipDueVersions(LocalDate today) {
        User system = systemActor.get();
        List<Integer> versionIds = documentVersionRepository
                .findAllByStatusAndEffectiveAtLessThanEqualAndDocument_DeletedAtIsNull(
                        DocumentVersionStatus.APPROVED, today)
                .stream().map(DocumentVersion::getId).toList();
        for (Integer versionId : versionIds) {
            try {
                // one transaction per item: the candidate ids above were read
                // without one, and the entities must be managed (re-fetched)
                // for lazy relations and dirty checking to work (see run()).
                transactionTemplate.execute(tx -> {
                    DocumentVersion version = documentVersionRepository.findById(versionId).orElseThrow();
                    documentService.promoteVersion(version, version.getEffectiveAt(), system);
                    log.info("Effective-date flip applied: {} v{} effective {}",
                            version.getDocument().getDocumentNumber(),
                            version.getVersionNumber(), version.getEffectiveAt());
                    return null;
                });
            } catch (Exception e) {
                log.warn("Effective-date flip failed for version {}: {}",
                        versionId, e.getMessage());
            }
        }
        List<Integer> resetIds = documentRepository
                .findAllByPendingReviewEffectiveAtLessThanEqualAndDeletedAtIsNull(today)
                .stream().map(Document::getId).toList();
        for (Integer documentId : resetIds) {
            try {
                transactionTemplate.execute(tx -> {
                    Document document = documentRepository.findById(documentId).orElseThrow();
                    documentService.resetReviewClock(document, document.getPendingReviewEffectiveAt(), system);
                    log.info("Review clock reset applied: {} effective {}",
                            document.getDocumentNumber(), document.getPendingReviewEffectiveAt());
                    return null;
                });
            } catch (Exception e) {
                log.warn("Review clock reset failed for document {}: {}",
                        documentId, e.getMessage());
            }
        }
    }

    /**
     * Phase 2 — approval-task reminders and escalations (Phase 2b rules,
     * unchanged): reminders in the run-up to the due date, escalation to
     * owner + admins once overdue.
     */
    private void sweepApprovalTasks(LocalDate today) {
        List<Integer> instanceIds = instanceRepository
                .findByStatus(WorkflowInstanceStatus.IN_PROGRESS)
                .stream().map(WorkflowInstance::getId).toList();
        for (Integer instanceId : instanceIds) {
            try {
                transactionTemplate.execute(tx -> {
                    sweepInstance(instanceRepository.findById(instanceId).orElseThrow(), today);
                    return null;
                });
            } catch (Exception e) {
                // one broken instance must not stop the sweep
                log.warn("Reminder/escalation sweep failed for instance {}: {}",
                        instanceId, e.getMessage());
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
        List<Integer> documentIds = documentRepository
                .findAllByNextReviewDueIsNotNullAndDeletedAtIsNullAndStatusIn(
                        List.of(DocumentStatus.RELEASED, DocumentStatus.APPROVED))
                .stream().map(Document::getId).toList();
        for (Integer documentId : documentIds) {
            try {
                transactionTemplate.execute(tx -> {
                    sweepDocumentReview(documentRepository.findById(documentId).orElseThrow(), today);
                    return null;
                });
            } catch (Exception e) {
                log.warn("Review sweep failed for document {}: {}",
                        documentId, e.getMessage());
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
                notifyDocument(document, null, "REVIEW_OVERDUE", recipient, today, dedupKey,
                        "Overdue review: " + document.getDocumentNumber(),
                        "The periodic review was due " + due + " and is now " + overdueDays
                                + " business day(s) overdue. Clear it by completing a review re-approval.");
            }
        } else if (overdueDays == 0 && untilDue <= reviewProperties.reminderBeforeDays()) {
            notifyDocument(document, null, "REVIEW_DUE", document.getOwner(), today, null,
                    "Review due soon: " + document.getDocumentNumber(),
                    "The periodic review is due " + due + ".");
        }
    }

    /**
     * Phase 4 — acknowledgment notifications (Phase 2d). Reminders go to
     * each non-acknowledging department member near the window close; past
     * the close, a once-per-version summary escalation goes to owner +
     * admins. Record-only: acknowledgment stays open, nothing is gated.
     */
    private void sweepAcknowledgments(LocalDate today) {
        List<Integer> documentIds = documentRepository
                .findAllByStatusAndDeletedAtIsNull(DocumentStatus.RELEASED)
                .stream().map(Document::getId).toList();
        for (Integer documentId : documentIds) {
            try {
                transactionTemplate.execute(tx -> {
                    sweepDocumentAcknowledgments(
                            documentRepository.findById(documentId).orElseThrow(), today);
                    return null;
                });
            } catch (Exception e) {
                log.warn("Acknowledgment sweep failed for document {}: {}",
                        documentId, e.getMessage());
            }
        }
    }

    private void sweepDocumentAcknowledgments(Document document, LocalDate today) {
        List<User> outstanding = acknowledgmentService.outstandingUsers(document);
        if (outstanding.isEmpty()) {
            return;
        }
        LocalDate closesAt = acknowledgmentService.windowClosesAt(document);
        if (closesAt == null) {
            return;
        }
        DocumentVersion version = document.getCurrentVersion();
        int untilClose = BusinessDays.businessDaysUntil(today, closesAt);
        int overdueDays = BusinessDays.overdueBusinessDays(closesAt, today);

        if (overdueDays == 0 && untilClose <= acknowledgmentProperties.reminderBeforeDays()) {
            for (User member : outstanding) {
                notifyDocument(document, version, "ACK_REMINDER", member, today, null,
                        "Acknowledgment due soon: " + document.getDocumentNumber(),
                        "Please read and acknowledge " + document.getDocumentNumber()
                                + " v" + version.getVersionNumber()
                                + " — the acknowledgment window closes " + closesAt + ".");
            }
        } else if (overdueDays >= acknowledgmentProperties.escalateAfterOverdueDays()) {
            String names = outstanding.stream()
                    .map(User::getName)
                    .reduce((a, b) -> a + ", " + b)
                    .orElse("");
            List<User> targets = new ArrayList<>(List.of(document.getOwner()));
            targets.addAll(userRepository.findActiveAdmins());
            for (User recipient : targets) {
                notifyDocument(document, version, "ACK_OVERDUE", recipient, today,
                        "ack-overdue:version=" + version.getId(),
                        "Overdue acknowledgments: " + document.getDocumentNumber(),
                        outstanding.size() + " department member(s) have not acknowledged v"
                                + version.getVersionNumber() + ": " + names
                                + ". The window closed " + closesAt
                                + ". Record-only — acknowledgment is still open.");
            }
        }
    }

    /**
     * Document/version-anchored notification: dedups per day when no
     * dedup_key is given, or once per cycle via the key.
     */
    private void notifyDocument(Document document, DocumentVersion version, String kind, User recipient,
                                LocalDate notificationDate, String dedupKey,
                                String subject, String body) {
        boolean alreadySent;
        if (dedupKey != null) {
            alreadySent = notificationLogRepository.existsByKindAndDedupKeyAndRecipientId(
                    kind, dedupKey, recipient.getId());
        } else if (version != null) {
            alreadySent = notificationLogRepository.existsByKindAndDocumentVersionIdAndRecipientIdAndNotificationDate(
                    kind, version.getId(), recipient.getId(), notificationDate);
        } else {
            alreadySent = notificationLogRepository.existsByKindAndDocumentIdAndRecipientIdAndNotificationDate(
                    kind, document.getId(), recipient.getId(), notificationDate);
        }
        if (alreadySent) {
            return;
        }
        notificationSender.send(recipient, subject, body);

        NotificationLog entry = new NotificationLog();
        entry.setKind(kind);
        entry.setDocument(document);
        entry.setDocumentVersion(version);
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
