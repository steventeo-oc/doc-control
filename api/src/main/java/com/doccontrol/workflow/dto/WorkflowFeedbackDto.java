package com.doccontrol.workflow.dto;

import java.time.LocalDateTime;

public record WorkflowFeedbackDto(
        Integer instanceId,
        Integer versionNumber,
        String action,
        String actorName,
        String comment,
        LocalDateTime timestamp) {}
