package com.doccontrol.workflow;

import org.flowable.engine.TaskService;
import org.flowable.task.api.Task;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Answers "which documents is this user a reviewer on?" — assigned tasks
 * plus pooled tasks for the roles the user holds. Feeds the visibility rule
 * ("draft/in_review visible to any assigned reviewers") without syncing
 * identities into Flowable: role slots are stored as candidate-group names
 * matching our role names, resolved against user_role at query time.
 */
@Component
public class ReviewerAccess {

    private final TaskService taskService;
    private final WorkflowInstanceRepository workflowInstanceRepository;

    public ReviewerAccess(TaskService taskService, WorkflowInstanceRepository workflowInstanceRepository) {
        this.taskService = taskService;
        this.workflowInstanceRepository = workflowInstanceRepository;
    }

    /** Document ids where the user is an assigned reviewer or holds a pooled role. */
    @Transactional(readOnly = true)
    public Set<Integer> reviewerVisibleDocumentIds(Integer userId, List<String> roleNames) {
        String userIdString = String.valueOf(userId);
        List<Task> mine = taskService.createTaskQuery()
                .taskCandidateOrAssigned(userIdString)
                .active()
                .list();
        List<Task> pooled = roleNames.isEmpty()
                ? List.of()
                : taskService.createTaskQuery()
                        .taskCandidateGroupIn(roleNames)
                        .active()
                        .list();

        return Stream.concat(mine.stream(), pooled.stream())
                .map(Task::getProcessInstanceId)
                .distinct()
                .map(workflowInstanceRepository::findByProcessInstanceId)
                .flatMap(optional -> optional.stream())
                .map(instance -> instance.getDocumentVersion().getDocument().getId())
                .collect(Collectors.toSet());
    }

    /** True when the user has a pending task on the given document. */
    @Transactional(readOnly = true)
    public boolean isReviewer(Integer userId, List<String> roleNames, Integer documentId) {
        return reviewerVisibleDocumentIds(userId, roleNames).contains(documentId);
    }
}
