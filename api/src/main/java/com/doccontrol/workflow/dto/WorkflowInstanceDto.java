package com.doccontrol.workflow.dto;

import java.time.LocalDateTime;
import java.util.List;

/** API shape of an approval instance with its tasks. */
public record WorkflowInstanceDto(
        Integer id,
        Integer documentId,
        String documentNumber,
        Integer documentVersionId,
        Integer versionNumber,
        String status,
        boolean reapproval,
        String startedByName,
        LocalDateTime startedAt,
        LocalDateTime completedAt,
        List<WorkflowTaskDto> tasks) {
}
