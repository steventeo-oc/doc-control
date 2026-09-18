package com.doccontrol.workflow;

import com.doccontrol.acknowledgment.AcknowledgmentService;
import com.doccontrol.audit.AuditLog;
import com.doccontrol.audit.AuditLogRepository;
import com.doccontrol.audit.AuditService;
import com.doccontrol.common.web.ConflictException;
import com.doccontrol.common.web.ForbiddenException;
import com.doccontrol.common.web.NotFoundException;
import com.doccontrol.document.Document;
import com.doccontrol.document.DocumentService;
import com.doccontrol.document.DocumentStatus;
import com.doccontrol.document.DocumentVersion;
import com.doccontrol.document.DocumentVersionRepository;
import com.doccontrol.document.DocumentVersionStatus;
import com.doccontrol.identity.DepartmentAccessService;
import com.doccontrol.identity.MembershipLevel;
import com.doccontrol.identity.Role;
import com.doccontrol.identity.RoleRepository;
import com.doccontrol.identity.User;
import com.doccontrol.identity.UserRepository;
import com.doccontrol.notification.NotificationSender;
import com.doccontrol.security.CurrentUserProvider;
import com.doccontrol.workflow.dto.DelegatedTaskDto;
import com.doccontrol.workflow.dto.StartApprovalRequest;
import com.doccontrol.workflow.dto.StartedInstanceDto;
import com.doccontrol.workflow.dto.TaskCountsDto;
import com.doccontrol.workflow.dto.WorkflowInstanceDto;
import com.doccontrol.workflow.dto.WorkflowTaskDto;
import org.flowable.engine.HistoryService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.TaskService;
import org.flowable.engine.runtime.ProcessInstance;
import org.flowable.identitylink.api.IdentityLink;
import org.flowable.identitylink.api.IdentityLinkType;
import org.flowable.task.api.Task;
import org.flowable.task.api.history.HistoricTaskInstance;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class WorkflowService {

    private static final String PROCESS_KEY = "documentApproval";

    private final RuntimeService runtimeService;
    private final TaskService taskService;
    private final HistoryService historyService;
    private final WorkflowInstanceRepository instanceRepository;
    private final DocumentVersionRepository documentVersionRepository;
    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final DocumentService documentService;
    private final AuditService auditService;
    private final AuditLogRepository auditLogRepository;
    private final CurrentUserProvider currentUserProvider;
    private final DepartmentAccessService departmentAccessService;
    private final NotificationSender notificationSender;
    private final AcknowledgmentService acknowledgmentService;

    public WorkflowService(RuntimeService runtimeService, TaskService taskService,
                           HistoryService historyService,
                           WorkflowInstanceRepository instanceRepository,
                           DocumentVersionRepository documentVersionRepository,
                           UserRepository userRepository, RoleRepository roleRepository,
                           DocumentService documentService, AuditService auditService,
                           AuditLogRepository auditLogRepository,
                           CurrentUserProvider currentUserProvider,
                           DepartmentAccessService departmentAccessService,
                           NotificationSender notificationSender,
                           AcknowledgmentService acknowledgmentService) {
        this.runtimeService = runtimeService;
        this.taskService = taskService;
        this.historyService = historyService;
        this.instanceRepository = instanceRepository;
        this.documentVersionRepository = documentVersionRepository;
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.documentService = documentService;
        this.auditService = auditService;
        this.auditLogRepository = auditLogRepository;
        this.currentUserProvider = currentUserProvider;
        this.departmentAccessService = departmentAccessService;
        this.notificationSender = notificationSender;
        this.acknowledgmentService = acknowledgmentService;
    }

    @Transactional
    public WorkflowInstanceDto start(Integer documentId, Integer versionId, StartApprovalRequest request) {
        DocumentVersion version = documentVersionRepository.findById(versionId)
                .orElseThrow(() -> new NotFoundException("Version " + versionId + " not found."));
        if (!version.getDocument().getId().equals(documentId)) {
            throw new NotFoundException("Version " + versionId + " not found.");
        }
        Document document = documentService.requireVisible(documentId);
        documentService.requireCanEdit(document);

        if (version.getStatus() != DocumentVersionStatus.DRAFT) {
            throw new ConflictException("Only draft versions can be sent for approval.");
        }
        requireNoApprovalInFlight(document);

        AssigneeSlots slots = resolveSlots(document, request);

        WorkflowInstance instance = new WorkflowInstance();
        instance.setDocumentVersion(version);
        instance.setKind(WorkflowInstanceKind.APPROVAL);
        instance.setStatus(WorkflowInstanceStatus.IN_PROGRESS);
        instance.setStartedBy(currentUserProvider.getCurrentUser());
        instanceRepository.save(instance);

        ProcessInstance processInstance = runtimeService.startProcessInstanceByKey(PROCESS_KEY, Map.of(
                "assigneeSlots", slots.names(),
                "workflowInstanceId", instance.getId()));
        instance.setProcessInstanceId(processInstance.getId());
        instanceRepository.save(instance);

        auditService.record("workflow_instance", instance.getId(), "created", Map.of(
                "document_number", document.getDocumentNumber(),
                "version_number", version.getVersionNumber(),
                "assignees", slots.descriptions()), document.getDepartment());

        return toDto(instance);
    }

    /**
     * Periodic-review re-approval (Phase 2c): re-certifies the currently
     * released version through the same single-stage parallel process. No
     * content changes, so completion never moves the version pointer — it
     * resets the review clock. Reviewers see the difference via the task
     * name and the {@code reapproval} flag.
     */
    @Transactional
    public WorkflowInstanceDto startReviewApproval(Integer documentId, StartApprovalRequest request) {
        Document document = documentService.requireVisible(documentId);
        documentService.requireCanEdit(document);

        if (document.getStatus() != DocumentStatus.RELEASED) {
            throw new ConflictException(
                    "Only released documents can be re-approved for periodic review.");
        }
        DocumentVersion version = document.getCurrentVersion();
        if (version == null) {
            throw new ConflictException("The document has no current version to re-approve.");
        }
        requireNoApprovalInFlight(document);

        AssigneeSlots slots = resolveSlots(document, request);

        WorkflowInstance instance = new WorkflowInstance();
        instance.setDocumentVersion(version);
        instance.setKind(WorkflowInstanceKind.REAPPROVAL);
        instance.setStatus(WorkflowInstanceStatus.IN_PROGRESS);
        instance.setStartedBy(currentUserProvider.getCurrentUser());
        instanceRepository.save(instance);

        ProcessInstance processInstance = runtimeService.startProcessInstanceByKey(PROCESS_KEY, Map.of(
                "assigneeSlots", slots.names(),
                "workflowInstanceId", instance.getId(),
                "reapproval", true));
        instance.setProcessInstanceId(processInstance.getId());
        instanceRepository.save(instance);

        auditService.record("workflow_instance", instance.getId(), "created", Map.of(
                "document_number", document.getDocumentNumber(),
                "version_number", version.getVersionNumber(),
                "kind", WorkflowInstanceKind.REAPPROVAL.getValue(),
                "assignees", slots.descriptions()), document.getDepartment());

        return toDto(instance);
    }

    /**
     * At most one approval in flight per DOCUMENT (plan-back flag F6): a
     * draft-version approval and a re-approval must not race on pointer and
     * status at completion.
     */
    public void requireNoApprovalInFlight(Document document) {
        if (!instanceRepository.findInProgressByDocumentId(document.getId()).isEmpty()) {
            throw new ConflictException("An approval is already in progress for this document.");
        }
    }

    /**
     * Reviewer picklist for the approval-start forms: active users, excluding
     * consumers in the document's department (who cannot be reviewers).
     */
    @Transactional(readOnly = true)
    public List<com.doccontrol.workflow.dto.ReviewerCandidateDto> reviewerCandidates(Integer documentId) {
        Document document = documentService.requireVisible(documentId);
        documentService.requireCanEdit(document);
        Integer deptId = document.getDepartment().getId();
        return userRepository.findAllByActiveTrueOrderByNameAsc().stream()
                .filter(u -> {
                    // System admins are always eligible reviewers
                    if (u.getRoles().stream().anyMatch(ur -> "ADMIN".equalsIgnoreCase(ur.getRole().getName()))) {
                        return true;
                    }
                    // Must be a member of this document's department and NOT a CONSUMER
                    var levelOpt = departmentAccessService.levelOf(u.getId(), deptId);
                    return levelOpt.isPresent() && levelOpt.get() != com.doccontrol.identity.MembershipLevel.CONSUMER;
                })
                .map(com.doccontrol.workflow.dto.ReviewerCandidateDto::from)
                .toList();
    }

    /** Role picklist for role-based approval assignments — returns departmental leadership levels. */
    @Transactional(readOnly = true)
    public List<String> reviewerRoles(Integer documentId) {
        Document document = documentService.requireVisible(documentId);
        documentService.requireCanEdit(document);
        return List.of("MANAGER", "COLLABORATOR");
    }

    /** Returns details of the currently in-progress approval workflow on this document, if any. */
    @Transactional(readOnly = true)
    public java.util.Optional<StartedInstanceDto> activeWorkflowForDocument(Integer documentId) {
        Document document = documentService.requireVisible(documentId);
        List<WorkflowInstance> inProgress = instanceRepository.findInProgressByDocumentId(document.getId());
        if (inProgress.isEmpty()) {
            return java.util.Optional.empty();
        }
        return java.util.Optional.of(toStartedDto(inProgress.get(0)));
    }

    /** Cancels an active in-flight approval workflow on this document. */
    @Transactional
    public void cancelWorkflow(Integer documentId) {
        Document document = documentService.requireVisible(documentId);
        documentService.requireCanEdit(document);

        List<WorkflowInstance> inProgress = instanceRepository.findInProgressByDocumentId(document.getId());
        if (inProgress.isEmpty()) {
            throw new ConflictException("No approval workflow is currently in progress for this document.");
        }
        WorkflowInstance instance = inProgress.get(0);

        if (instance.getProcessInstanceId() != null) {
            runtimeService.deleteProcessInstance(instance.getProcessInstanceId(),
                    "Cancelled by " + currentUserProvider.getCurrentUser().getEmail());
        }

        instance.setStatus(WorkflowInstanceStatus.REJECTED);
        instance.setCompletedAt(LocalDateTime.now());
        instanceRepository.save(instance);

        auditService.record("workflow_instance", instance.getId(), "cancelled", Map.of(
                "document_number", document.getDocumentNumber(),
                "version_number", instance.getDocumentVersion().getVersionNumber(),
                "cancelled_by", currentUserProvider.getCurrentUserId(),
                "cancelled_by_name", currentUserProvider.getCurrentUser().getName(),
                "kind", instance.getKind().getValue()), document.getDepartment());
    }

    /** Returns feedback (rejection or cancellation) for the latest workflow run on this document, if any. */
    @Transactional(readOnly = true)
    public java.util.Optional<com.doccontrol.workflow.dto.WorkflowFeedbackDto> latestFeedback(Integer documentId) {
        Document document = documentService.requireVisible(documentId);
        List<WorkflowInstance> list = instanceRepository.findAllByDocumentIdOrderByIdDesc(document.getId());
        if (list.isEmpty()) {
            return java.util.Optional.empty();
        }
        WorkflowInstance latest = list.get(0);
        if (latest.getStatus() != WorkflowInstanceStatus.REJECTED) {
            return java.util.Optional.empty();
        }
        java.util.Optional<AuditLog> auditOpt = auditLogRepository.findLatestRejectionOrCancellation(latest.getId());
        if (auditOpt.isEmpty()) {
            return java.util.Optional.empty();
        }
        AuditLog audit = auditOpt.get();
        Map<String, Object> details = audit.getDetails();
        String action = audit.getAction();
        String actorName = details != null && details.containsKey("cancelled_by_name")
                ? String.valueOf(details.get("cancelled_by_name"))
                : details != null && details.containsKey("rejected_by_name")
                ? String.valueOf(details.get("rejected_by_name"))
                : audit.getPerformedBy() != null ? audit.getPerformedBy().getName() : "Reviewer";
        String comment = details != null && details.containsKey("comment")
                ? String.valueOf(details.get("comment"))
                : "";
        return java.util.Optional.of(new com.doccontrol.workflow.dto.WorkflowFeedbackDto(
                latest.getId(),
                latest.getDocumentVersion().getVersionNumber(),
                action,
                actorName,
                comment,
                audit.getPerformedAt()
        ));
    }

    /**
     * Validates and expands the assignee inputs. Named assignees whose
     * membership level in the document's department is CONSUMER are
     * rejected — a Consumer holds no approval rights, so being assigned to
     * approve would contradict the level (plan-back F3b). Non-members and
     * ROLE slots are outside the level system and stay assignable.
     */
    private AssigneeSlots resolveSlots(Document document, StartApprovalRequest request) {
        List<String> names = new ArrayList<>();
        List<String> descriptions = new ArrayList<>();
        for (StartApprovalRequest.AssigneeInput assignee : request.assignees()) {
            switch (assignee.type().toUpperCase()) {
                case "USER" -> {
                    User user = userRepository.findById(assignee.userId())
                            .filter(User::isActive)
                            .orElseThrow(() -> new NotFoundException(
                                    "Reviewer user " + assignee.userId() + " not found."));
                    MembershipLevel assigneeLevel = departmentAccessService
                            .levelOf(user.getId(), document.getDepartment().getId())
                            .orElse(MembershipLevel.MANAGER); // non-members: outside the level system
                    if (assigneeLevel == MembershipLevel.CONSUMER) {
                        throw new ConflictException("User '" + user.getEmail()
                                + "' is a Consumer in department '"
                                + document.getDepartment().getCode()
                                + "' and cannot be assigned as a reviewer.");
                    }
                    names.add(SlotAssignmentListener.USER_PREFIX + user.getId());
                    descriptions.add(user.getEmail());
                }
                case "ROLE" -> {
                    Role role = roleRepository.findByName(assignee.roleName())
                            .orElseThrow(() -> new NotFoundException(
                                    "Role '" + assignee.roleName() + "' not found."));
                    names.add(SlotAssignmentListener.ROLE_PREFIX + role.getName());
                    descriptions.add("role:" + role.getName());
                }
                default -> throw new ConflictException(
                        "Assignee type must be USER or ROLE, got: " + assignee.type());
            }
        }
        return new AssigneeSlots(List.copyOf(names), List.copyOf(descriptions));
    }

    private record AssigneeSlots(List<String> names, List<String> descriptions) {
    }

    /**
     * Reviewer action: approve or reject. Rejection ends the whole approval.
     * An approver may attach a future {@code requestedEffectiveDate} (Phase
     * 2c) — only the completion that ends the process uses it; absent or
     * same-day means immediate, exactly the pre-2c behavior.
     */
    @Transactional
    public WorkflowInstanceDto complete(String taskId, boolean approved, String comment,
                                        LocalDate requestedEffectiveDate) {
        if (approved && requestedEffectiveDate != null
                && requestedEffectiveDate.isBefore(LocalDate.now())) {
            throw new ConflictException("The effective date cannot be in the past.");
        }
        Task task = requireTask(taskId);
        WorkflowInstance instance = requireInstance(task.getProcessInstanceId());
        Document document = documentService.requireVisible(instance.getDocumentVersion().getDocument().getId());
        requireTaskAccess(task, document);
        User actor = currentUserProvider.getCurrentUser();

        if (task.getAssignee() == null) {
            taskService.setAssignee(taskId, String.valueOf(currentUserProvider.getCurrentUserId()));
        }
        if (comment != null && !comment.isBlank()) {
            taskService.addComment(taskId, task.getProcessInstanceId(), comment);
        }

        if (approved) {
            taskService.complete(taskId);

            Map<String, Object> taskDetails = new java.util.HashMap<>();
            taskDetails.put("task_id", taskId);
            taskDetails.put("document_id", document.getId());
            taskDetails.put("document_number", document.getDocumentNumber());
            taskDetails.put("version_number", instance.getDocumentVersion().getVersionNumber());
            if (comment != null && !comment.isBlank()) {
                taskDetails.put("comment", comment.trim());
            }
            if (requestedEffectiveDate != null) {
                taskDetails.put("effective_date", requestedEffectiveDate.toString());
            }
            auditService.record("workflow_instance", instance.getId(), "task_approved", taskDetails, document.getDepartment());

            boolean processEnded = runtimeService.createProcessInstanceQuery()
                    .processInstanceId(instance.getProcessInstanceId())
                    .count() == 0;
            if (processEnded) {
                // every slot approved: apply the outcome and close the instance.
                // Immediate = promote (pointer, statuses, release, audit) exactly
                // as before Phase 2c; deferred = approved-but-not-yet-effective;
                // a re-approval never moves the pointer, it re-certifies.
                LocalDate today = LocalDate.now();
                boolean deferred = requestedEffectiveDate != null && requestedEffectiveDate.isAfter(today);
                if (instance.getKind() == WorkflowInstanceKind.REAPPROVAL) {
                    if (deferred) {
                        documentService.schedulePendingReviewReset(document, requestedEffectiveDate, actor);
                    } else {
                        documentService.resetReviewClock(document, today, actor);
                    }
                } else if (deferred) {
                    documentService.approveVersionPendingEffectivity(
                            instance.getDocumentVersion(), requestedEffectiveDate, actor);
                } else {
                    documentService.promoteVersion(instance.getDocumentVersion(), today, actor);
                    // Phase 2e change notice — immediate new-version approvals
                    // only; re-approvals and deferred outcomes never notify
                    // (plan-back flag F2). Best-effort, never throws (F1).
                    documentService.notifyDepartmentOfChange(
                            document, instance.getDocumentVersion(), today);
                }
                instance.setStatus(WorkflowInstanceStatus.COMPLETED);
                instance.setCompletedAt(LocalDateTime.now());
                auditService.record("workflow_instance", instance.getId(), "completed", Map.of(
                        "document_id", document.getId(),
                        "document_number", document.getDocumentNumber(),
                        "version_number", instance.getDocumentVersion().getVersionNumber(),
                        "approved_by", currentUserProvider.getCurrentUserId(),
                        "kind", instance.getKind().getValue(),
                        "effective_at", deferred
                                ? requestedEffectiveDate.toString()
                                : today.toString()), document.getDepartment());
            }
        } else {
            // 100% required: a single rejection rejects the whole approval.
            // A rejected re-approval leaves the document released (its content
            // is unchanged and already in effect) — it simply stays
            // review-overdue (plan-back flag F8).
            runtimeService.deleteProcessInstance(instance.getProcessInstanceId(),
                    "Rejected by reviewer " + currentUserProvider.getCurrentUser().getEmail());
            instance.setStatus(WorkflowInstanceStatus.REJECTED);
            instance.setCompletedAt(LocalDateTime.now());
            auditService.record("workflow_instance", instance.getId(), "rejected", Map.of(
                    "document_number", document.getDocumentNumber(),
                    "version_number", instance.getDocumentVersion().getVersionNumber(),
                    "rejected_by", currentUserProvider.getCurrentUserId(),
                    "rejected_by_name", currentUserProvider.getCurrentUser().getName(),
                    "comment", comment == null ? "" : comment,
                    "kind", instance.getKind().getValue()), document.getDepartment());
        }
        return toDto(instance);
    }

    /** Unrestricted delegation (confirmed with QA): reviewer sends the task to anyone, with optional instructions. */
    @Transactional
    public WorkflowInstanceDto delegate(String taskId, Integer toUserId, String message) {
        Task task = requireTask(taskId);
        WorkflowInstance instance = requireInstance(task.getProcessInstanceId());
        Document document = documentService.requireVisible(instance.getDocumentVersion().getDocument().getId());
        requireTaskAccess(task, document);

        User me = currentUserProvider.getCurrentUser();
        User target = userRepository.findById(toUserId)
                .filter(User::isActive)
                .orElseThrow(() -> new NotFoundException("User " + toUserId + " not found."));

        String previousAssignee = task.getAssignee();
        taskService.setOwner(taskId, String.valueOf(me.getId()));
        taskService.setAssignee(taskId, String.valueOf(target.getId()));
        taskService.setVariableLocal(taskId, "delegatedByUserId", me.getId());
        taskService.setVariableLocal(taskId, "delegatedByName", me.getName());
        taskService.setVariableLocal(taskId, "delegatedToUserId", target.getId());
        taskService.setVariableLocal(taskId, "delegatedToUserName", target.getName());
        if (message != null && !message.isBlank()) {
            taskService.setVariableLocal(taskId, "delegationMessage", message.trim());
        }
        taskService.setVariableLocal(taskId, "delegatedAt", java.time.Instant.now().toString());

        Map<String, Object> details = new java.util.HashMap<>();
        details.put("task_id", taskId);
        details.put("from", previousAssignee == null ? "unclaimed" : previousAssignee);
        details.put("from_name", me.getName());
        details.put("from_email", me.getEmail());
        details.put("to", target.getId());
        details.put("to_name", target.getName());
        details.put("to_email", target.getEmail());
        if (message != null && !message.isBlank()) {
            details.put("message", message.trim());
        }
        details.put("document_id", document.getId());
        details.put("document_number", document.getDocumentNumber());
        details.put("version_number", instance.getDocumentVersion().getVersionNumber());
        auditService.record("workflow_instance", instance.getId(), "task_delegated", details, document.getDepartment());

        // Notify the delegatee
        String docNum = document.getDocumentNumber();
        Integer vNum = instance.getDocumentVersion().getVersionNumber();
        String docTitle = document.getName();
        String subject = "Approval Task Delegated: " + docNum + " v" + vNum;
        StringBuilder body = new StringBuilder();
        body.append(me.getName())
                .append(" has delegated an approval review task to you for ")
                .append(docNum).append(" (\"").append(docTitle).append("\") v").append(vNum).append(".\n");
        if (message != null && !message.isBlank()) {
            body.append("\nInstructions from ").append(me.getName()).append(":\n\"")
                    .append(message.trim()).append("\"\n");
        }
        body.append("\nPlease log in to review and take action.");
        notificationSender.send(target, subject, body.toString());

        return toDto(instance);
    }

    @Transactional
    public WorkflowInstanceDto delegate(String taskId, Integer toUserId) {
        return delegate(taskId, toUserId, null);
    }

    /** Reclaim a delegated task back to the original reviewer. */
    @Transactional
    public WorkflowInstanceDto recall(String taskId) {
        Task task = requireTask(taskId);
        WorkflowInstance instance = requireInstance(task.getProcessInstanceId());
        Document document = documentService.requireVisible(instance.getDocumentVersion().getDocument().getId());
        User me = currentUserProvider.getCurrentUser();

        String owner = task.getOwner();
        if (owner == null || !owner.equals(String.valueOf(me.getId()))) {
            throw new ForbiddenException("You can only recall tasks that you delegated.");
        }

        String currentAssigneeId = task.getAssignee();
        User formerAssignee = null;
        if (currentAssigneeId != null) {
            try {
                formerAssignee = userRepository.findById(Integer.valueOf(currentAssigneeId)).orElse(null);
            } catch (NumberFormatException ignored) {}
        }

        taskService.setAssignee(taskId, String.valueOf(me.getId()));
        taskService.setOwner(taskId, null);
        taskService.removeVariableLocal(taskId, "delegatedByUserId");
        taskService.removeVariableLocal(taskId, "delegatedByName");
        taskService.removeVariableLocal(taskId, "delegationMessage");
        taskService.setVariableLocal(taskId, "delegationRecalledAt", java.time.Instant.now().toString());

        Map<String, Object> details = new java.util.HashMap<>();
        details.put("task_id", taskId);
        details.put("recalled_by", me.getId());
        details.put("recalled_by_name", me.getName());
        details.put("recalled_by_email", me.getEmail());
        if (formerAssignee != null) {
            details.put("recalled_from", formerAssignee.getId());
            details.put("recalled_from_name", formerAssignee.getName());
            details.put("recalled_from_email", formerAssignee.getEmail());
        }
        details.put("document_id", document.getId());
        details.put("document_number", document.getDocumentNumber());
        details.put("version_number", instance.getDocumentVersion().getVersionNumber());
        auditService.record("workflow_instance", instance.getId(), "task_delegation_recalled", details, document.getDepartment());

        if (formerAssignee != null) {
            String docNum = document.getDocumentNumber();
            Integer vNum = instance.getDocumentVersion().getVersionNumber();
            notificationSender.send(formerAssignee,
                    "Task Delegation Recalled: " + docNum + " v" + vNum,
                    me.getName() + " has recalled the review task for " + docNum + " v" + vNum + " back to themselves.");
        }

        return toDto(instance);
    }

    /** Tasks delegated by me to other users (active and completed). */
    @Transactional(readOnly = true)
    public List<DelegatedTaskDto> myDelegatedTasks() {
        User me = currentUserProvider.getCurrentUser();
        String myId = String.valueOf(me.getId());

        List<Task> activeTasks = taskService.createTaskQuery()
                .taskOwner(myId)
                .active()
                .list();

        List<HistoricTaskInstance> historicTasks = historyService.createHistoricTaskInstanceQuery()
                .taskOwner(myId)
                .finished()
                .orderByHistoricTaskInstanceEndTime().desc()
                .listPage(0, 50);

        List<DelegatedTaskDto> dtos = new ArrayList<>();
        Set<String> procIds = new HashSet<>();
        activeTasks.forEach(t -> { if (t.getProcessInstanceId() != null) procIds.add(t.getProcessInstanceId()); });
        historicTasks.forEach(t -> { if (t.getProcessInstanceId() != null) procIds.add(t.getProcessInstanceId()); });

        Map<String, WorkflowInstance> instanceMap = procIds.isEmpty() ? Map.of()
                : instanceRepository.findByProcessInstanceIdIn(procIds).stream()
                .collect(Collectors.toMap(WorkflowInstance::getProcessInstanceId, i -> i, (a, b) -> a));

        Set<Integer> targetUserIds = new HashSet<>();
        activeTasks.forEach(t -> {
            if (t.getAssignee() != null) {
                try { targetUserIds.add(Integer.valueOf(t.getAssignee())); } catch (Exception ignored) {}
            }
        });
        historicTasks.forEach(t -> {
            if (t.getAssignee() != null) {
                try { targetUserIds.add(Integer.valueOf(t.getAssignee())); } catch (Exception ignored) {}
            }
        });

        Map<Integer, User> userMap = targetUserIds.isEmpty() ? Map.of()
                : userRepository.findAllById(targetUserIds).stream()
                .collect(Collectors.toMap(User::getId, u -> u));

        for (Task task : activeTasks) {
            WorkflowInstance inst = instanceMap.get(task.getProcessInstanceId());
            Document doc = inst != null ? inst.getDocumentVersion().getDocument() : null;
            Integer targetId = null;
            if (task.getAssignee() != null) {
                try { targetId = Integer.valueOf(task.getAssignee()); } catch (Exception ignored) {}
            }
            User targetUser = targetId != null ? userMap.get(targetId) : null;
            Map<String, Object> localVars = taskService.getVariablesLocal(task.getId());
            String message = (String) localVars.get("delegationMessage");
            String delegatedAtStr = (String) localVars.get("delegatedAt");
            LocalDateTime delegatedAt = null;
            if (delegatedAtStr != null) {
                try {
                    delegatedAt = LocalDateTime.ofInstant(java.time.Instant.parse(delegatedAtStr), java.time.ZoneId.systemDefault());
                } catch (Exception ignored) {}
            }
            LocalDateTime dueDate = task.getDueDate() == null ? null
                    : LocalDateTime.ofInstant(task.getDueDate().toInstant(), java.time.ZoneId.systemDefault());

            dtos.add(new DelegatedTaskDto(
                    task.getId(),
                    doc != null ? doc.getId() : null,
                    doc != null ? doc.getDocumentNumber() : null,
                    doc != null ? doc.getName() : null,
                    inst != null ? inst.getDocumentVersion().getVersionNumber() : null,
                    targetId,
                    targetUser != null ? targetUser.getName() : (targetId != null ? "User #" + targetId : "Unassigned"),
                    targetUser != null ? targetUser.getEmail() : null,
                    message,
                    delegatedAt,
                    dueDate,
                    "pending",
                    true
            ));
        }

        Set<String> activeIds = activeTasks.stream().map(Task::getId).collect(Collectors.toSet());
        for (HistoricTaskInstance hTask : historicTasks) {
            if (activeIds.contains(hTask.getId())) continue;
            WorkflowInstance inst = instanceMap.get(hTask.getProcessInstanceId());
            Document doc = inst != null ? inst.getDocumentVersion().getDocument() : null;
            Integer targetId = null;
            if (hTask.getAssignee() != null) {
                try { targetId = Integer.valueOf(hTask.getAssignee()); } catch (Exception ignored) {}
            }
            User targetUser = targetId != null ? userMap.get(targetId) : null;

            LocalDateTime completedAt = hTask.getEndTime() == null ? null
                    : LocalDateTime.ofInstant(hTask.getEndTime().toInstant(), java.time.ZoneId.systemDefault());
            LocalDateTime dueDate = hTask.getDueDate() == null ? null
                    : LocalDateTime.ofInstant(hTask.getDueDate().toInstant(), java.time.ZoneId.systemDefault());

            dtos.add(new DelegatedTaskDto(
                    hTask.getId(),
                    doc != null ? doc.getId() : null,
                    doc != null ? doc.getDocumentNumber() : null,
                    doc != null ? doc.getName() : null,
                    inst != null ? inst.getDocumentVersion().getVersionNumber() : null,
                    targetId,
                    targetUser != null ? targetUser.getName() : (targetId != null ? "User #" + targetId : "Unassigned"),
                    targetUser != null ? targetUser.getEmail() : null,
                    null,
                    completedAt,
                    dueDate,
                    "completed",
                    false
            ));
        }

        return dtos;
    }

    /** Live counts for task views. */
    @Transactional(readOnly = true)
    public TaskCountsDto myTaskCounts() {
        User me = currentUserProvider.getCurrentUser();
        int approvals = myTasks().size();
        int acks = acknowledgmentService.pendingForCurrentUser().size();
        int started = (int) instanceRepository.findByStartedByIdOrderByStartedAtDesc(me.getId()).stream()
                .filter(i -> i.getStatus() == WorkflowInstanceStatus.IN_PROGRESS)
                .count();
        int delegated = (int) taskService.createTaskQuery()
                .taskOwner(String.valueOf(me.getId()))
                .active()
                .count();
        return new TaskCountsDto(approvals, acks, started, delegated);
    }

    /** Tasks assigned to me or pooled to a role I hold, pending only. */
    @Transactional(readOnly = true)
    public List<WorkflowTaskDto> myTasks() {
        User me = currentUserProvider.getCurrentUser();
        List<String> myRoleNames = roleNames(me);
        String myId = String.valueOf(me.getId());

        // Deduplicate tasks by task ID
        Map<String, Task> taskMap = new LinkedHashMap<>();
        for (Task task : taskService.createTaskQuery().taskAssignee(myId).active().list()) {
            taskMap.put(task.getId(), task);
        }
        if (!myRoleNames.isEmpty()) {
            for (Task task : taskService.createTaskQuery().taskCandidateGroupIn(myRoleNames).active().list()) {
                taskMap.putIfAbsent(task.getId(), task);
            }
        }
        if (taskMap.isEmpty()) {
            return List.of();
        }

        List<Task> tasks = taskMap.values().stream()
                .sorted(Comparator.comparing(Task::getDueDate,
                        Comparator.nullsLast(Comparator.naturalOrder())))
                .toList();

        // Batch-fetch WorkflowInstances to eliminate N+1 queries
        Set<String> procIds = tasks.stream()
                .map(Task::getProcessInstanceId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<String, WorkflowInstance> instanceByProcId = procIds.isEmpty() ? Map.of()
                : instanceRepository.findByProcessInstanceIdIn(procIds).stream()
                        .collect(Collectors.toMap(
                                WorkflowInstance::getProcessInstanceId,
                                wi -> wi,
                                (a, b) -> a));

        // Batch-fetch user assignees to eliminate N+1 queries
        Set<Integer> assigneeIds = tasks.stream()
                .map(Task::getAssignee)
                .filter(Objects::nonNull)
                .map(idStr -> {
                    try { return Integer.parseInt(idStr); } catch (Exception e) { return null; }
                })
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<String, String> userNameById = assigneeIds.isEmpty() ? Map.of()
                : userRepository.findAllById(assigneeIds).stream()
                        .collect(Collectors.toMap(u -> String.valueOf(u.getId()), User::getName));

        return tasks.stream()
                .map(task -> toTaskDto(
                        task,
                        me,
                        task.getProcessInstanceId() == null ? null : instanceByProcId.get(task.getProcessInstanceId()),
                        task.getAssignee() == null ? null : userNameById.get(task.getAssignee())))
                .toList();
    }

    @Transactional(readOnly = true)
    public WorkflowInstanceDto get(Integer instanceId) {
        WorkflowInstance instance = instanceRepository.findById(instanceId)
                .orElseThrow(() -> new NotFoundException("Workflow instance " + instanceId + " not found."));
        documentService.requireVisible(instance.getDocumentVersion().getDocument().getId());
        return toDto(instance);
    }

    @Transactional(readOnly = true)
    public List<WorkflowTaskDto> instanceTasks(Integer instanceId) {
        WorkflowInstance instance = instanceRepository.findById(instanceId)
                .orElseThrow(() -> new NotFoundException("Workflow instance " + instanceId + " not found."));
        documentService.requireVisible(instance.getDocumentVersion().getDocument().getId());
        return taskService.createTaskQuery()
                .processInstanceId(instance.getProcessInstanceId())
                .active()
                .list()
                .stream()
                .map(task -> toTaskDto(task, currentUserProvider.getCurrentUser()))
                .toList();
    }

    /**
     * Approvals the caller started (the "Started by Me" pane, plan-back
     * approved 2026-09-14): newest first, with the per-reviewer
     * approved/pending breakdown for in-progress instances. The starter
     * always passes document visibility (canEdit holders are department
     * members, who see department drafts), so no additional gate.
     */
    @Transactional(readOnly = true)
    public List<StartedInstanceDto> startedByMe() {
        User viewer = currentUserProvider.getCurrentUser();
        return instanceRepository.findByStartedByIdOrderByStartedAtDesc(viewer.getId())
                .stream()
                .map(this::toStartedDto)
                .toList();
    }

    private StartedInstanceDto toStartedDto(WorkflowInstance instance) {
        Document document = instance.getDocumentVersion().getDocument();
        String feedbackAction = null;
        String feedbackActor = null;
        String feedbackComment = null;
        if (instance.getStatus() == WorkflowInstanceStatus.REJECTED) {
            var auditOpt = auditLogRepository.findLatestRejectionOrCancellation(instance.getId());
            if (auditOpt.isPresent()) {
                var audit = auditOpt.get();
                var details = audit.getDetails();
                feedbackAction = audit.getAction();
                feedbackActor = details != null && details.containsKey("cancelled_by_name")
                        ? String.valueOf(details.get("cancelled_by_name"))
                        : details != null && details.containsKey("rejected_by_name")
                        ? String.valueOf(details.get("rejected_by_name"))
                        : audit.getPerformedBy() != null ? audit.getPerformedBy().getName() : "Reviewer";
                feedbackComment = details != null && details.containsKey("comment")
                        ? String.valueOf(details.get("comment"))
                        : "";
            }
        }
        return new StartedInstanceDto(
                instance.getId(),
                document.getId(),
                document.getDocumentNumber(),
                document.getName(),
                instance.getDocumentVersion().getVersionNumber(),
                instance.getStatus() == null ? null : instance.getStatus().getValue(),
                instance.getKind() == WorkflowInstanceKind.REAPPROVAL,
                instance.getStartedAt(),
                instance.getCompletedAt(),
                instance.getStatus() == WorkflowInstanceStatus.IN_PROGRESS
                        && instance.getProcessInstanceId() != null
                        ? reviewerStates(instance.getProcessInstanceId())
                        : List.of(),
                feedbackAction,
                feedbackActor,
                feedbackComment);
    }

    /**
     * Approved reviewers: WHICH tasks finished comes from the engine's
     * history, but the approver comes from our own audit trail — every
     * task approval writes a task_approved row whose performed_by is the
     * approver, and the engine's task history does not reliably persist
     * task assignees (the start-time assignment happens in a task listener
     * that bypasses the assignee-change history recording). Pending
     * reviewers come from the active tasks: a claimed task names its
     * assignee, a pooled task names the candidate role, since nobody has
     * committed until someone claims (plan-back F5).
     */
    private List<StartedInstanceDto.ReviewerState> reviewerStates(String processInstanceId) {
        List<HistoricTaskInstance> finished = historyService.createHistoricTaskInstanceQuery()
                .processInstanceId(processInstanceId)
                .finished()
                .orderByHistoricTaskInstanceEndTime().asc()
                .list();
        List<Task> activeTasks = taskService.createTaskQuery()
                .processInstanceId(processInstanceId)
                .active()
                .list();

        List<String> finishedTaskIds = finished.stream().map(HistoricTaskInstance::getId).toList();
        List<String> allTaskIds = new ArrayList<>(finishedTaskIds);
        activeTasks.forEach(t -> allTaskIds.add(t.getId()));

        Map<String, AuditLog> approverLogByTaskId = finishedTaskIds.isEmpty() ? Map.of()
                : auditLogRepository.findTaskApprovedByTaskIds(finishedTaskIds).stream()
                        .collect(Collectors.toMap(
                                row -> String.valueOf(row.getDetails().get("task_id")),
                                row -> row,
                                (first, second) -> first));

        Map<String, AuditLog> delegationLogByTaskId = allTaskIds.isEmpty() ? Map.of()
                : auditLogRepository.findTaskDelegationsByTaskIds(allTaskIds).stream()
                        .collect(Collectors.toMap(
                                row -> String.valueOf(row.getDetails().get("task_id")),
                                row -> row,
                                (first, second) -> second));

        List<StartedInstanceDto.ReviewerState> states = new ArrayList<>();
        for (HistoricTaskInstance finishedTask : finished) {
            AuditLog audit = approverLogByTaskId.get(finishedTask.getId());
            User approver = audit != null ? audit.getPerformedBy() : null;
            Integer userId = approver != null ? approver.getId() : null;
            String name = approver != null ? approver.getName() : null;
            String email = approver != null ? approver.getEmail() : null;
            LocalDateTime actionAt = audit != null ? audit.getPerformedAt()
                    : finishedTask.getEndTime() != null
                            ? LocalDateTime.ofInstant(finishedTask.getEndTime().toInstant(), java.time.ZoneId.systemDefault())
                            : null;
            String comment = (audit != null && audit.getDetails() != null && audit.getDetails().get("comment") != null)
                    ? String.valueOf(audit.getDetails().get("comment"))
                    : null;
            LocalDate effectiveDate = null;
            if (audit != null && audit.getDetails() != null && audit.getDetails().get("effective_date") != null) {
                try {
                    String effStr = String.valueOf(audit.getDetails().get("effective_date"));
                    if (!effStr.isBlank()) {
                        effectiveDate = LocalDate.parse(effStr);
                    }
                } catch (Exception ignored) {}
            }

            AuditLog delAudit = delegationLogByTaskId.get(finishedTask.getId());
            boolean delegated = delAudit != null && "task_delegated".equals(delAudit.getAction());
            Integer delByUserId = null;
            String delByName = null;
            String delByEmail = null;
            String delToName = null;
            String delToEmail = null;
            String delMsg = null;
            LocalDateTime delAt = null;
            if (delegated && delAudit.getDetails() != null) {
                var d = delAudit.getDetails();
                if (d.get("from") != null) {
                    try { delByUserId = Integer.valueOf(String.valueOf(d.get("from"))); } catch (Exception ignored) {}
                }
                delByName = (String) d.get("from_name");
                delByEmail = (String) d.get("from_email");
                delToName = (String) d.get("to_name");
                delToEmail = (String) d.get("to_email");
                delMsg = (String) d.get("message");
                delAt = delAudit.getPerformedAt();
            }

            LocalDateTime dueDate = finishedTask.getDueDate() != null
                    ? LocalDateTime.ofInstant(finishedTask.getDueDate().toInstant(), java.time.ZoneId.systemDefault())
                    : null;

            states.add(new StartedInstanceDto.ReviewerState(
                    userId, name, email, "approved", null, actionAt, comment, effectiveDate,
                    delegated, delByUserId, delByName, delByEmail, delToName, delToEmail, delMsg, delAt, dueDate));
        }

        for (Task task : activeTasks) {
            LocalDateTime dueDate = task.getDueDate() != null
                    ? LocalDateTime.ofInstant(task.getDueDate().toInstant(), java.time.ZoneId.systemDefault())
                    : null;
            LocalDateTime actionAt = task.getCreateTime() != null
                    ? LocalDateTime.ofInstant(task.getCreateTime().toInstant(), java.time.ZoneId.systemDefault())
                    : null;

            if (task.getAssignee() != null) {
                User user = userRepository.findById(Integer.valueOf(task.getAssignee())).orElse(null);
                Integer userId = user != null ? user.getId() : Integer.valueOf(task.getAssignee());
                String name = user != null ? user.getName() : null;
                String email = user != null ? user.getEmail() : null;

                String delByName = (String) taskService.getVariableLocal(task.getId(), "delegatedByName");
                Integer delByUserId = (Integer) taskService.getVariableLocal(task.getId(), "delegatedByUserId");
                String delMsg = (String) taskService.getVariableLocal(task.getId(), "delegationMessage");
                String delAtStr = (String) taskService.getVariableLocal(task.getId(), "delegatedAt");
                LocalDateTime delAt = null;
                if (delAtStr != null) {
                    try {
                        delAt = LocalDateTime.ofInstant(java.time.Instant.parse(delAtStr), java.time.ZoneId.systemDefault());
                    } catch (Exception ignored) {
                        try { delAt = LocalDateTime.parse(delAtStr); } catch (Exception ignored2) {}
                    }
                }

                boolean delegated = delByName != null;
                String delByEmail = null;
                if (delegated && delByUserId != null) {
                    delByEmail = userRepository.findById(delByUserId).map(User::getEmail).orElse(null);
                }

                states.add(new StartedInstanceDto.ReviewerState(
                        userId, name, email, "pending", null, actionAt, null, null,
                        delegated, delByUserId, delByName, delByEmail, name, email, delMsg, delAt, dueDate));
            } else {
                List<String> roles = taskService.getIdentityLinksForTask(task.getId()).stream()
                        .filter(link -> IdentityLinkType.CANDIDATE.equals(link.getType()))
                        .map(IdentityLink::getGroupId)
                        .sorted()
                        .toList();
                states.add(new StartedInstanceDto.ReviewerState(
                        null, null, null, "pending",
                        roles.isEmpty() ? "unassigned" : String.join(", ", roles),
                        actionAt, null, null, false, null, null, null, null, null, null, null, dueDate));
            }
        }
        return states;
    }

    private Task requireTask(String taskId) {
        Task task = taskService.createTaskQuery().taskId(taskId).singleResult();
        if (task == null) {
            throw new NotFoundException("Task " + taskId + " not found.");
        }
        return task;
    }

    private WorkflowInstance requireInstance(String processInstanceId) {
        return instanceRepository.findByProcessInstanceId(processInstanceId)
                .orElseThrow(() -> new NotFoundException(
                        "No approval instance for process " + processInstanceId + "."));
    }

    /**
     * Task access: the assignee, an admin, or — for an unclaimed pooled task
     * — any member of its candidate roles.
     */
    private void requireTaskAccess(Task task, Document document) {
        if (currentUserProvider.isAdmin()) {
            return;
        }
        String myId = String.valueOf(currentUserProvider.getCurrentUserId());
        if (myId.equals(task.getAssignee())) {
            return;
        }
        if (task.getAssignee() == null) {
            List<String> myRoleNames = roleNames(currentUserProvider.getCurrentUser());
            boolean member = taskService.getIdentityLinksForTask(task.getId()).stream()
                    .filter(link -> IdentityLinkType.CANDIDATE.equals(link.getType()))
                    .map(IdentityLink::getGroupId)
                    .anyMatch(myRoleNames::contains);
            if (member) {
                return;
            }
        }
        throw new ForbiddenException("Only the assigned reviewer can act on this task.");
    }

    private WorkflowInstanceDto toDto(WorkflowInstance instance) {
        DocumentVersion version = instance.getDocumentVersion();
        List<WorkflowTaskDto> tasks = instance.getProcessInstanceId() == null ? List.of()
                : taskService.createTaskQuery()
                        .processInstanceId(instance.getProcessInstanceId())
                        .active()
                        .list()
                        .stream()
                        .map(task -> toTaskDto(task, currentUserProvider.getCurrentUser()))
                        .toList();
        return new WorkflowInstanceDto(
                instance.getId(),
                version.getDocument().getId(),
                version.getDocument().getDocumentNumber(),
                version.getId(),
                version.getVersionNumber(),
                instance.getStatus() == null ? null : instance.getStatus().getValue(),
                instance.getKind() == WorkflowInstanceKind.REAPPROVAL,
                instance.getStartedBy().getName(),
                instance.getStartedAt(),
                instance.getCompletedAt(),
                tasks);
    }

    private WorkflowTaskDto toTaskDto(Task task, User viewer) {
        return toTaskDto(task, viewer, workflowInstanceFor(task), null);
    }

    private WorkflowTaskDto toTaskDto(Task task, User viewer, WorkflowInstance instance, String cachedAssigneeName) {
        List<String> candidateGroups = taskService.getIdentityLinksForTask(task.getId()).stream()
                    .filter(link -> IdentityLinkType.CANDIDATE.equals(link.getType()))
                .map(IdentityLink::getGroupId)
                .sorted()
                .toList();
        String assigneeName = cachedAssigneeName;
        if (assigneeName == null && task.getAssignee() != null) {
            try {
                assigneeName = userRepository.findById(Integer.valueOf(task.getAssignee()))
                        .map(User::getName)
                        .orElse(null);
            } catch (Exception ignored) {}
        }
        Document document = instance == null ? null : instance.getDocumentVersion().getDocument();
        Map<String, Object> localVars = taskService.getVariablesLocal(task.getId());
        String delegatedBy = (String) localVars.get("delegatedByName");
        String delegationMessage = (String) localVars.get("delegationMessage");
        String delegatedAtStr = (String) localVars.get("delegatedAt");
        LocalDateTime delegatedAt = null;
        if (delegatedAtStr != null) {
            try {
                delegatedAt = LocalDateTime.ofInstant(java.time.Instant.parse(delegatedAtStr), java.time.ZoneId.systemDefault());
            } catch (Exception ignored) {}
        }
        return new WorkflowTaskDto(
                task.getId(),
                task.getName(),
                task.getAssignee(),
                assigneeName,
                candidateGroups,
                task.getAssignee() != null && task.getAssignee().equals(String.valueOf(viewer.getId())),
                instance != null && instance.getKind() == WorkflowInstanceKind.REAPPROVAL,
                task.getDueDate() == null ? null : LocalDateTime.ofInstant(task.getDueDate().toInstant(),
                        java.time.ZoneId.systemDefault()),
                document == null ? null : document.getDocumentNumber(),
                document == null ? null : document.getName(),
                document == null ? null : document.getId(),
                instance == null ? null : instance.getDocumentVersion().getId(),
                instance == null ? null : instance.getDocumentVersion().getVersionNumber(),
                instance == null ? null : instance.getDocumentVersion().getChangeNotes(),
                document == null ? null : document.getDepartment().getCode(),
                delegatedBy,
                delegationMessage,
                delegatedAt);
    }

    private WorkflowInstance workflowInstanceFor(Task task) {
        return task.getProcessInstanceId() == null ? null
                : instanceRepository.findByProcessInstanceId(task.getProcessInstanceId()).orElse(null);
    }

    private List<String> roleNames(User user) {
        List<String> names = new ArrayList<>();
        if (currentUserProvider.getCurrentUserId().equals(user.getId())) {
            names.addAll(currentUserProvider.getCurrentUserRoleNames());
        } else {
            names.addAll(user.getRoles().stream()
                    .map(userRole -> userRole.getRole().getName())
                    .toList());
        }
        if (user.getDepartments() != null) {
            user.getDepartments().stream()
                    .map(ud -> ud.getLevel().name())
                    .forEach(names::add);
        }
        return names;
    }
}
