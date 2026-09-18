package com.doccontrol.workflow.dto;

import java.time.LocalDateTime;
import java.util.List;

/**
 * API shape of an approval the caller started (the "Started by Me" pane).
 * {@code reviewers} is populated only for in-progress instances: which
 * tasks finished comes from the engine's history, but the approver name
 * comes from our own audit trail (the performed_by of the task_approved
 * row — the engine's task history does not reliably persist task
 * assignees); pending entries come from the active tasks — claimed tasks
 * name their assignee, pooled tasks name the candidate role (nobody has
 * committed until someone claims).
 */
public record StartedInstanceDto(
        Integer id,
        Integer documentId,
        String documentNumber,
        String documentName,
        Integer versionNumber,
        String status,
        boolean reapproval,
        LocalDateTime startedAt,
        LocalDateTime completedAt,
        List<ReviewerState> reviewers,
        String feedbackAction,
        String feedbackActor,
        String feedbackComment) {

    public StartedInstanceDto(
            Integer id,
            Integer documentId,
            String documentNumber,
            String documentName,
            Integer versionNumber,
            String status,
            boolean reapproval,
            LocalDateTime startedAt,
            LocalDateTime completedAt,
            List<ReviewerState> reviewers) {
        this(id, documentId, documentNumber, documentName, versionNumber, status, reapproval, startedAt, completedAt, reviewers, null, null, null);
    }

    public record ReviewerState(
            Integer userId,
            String name,
            String email,
            String state,
            String role,
            LocalDateTime actionAt,
            String comment,
            java.time.LocalDate effectiveDate,
            boolean delegated,
            Integer delegatedByUserId,
            String delegatedByName,
            String delegatedByEmail,
            String delegatedToName,
            String delegatedToEmail,
            String delegationMessage,
            LocalDateTime delegatedAt,
            LocalDateTime dueDate) {

        public ReviewerState(String name, String state, String role) {
            this(null, name, null, state, role, null, null, null, false, null, null, null, null, null, null, null, null);
        }
    }
}
