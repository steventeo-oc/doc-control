package com.doccontrol.workflow;

import com.doccontrol.workflow.dto.ReviewerCandidateDto;
import com.doccontrol.workflow.dto.StartApprovalRequest;
import com.doccontrol.workflow.dto.WorkflowInstanceDto;
import com.doccontrol.workflow.dto.WorkflowTaskDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.time.LocalDate;
import java.util.List;

@RestController
public class WorkflowController {

    private final WorkflowService workflowService;

    public WorkflowController(WorkflowService workflowService) {
        this.workflowService = workflowService;
    }

    @PostMapping("/documents/{documentId}/versions/{versionId}/workflow/start")
    public ResponseEntity<WorkflowInstanceDto> start(@PathVariable Integer documentId,
                                                     @PathVariable Integer versionId,
                                                     @Valid @RequestBody StartApprovalRequest request) {
        WorkflowInstanceDto started = workflowService.start(documentId, versionId, request);
        return ResponseEntity
                .created(URI.create("/workflow-instances/" + started.id()))
                .body(started);
    }

    /** Periodic-review re-approval of the document's current released version (Phase 2c). */
    @PostMapping("/documents/{documentId}/review-approval")
    public ResponseEntity<WorkflowInstanceDto> startReviewApproval(@PathVariable Integer documentId,
                                                                   @Valid @RequestBody StartApprovalRequest request) {
        WorkflowInstanceDto started = workflowService.startReviewApproval(documentId, request);
        return ResponseEntity
                .created(URI.create("/workflow-instances/" + started.id()))
                .body(started);
    }

    /** Reviewer picklist for the assignee forms — gated like the start endpoints themselves. */
    @GetMapping("/documents/{documentId}/reviewer-candidates")
    public List<ReviewerCandidateDto> reviewerCandidates(@PathVariable Integer documentId) {
        return workflowService.reviewerCandidates(documentId);
    }

    @GetMapping("/workflow-instances/{id}")
    public WorkflowInstanceDto instance(@PathVariable Integer id) {
        return workflowService.get(id);
    }

    @GetMapping("/workflow-instances/{id}/tasks")
    public List<WorkflowTaskDto> instanceTasks(@PathVariable Integer id) {
        return workflowService.instanceTasks(id);
    }

    public record CompleteTaskRequest(@NotNull Boolean approved, String comment,
                                      LocalDate effectiveDate) {
    }

    @PostMapping("/workflow-tasks/{taskId}/complete")
    public WorkflowInstanceDto complete(@PathVariable String taskId,
                                        @Valid @RequestBody CompleteTaskRequest request) {
        return workflowService.complete(taskId, request.approved(), request.comment(),
                request.effectiveDate());
    }

    public record DelegateTaskRequest(@NotNull Integer toUserId) {
    }

    @PostMapping("/workflow-tasks/{taskId}/delegate")
    public WorkflowInstanceDto delegate(@PathVariable String taskId,
                                        @Valid @RequestBody DelegateTaskRequest request) {
        return workflowService.delegate(taskId, request.toUserId());
    }

    @GetMapping("/my/tasks")
    public List<WorkflowTaskDto> myTasks() {
        return workflowService.myTasks();
    }
}
