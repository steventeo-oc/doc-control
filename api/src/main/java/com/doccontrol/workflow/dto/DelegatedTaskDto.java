package com.doccontrol.workflow.dto;

import java.time.LocalDateTime;

/**
 * Representation of a task delegated by the caller to another reviewer.
 */
public record DelegatedTaskDto(
        String taskId,
        Integer documentId,
        String documentNumber,
        String documentName,
        Integer versionNumber,
        Integer delegatedToUserId,
        String delegatedToName,
        String delegatedToEmail,
        String delegationMessage,
        LocalDateTime delegatedAt,
        LocalDateTime dueDate,
        String status,
        boolean canRecall) {
}
