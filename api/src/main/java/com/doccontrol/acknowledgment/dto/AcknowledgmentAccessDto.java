package com.doccontrol.acknowledgment.dto;

import com.doccontrol.acknowledgment.DocumentAcknowledgmentAccess;

import java.time.LocalDateTime;

/** One status-visibility grant. */
public record AcknowledgmentAccessDto(
        Integer documentId,
        Integer userId,
        String userName,
        Integer grantedByUserId,
        String grantedByName,
        LocalDateTime grantedAt) {

    public static AcknowledgmentAccessDto from(DocumentAcknowledgmentAccess access) {
        return new AcknowledgmentAccessDto(
                access.getDocument().getId(),
                access.getUser().getId(),
                access.getUser().getName(),
                access.getGrantedBy().getId(),
                access.getGrantedBy().getName(),
                access.getGrantedAt());
    }
}
