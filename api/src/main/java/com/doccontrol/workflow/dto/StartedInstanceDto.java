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
        Integer versionNumber,
        String status,
        boolean reapproval,
        LocalDateTime startedAt,
        LocalDateTime completedAt,
        List<ReviewerState> reviewers) {

    public record ReviewerState(String name, String state, String role) {
    }
}
