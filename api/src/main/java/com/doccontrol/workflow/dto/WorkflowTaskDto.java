package com.doccontrol.workflow.dto;

import java.time.LocalDateTime;
import java.util.List;

/** API shape of a workflow task (Flowable task projected for our UI). */
public record WorkflowTaskDto(
        String id,
        String name,
        String assigneeUserId,
        String assigneeName,
        List<String> candidateGroups,
        boolean claimedByMe,
        boolean reapproval,
        LocalDateTime dueDate,
        String documentNumber,
        String documentName,
        Integer documentId,
        Integer versionId,
        Integer versionNumber,
        String changeNotes,
        String departmentCode,
        String delegatedBy,
        String delegationMessage,
        LocalDateTime delegatedAt) {
}
