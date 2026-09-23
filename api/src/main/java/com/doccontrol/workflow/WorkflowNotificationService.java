package com.doccontrol.workflow;

import com.doccontrol.audit.NotificationLog;
import com.doccontrol.audit.NotificationLogRepository;
import com.doccontrol.config.AppProperties;
import com.doccontrol.document.Document;
import com.doccontrol.document.DocumentVersion;
import com.doccontrol.identity.User;
import com.doccontrol.identity.UserRepository;
import com.doccontrol.notification.NotificationSender;
import com.doccontrol.notification.NotificationTemplateService;
import com.doccontrol.notification.NotificationTemplateService.BadgeStyle;
import com.doccontrol.notification.NotificationTemplateService.EmailContent;
import org.flowable.engine.TaskService;
import org.flowable.identitylink.api.IdentityLink;
import org.flowable.identitylink.api.IdentityLinkType;
import org.flowable.task.api.Task;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Encapsulates workflow lifecycle notification dispatch, HTML template generation,
 * recipient resolution, and audit logging.
 *
 * Guaranteed Best-Effort (Flag F1): All email sends are isolated in try/catch
 * blocks so an outbound transport error or mail server glitch never rolls back
 * or prevents a workflow start, approval, rejection, cancellation, or delegation.
 */
@Service
public class WorkflowNotificationService {

    private static final Logger log = LoggerFactory.getLogger(WorkflowNotificationService.class);
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    private final NotificationSender notificationSender;
    private final NotificationTemplateService templateService;
    private final NotificationLogRepository notificationLogRepository;
    private final UserRepository userRepository;
    private final AppProperties appProperties;
    private final TaskService taskService;

    public WorkflowNotificationService(NotificationSender notificationSender,
                                       NotificationTemplateService templateService,
                                       NotificationLogRepository notificationLogRepository,
                                       UserRepository userRepository,
                                       AppProperties appProperties,
                                       TaskService taskService) {
        this.notificationSender = notificationSender;
        this.templateService = templateService;
        this.notificationLogRepository = notificationLogRepository;
        this.userRepository = userRepository;
        this.appProperties = appProperties;
        this.taskService = taskService;
    }

    /**
     * Resolves assignees for a given task (direct assignee or candidate group members).
     */
    public List<User> resolveReviewers(Task task) {
        if (task.getAssignee() != null) {
            try {
                return userRepository.findById(Integer.valueOf(task.getAssignee()))
                        .filter(User::isActive)
                        .map(List::of)
                        .orElse(List.of());
            } catch (NumberFormatException e) {
                return List.of();
            }
        }
        List<String> roleNames = taskService.getIdentityLinksForTask(task.getId()).stream()
                .filter(link -> IdentityLinkType.CANDIDATE.equals(link.getType()))
                .map(IdentityLink::getGroupId)
                .toList();
        return roleNames.isEmpty() ? List.of() : userRepository.findActiveByRoleNames(roleNames);
    }

    /**
     * Fired when an approval workflow is started (or re-approval initiated).
     * Dispatches TASK_ASSIGNED notifications to all assigned reviewers.
     */
    public void notifyReviewersOfNewTask(WorkflowInstance instance, List<Task> tasks,
                                        Document document, DocumentVersion version, User startedBy) {
        boolean isReapproval = instance.getKind() == WorkflowInstanceKind.REAPPROVAL;
        String actionType = isReapproval ? "Periodic Review" : "Approval";

        for (Task task : tasks) {
            List<User> reviewers = resolveReviewers(task);
            for (User reviewer : reviewers) {
                if (notificationLogRepository.existsByKindAndFlowableTaskIdAndRecipientId(
                        "TASK_ASSIGNED", task.getId(), reviewer.getId())) {
                    continue;
                }

                String subject = "Action Required: " + actionType + " for "
                        + document.getDocumentNumber() + " Rev " + version.getVersionNumber();

                Map<String, String> details = new LinkedHashMap<>();
                details.put("Document", document.getDocumentNumber());
                details.put("Title", document.getName());
                details.put("Revision", "Rev " + version.getVersionNumber() + (isReapproval ? " (Periodic Review)" : " (Draft)"));
                if (document.getDepartment() != null) {
                    details.put("Department", document.getDepartment().getCode() + " - " + document.getDepartment().getLabel());
                }
                details.put("Submitted By", startedBy.getName() + " (" + startedBy.getEmail() + ")");
                if (task.getDueDate() != null) {
                    LocalDate dueDate = task.getDueDate().toInstant().atZone(ZoneId.systemDefault()).toLocalDate();
                    details.put("Due Date", dueDate.format(DATE_FMT));
                }

                String leadParagraph = startedBy.getName() + " has submitted " + document.getDocumentNumber()
                        + " (\"" + document.getName() + "\") Rev " + version.getVersionNumber()
                        + " for " + actionType.toLowerCase() + " and assigned you as a reviewer.";

                EmailContent content = templateService.render(
                        reviewer.getName(),
                        "Review Required",
                        BadgeStyle.BLUE,
                        "Action Required: Review Document",
                        leadParagraph,
                        details,
                        null,
                        null,
                        "Review Task in DocControl",
                        appProperties.baseUrl() + "/tasks"
                );

                sendSafe("TASK_ASSIGNED", instance, task.getId(), document, version,
                        reviewer, subject, content, LocalDate.now());
            }
        }
    }

    /**
     * Fired when all reviewers approve and the workflow completes successfully.
     * Notifies document owner and the user who started the workflow.
     */
    public void notifyOwnerAndStarterOfApproval(WorkflowInstance instance, Document document,
                                               DocumentVersion version, LocalDate effectiveDate,
                                               boolean deferred, User approvedBy) {
        Set<User> recipients = new HashSet<>();
        if (document.getOwner() != null && document.getOwner().isActive()) {
            recipients.add(document.getOwner());
        }
        if (instance.getStartedBy() != null && instance.getStartedBy().isActive()) {
            recipients.add(instance.getStartedBy());
        }

        String subject = "Approved: " + document.getDocumentNumber() + " Rev "
                + version.getVersionNumber() + " - " + document.getName();

        Map<String, String> details = new LinkedHashMap<>();
        details.put("Document", document.getDocumentNumber());
        details.put("Title", document.getName());
        details.put("Revision", "Rev " + version.getVersionNumber());
        details.put("Status", deferred ? "Approved (Effective " + effectiveDate + ")" : "Released & In Effect");
        if (document.getDepartment() != null) {
            details.put("Department", document.getDepartment().getCode());
        }

        String leadParagraph = deferred
                ? "The approval workflow for " + document.getDocumentNumber() + " Rev " + version.getVersionNumber()
                  + " is complete. All reviewers have approved the revision, and it is scheduled to become effective on "
                  + effectiveDate + "."
                : "The approval workflow for " + document.getDocumentNumber() + " Rev " + version.getVersionNumber()
                  + " is complete. All reviewers have approved, and the revision is now released and in effect.";

        for (User recipient : recipients) {
            EmailContent content = templateService.render(
                    recipient.getName(),
                    "Approved",
                    BadgeStyle.GREEN,
                    "Document Approved",
                    leadParagraph,
                    details,
                    null,
                    null,
                    "View Document in DocControl",
                    appProperties.baseUrl() + "/documents/" + document.getId()
            );

            sendSafe("APPROVAL_COMPLETED", instance, null, document, version,
                    recipient, subject, content, LocalDate.now());
        }
    }

    /**
     * Fired when a reviewer rejects a workflow task.
     * Notifies document owner and workflow submitter with reviewer comment callout.
     */
    public void notifyOwnerAndStarterOfRejection(WorkflowInstance instance, Document document,
                                                DocumentVersion version, User rejectedBy, String comment) {
        Set<User> recipients = new HashSet<>();
        if (document.getOwner() != null && document.getOwner().isActive()) {
            recipients.add(document.getOwner());
        }
        if (instance.getStartedBy() != null && instance.getStartedBy().isActive()) {
            recipients.add(instance.getStartedBy());
        }

        String subject = "Changes Requested / Rejected: " + document.getDocumentNumber()
                + " Rev " + version.getVersionNumber() + " - " + document.getName();

        Map<String, String> details = new LinkedHashMap<>();
        details.put("Document", document.getDocumentNumber());
        details.put("Title", document.getName());
        details.put("Revision", "Rev " + version.getVersionNumber());
        details.put("Rejected By", rejectedBy.getName() + " (" + rejectedBy.getEmail() + ")");
        if (document.getDepartment() != null) {
            details.put("Department", document.getDepartment().getCode());
        }

        String leadParagraph = "The approval workflow for " + document.getDocumentNumber() + " Rev "
                + version.getVersionNumber() + " was rejected by " + rejectedBy.getName()
                + ". The workflow has been stopped. Please review the feedback below to revise the draft.";

        for (User recipient : recipients) {
            EmailContent content = templateService.render(
                    recipient.getName(),
                    "Changes Requested",
                    BadgeStyle.RED,
                    "Document Review Rejected",
                    leadParagraph,
                    details,
                    "Reviewer Feedback",
                    comment != null && !comment.isBlank() ? comment : "No comment provided.",
                    "View Document in DocControl",
                    appProperties.baseUrl() + "/documents/" + document.getId()
            );

            sendSafe("APPROVAL_REJECTED", instance, null, document, version,
                    recipient, subject, content, LocalDate.now());
        }
    }

    /**
     * Fired when an active workflow is cancelled.
     * Notifies all reviewers with pending tasks that the workflow was dismissed.
     */
    public void notifyReviewersOfCancellation(WorkflowInstance instance, Document document,
                                             DocumentVersion version, User cancelledBy,
                                             List<Task> activeTasks) {
        Set<User> pendingReviewers = new HashSet<>();
        for (Task task : activeTasks) {
            pendingReviewers.addAll(resolveReviewers(task));
        }

        String subject = "Workflow Cancelled: " + document.getDocumentNumber()
                + " Rev " + version.getVersionNumber() + " - " + document.getName();

        Map<String, String> details = new LinkedHashMap<>();
        details.put("Document", document.getDocumentNumber());
        details.put("Title", document.getName());
        details.put("Revision", "Rev " + version.getVersionNumber());
        details.put("Cancelled By", cancelledBy.getName());

        String leadParagraph = "The approval review workflow for " + document.getDocumentNumber()
                + " Rev " + version.getVersionNumber() + " has been cancelled by " + cancelledBy.getName()
                + ". Your pending review task has been dismissed and no further action is required.";

        for (User reviewer : pendingReviewers) {
            EmailContent content = templateService.render(
                    reviewer.getName(),
                    "Cancelled",
                    BadgeStyle.SLATE,
                    "Approval Workflow Cancelled",
                    leadParagraph,
                    details,
                    null,
                    null,
                    "View Tasks",
                    appProperties.baseUrl() + "/tasks"
            );

            sendSafe("WORKFLOW_CANCELLED", instance, null, document, version,
                    reviewer, subject, content, LocalDate.now());
        }
    }

    /**
     * Fired when a reviewer delegates their task to another user.
     */
    public void notifyDelegation(User target, User delegator, Document document,
                                 DocumentVersion version, String message) {
        String subject = "Approval Task Delegated: " + document.getDocumentNumber()
                + " Rev " + version.getVersionNumber();

        Map<String, String> details = new LinkedHashMap<>();
        details.put("Document", document.getDocumentNumber());
        details.put("Title", document.getName());
        details.put("Revision", "Rev " + version.getVersionNumber());
        details.put("Delegated By", delegator.getName() + " (" + delegator.getEmail() + ")");
        if (document.getDepartment() != null) {
            details.put("Department", document.getDepartment().getCode());
        }

        String leadParagraph = delegator.getName() + " has delegated an approval review task to you for "
                + document.getDocumentNumber() + " (\"" + document.getName() + "\") Rev "
                + version.getVersionNumber() + ".";

        EmailContent content = templateService.render(
                target.getName(),
                "Task Delegated",
                BadgeStyle.VIOLET,
                "Approval Task Delegated to You",
                leadParagraph,
                details,
                "Instructions from " + delegator.getName(),
                message != null && !message.isBlank() ? message : null,
                "Review Task in DocControl",
                appProperties.baseUrl() + "/tasks"
        );

        sendSafe("TASK_DELEGATED", null, null, document, version,
                target, subject, content, LocalDate.now());
    }

    /**
     * Fired when a reviewer recalls a task previously delegated.
     */
    public void notifyDelegationRecalled(User formerAssignee, User delegator, Document document,
                                        DocumentVersion version) {
        String subject = "Task Delegation Recalled: " + document.getDocumentNumber()
                + " Rev " + version.getVersionNumber();

        Map<String, String> details = new LinkedHashMap<>();
        details.put("Document", document.getDocumentNumber());
        details.put("Title", document.getName());
        details.put("Revision", "Rev " + version.getVersionNumber());
        details.put("Recalled By", delegator.getName());

        String leadParagraph = delegator.getName() + " has recalled the review task for "
                + document.getDocumentNumber() + " Rev " + version.getVersionNumber()
                + " back to themselves. No further action is required from you.";

        EmailContent content = templateService.render(
                formerAssignee.getName(),
                "Delegation Recalled",
                BadgeStyle.SLATE,
                "Task Delegation Recalled",
                leadParagraph,
                details,
                null,
                null,
                "View Tasks",
                appProperties.baseUrl() + "/tasks"
        );

        sendSafe("TASK_RECALLED", null, null, document, version,
                formerAssignee, subject, content, LocalDate.now());
    }

    /**
     * Best-effort sending wrapper ensuring exceptions never bubble up to abort
     * caller transactions.
     */
    private void sendSafe(String kind, WorkflowInstance instance, String taskId,
                          Document document, DocumentVersion version, User recipient,
                          String subject, EmailContent content, LocalDate date) {
        try {
            notificationSender.sendHtml(recipient, subject, content.textBody(), content.htmlBody());

            NotificationLog entry = new NotificationLog();
            entry.setKind(kind);
            entry.setWorkflowInstance(instance);
            entry.setFlowableTaskId(taskId);
            entry.setDocument(document);
            entry.setDocumentVersion(version);
            entry.setRecipient(recipient);
            entry.setSubject(subject);
            entry.setNotificationDate(date);
            entry.setChannel(notificationSender.channel());
            notificationLogRepository.save(entry);
        } catch (Exception e) {
            log.warn("Failed to send {} notification for {} v{} to {}: {}",
                    kind,
                    document != null ? document.getDocumentNumber() : "unknown",
                    version != null ? version.getVersionNumber() : 0,
                    recipient.getEmail(),
                    e.getMessage());
        }
    }
}
