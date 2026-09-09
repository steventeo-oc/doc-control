package com.doccontrol.workflow;

import com.doccontrol.audit.NotificationLog;
import com.doccontrol.audit.NotificationLogRepository;
import com.doccontrol.config.WorkflowProperties;
import com.doccontrol.document.Document;
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
 * Daily reminder/escalation sweep over pending approval tasks (Phase 2b,
 * confirmed with QA):
 *
 * - a reminder goes to the reviewer when the task is due today or tomorrow;
 * - when a task is escalateAfterOverdueDays business days overdue, the
 *   document owner and all active admins are notified (once per task);
 * - pooled (role) tasks remind all current members of the role until
 *   someone claims the task;
 * - every send is recorded in notification_log, which also drives the
 *   per-day reminder / once-per-task escalation dedup.
 *
 * Sends go through {@link NotificationSender} — the log-only stub today,
 * Microsoft Graph once the Azure app registration exists.
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

    public WorkflowNotificationJob(TaskService taskService,
                                   WorkflowInstanceRepository instanceRepository,
                                   UserRepository userRepository,
                                   NotificationLogRepository notificationLogRepository,
                                   NotificationSender notificationSender,
                                   WorkflowProperties properties) {
        this.taskService = taskService;
        this.instanceRepository = instanceRepository;
        this.userRepository = userRepository;
        this.notificationLogRepository = notificationLogRepository;
        this.notificationSender = notificationSender;
        this.properties = properties;
    }

    @Scheduled(cron = "${doccontrol.workflow.reminder-cron:0 0 7 * * *}")
    public void runScheduled() {
        run(LocalDate.now());
    }

    void run(LocalDate today) {
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
