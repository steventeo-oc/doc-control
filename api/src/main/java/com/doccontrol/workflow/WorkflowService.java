package com.doccontrol.workflow;

import com.doccontrol.audit.AuditService;
import com.doccontrol.common.web.ConflictException;
import com.doccontrol.common.web.ForbiddenException;
import com.doccontrol.common.web.NotFoundException;
import com.doccontrol.document.Document;
import com.doccontrol.document.DocumentService;
import com.doccontrol.document.DocumentVersion;
import com.doccontrol.document.DocumentVersionRepository;
import com.doccontrol.document.DocumentVersionStatus;
import com.doccontrol.identity.Role;
import com.doccontrol.identity.RoleRepository;
import com.doccontrol.identity.User;
import com.doccontrol.identity.UserRepository;
import com.doccontrol.security.CurrentUserProvider;
import com.doccontrol.workflow.dto.StartApprovalRequest;
import com.doccontrol.workflow.dto.WorkflowInstanceDto;
import com.doccontrol.workflow.dto.WorkflowTaskDto;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.TaskService;
import org.flowable.engine.runtime.ProcessInstance;
import org.flowable.identitylink.api.IdentityLink;
import org.flowable.identitylink.api.IdentityLinkType;
import org.flowable.task.api.Task;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class WorkflowService {

    private static final String PROCESS_KEY = "documentApproval";

    private final RuntimeService runtimeService;
    private final TaskService taskService;
    private final WorkflowInstanceRepository instanceRepository;
    private final DocumentVersionRepository documentVersionRepository;
    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final DocumentService documentService;
    private final AuditService auditService;
    private final CurrentUserProvider currentUserProvider;

    public WorkflowService(RuntimeService runtimeService, TaskService taskService,
                           WorkflowInstanceRepository instanceRepository,
                           DocumentVersionRepository documentVersionRepository,
                           UserRepository userRepository, RoleRepository roleRepository,
                           DocumentService documentService, AuditService auditService,
                           CurrentUserProvider currentUserProvider) {
        this.runtimeService = runtimeService;
        this.taskService = taskService;
        this.instanceRepository = instanceRepository;
        this.documentVersionRepository = documentVersionRepository;
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.documentService = documentService;
        this.auditService = auditService;
        this.currentUserProvider = currentUserProvider;
    }

    @Transactional
    public WorkflowInstanceDto start(Integer documentId, Integer versionId, StartApprovalRequest request) {
        DocumentVersion version = documentVersionRepository.findById(versionId)
                .orElseThrow(() -> new NotFoundException("Version " + versionId + " not found."));
        if (!version.getDocument().getId().equals(documentId)) {
            throw new NotFoundException("Version " + versionId + " not found.");
        }
        Document document = documentService.requireVisible(documentId);
        documentService.requireCanModify(document);

        if (version.getStatus() != DocumentVersionStatus.DRAFT) {
            throw new ConflictException("Only draft versions can be sent for approval.");
        }
        if (instanceRepository.existsByDocumentVersionIdAndStatus(versionId, WorkflowInstanceStatus.IN_PROGRESS)) {
            throw new ConflictException("An approval is already in progress for this version.");
        }

        List<String> slots = new ArrayList<>();
        List<String> slotDescriptions = new ArrayList<>();
        for (StartApprovalRequest.AssigneeInput assignee : request.assignees()) {
            switch (assignee.type().toUpperCase()) {
                case "USER" -> {
                    User user = userRepository.findById(assignee.userId())
                            .filter(User::isActive)
                            .orElseThrow(() -> new NotFoundException(
                                    "Reviewer user " + assignee.userId() + " not found."));
                    slots.add(SlotAssignmentListener.USER_PREFIX + user.getId());
                    slotDescriptions.add(user.getEmail());
                }
                case "ROLE" -> {
                    Role role = roleRepository.findByName(assignee.roleName())
                            .orElseThrow(() -> new NotFoundException(
                                    "Role '" + assignee.roleName() + "' not found."));
                    slots.add(SlotAssignmentListener.ROLE_PREFIX + role.getName());
                    slotDescriptions.add("role:" + role.getName());
                }
                default -> throw new ConflictException(
                        "Assignee type must be USER or ROLE, got: " + assignee.type());
            }
        }

        WorkflowInstance instance = new WorkflowInstance();
        instance.setDocumentVersion(version);
        instance.setStatus(WorkflowInstanceStatus.IN_PROGRESS);
        instance.setStartedBy(currentUserProvider.getCurrentUser());
        instanceRepository.save(instance);

        ProcessInstance processInstance = runtimeService.startProcessInstanceByKey(PROCESS_KEY, Map.of(
                "assigneeSlots", slots,
                "workflowInstanceId", instance.getId()));
        instance.setProcessInstanceId(processInstance.getId());
        instanceRepository.save(instance);

        auditService.record("workflow_instance", instance.getId(), "created", Map.of(
                "document_number", document.getDocumentNumber(),
                "version_number", version.getVersionNumber(),
                "assignees", slotDescriptions));

        return toDto(instance);
    }

    /** Reviewer action: approve or reject. Rejection ends the whole approval. */
    @Transactional
    public WorkflowInstanceDto complete(String taskId, boolean approved, String comment) {
        Task task = requireTask(taskId);
        WorkflowInstance instance = requireInstance(task.getProcessInstanceId());
        Document document = documentService.requireVisible(instance.getDocumentVersion().getDocument().getId());
        requireTaskAccess(task, document);

        if (task.getAssignee() == null) {
            taskService.setAssignee(taskId, String.valueOf(currentUserProvider.getCurrentUserId()));
        }
        if (comment != null && !comment.isBlank()) {
            taskService.addComment(taskId, task.getProcessInstanceId(), comment);
        }

        if (approved) {
            taskService.complete(taskId);
            boolean processEnded = runtimeService.createProcessInstanceQuery()
                    .processInstanceId(instance.getProcessInstanceId())
                    .count() == 0;
            if (processEnded) {
                // every slot approved: promote the version (pointer, statuses,
                // document release, audit) and close the instance
                documentService.promoteVersion(instance.getDocumentVersion());
                instance.setStatus(WorkflowInstanceStatus.COMPLETED);
                instance.setCompletedAt(LocalDateTime.now());
                auditService.record("workflow_instance", instance.getId(), "completed", Map.of(
                        "document_number", document.getDocumentNumber(),
                        "version_number", instance.getDocumentVersion().getVersionNumber(),
                        "approved_by", currentUserProvider.getCurrentUserId()));
            } else {
                auditService.record("workflow_instance", instance.getId(), "task_approved", Map.of(
                        "task_id", taskId,
                        "document_number", document.getDocumentNumber()));
            }
        } else {
            // 100% required: a single rejection rejects the whole approval
            runtimeService.deleteProcessInstance(instance.getProcessInstanceId(),
                    "Rejected by reviewer " + currentUserProvider.getCurrentUser().getEmail());
            instance.setStatus(WorkflowInstanceStatus.REJECTED);
            instance.setCompletedAt(LocalDateTime.now());
            auditService.record("workflow_instance", instance.getId(), "rejected", Map.of(
                    "document_number", document.getDocumentNumber(),
                    "version_number", instance.getDocumentVersion().getVersionNumber(),
                    "rejected_by", currentUserProvider.getCurrentUserId()));
        }
        return toDto(instance);
    }

    /** Unrestricted delegation (confirmed with QA): reviewer sends the task to anyone. */
    @Transactional
    public WorkflowInstanceDto delegate(String taskId, Integer toUserId) {
        Task task = requireTask(taskId);
        WorkflowInstance instance = requireInstance(task.getProcessInstanceId());
        Document document = documentService.requireVisible(instance.getDocumentVersion().getDocument().getId());
        requireTaskAccess(task, document);

        User target = userRepository.findById(toUserId)
                .filter(User::isActive)
                .orElseThrow(() -> new NotFoundException("User " + toUserId + " not found."));

        String previousAssignee = task.getAssignee();
        taskService.setAssignee(taskId, String.valueOf(target.getId()));
        auditService.record("workflow_instance", instance.getId(), "task_delegated", Map.of(
                "task_id", taskId,
                "from", previousAssignee == null ? "unclaimed" : previousAssignee,
                "to", target.getId()));
        return toDto(instance);
    }

    /** Tasks assigned to me or pooled to a role I hold, pending only. */
    @Transactional(readOnly = true)
    public List<WorkflowTaskDto> myTasks() {
        User me = currentUserProvider.getCurrentUser();
        List<String> myRoleNames = roleNames(me);
        String myId = String.valueOf(me.getId());

        List<Task> tasks = new ArrayList<>();
        tasks.addAll(taskService.createTaskQuery().taskAssignee(myId).active().list());
        if (!myRoleNames.isEmpty()) {
            tasks.addAll(taskService.createTaskQuery().taskCandidateGroupIn(myRoleNames).active().list());
        }
        return tasks.stream()
                .sorted(Comparator.comparing(Task::getDueDate,
                        Comparator.nullsLast(Comparator.naturalOrder())))
                .map(task -> toTaskDto(task, me))
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
                instance.getStartedBy().getName(),
                instance.getStartedAt(),
                instance.getCompletedAt(),
                tasks);
    }

    private WorkflowTaskDto toTaskDto(Task task, User viewer) {
        List<String> candidateGroups = taskService.getIdentityLinksForTask(task.getId()).stream()
                    .filter(link -> IdentityLinkType.CANDIDATE.equals(link.getType()))
                .map(IdentityLink::getGroupId)
                .sorted()
                .toList();
        String assigneeName = null;
        if (task.getAssignee() != null) {
            assigneeName = userRepository.findById(Integer.valueOf(task.getAssignee()))
                    .map(User::getName)
                    .orElse(null);
        }
        WorkflowInstance instance = workflowInstanceFor(task);
        return new WorkflowTaskDto(
                task.getId(),
                task.getName(),
                task.getAssignee(),
                assigneeName,
                candidateGroups,
                task.getAssignee() != null && task.getAssignee().equals(String.valueOf(viewer.getId())),
                task.getDueDate() == null ? null : LocalDateTime.ofInstant(task.getDueDate().toInstant(),
                        java.time.ZoneId.systemDefault()),
                instance == null ? null : instance.getDocumentVersion().getDocument().getDocumentNumber(),
                instance == null ? null : instance.getDocumentVersion().getDocument().getId(),
                instance == null ? null : instance.getDocumentVersion().getVersionNumber());
    }

    private WorkflowInstance workflowInstanceFor(Task task) {
        return task.getProcessInstanceId() == null ? null
                : instanceRepository.findByProcessInstanceId(task.getProcessInstanceId()).orElse(null);
    }

    private List<String> roleNames(User user) {
        if (currentUserProvider.getCurrentUserId().equals(user.getId())) {
            return currentUserProvider.getCurrentUserRoleNames();
        }
        return user.getRoles().stream()
                .map(userRole -> userRole.getRole().getName())
                .toList();
    }
}
