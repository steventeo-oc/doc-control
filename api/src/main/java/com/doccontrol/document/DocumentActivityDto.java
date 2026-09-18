package com.doccontrol.document;

import java.time.LocalDateTime;
import java.util.Map;

public record DocumentActivityDto(
        Integer id,
        LocalDateTime performedAt,
        Integer actorId,
        String actorName,
        String actorEmail,
        String entityType,
        Integer entityId,
        String action,
        Map<String, Object> details) {}
