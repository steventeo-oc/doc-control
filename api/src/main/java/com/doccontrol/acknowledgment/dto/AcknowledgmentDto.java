package com.doccontrol.acknowledgment.dto;

import com.doccontrol.acknowledgment.DocumentAcknowledgment;

import java.time.LocalDateTime;

/** One recorded acknowledgment. */
public record AcknowledgmentDto(
        Integer id,
        Integer documentId,
        Integer documentVersionId,
        Integer userId,
        String userName,
        LocalDateTime acknowledgedAt) {

    public static AcknowledgmentDto from(DocumentAcknowledgment acknowledgment) {
        return new AcknowledgmentDto(
                acknowledgment.getId(),
                acknowledgment.getDocumentVersion().getDocument().getId(),
                acknowledgment.getDocumentVersion().getId(),
                acknowledgment.getUser().getId(),
                acknowledgment.getUser().getName(),
                acknowledgment.getAcknowledgedAt());
    }
}
