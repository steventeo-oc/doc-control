package com.doccontrol.document;

import java.time.LocalDateTime;

/** List-row shape of a document (GET /documents). */
public record DocumentSummaryDto(
        Integer id,
        String documentNumber,
        String name,
        String status,
        String documentTypeCode,
        String departmentCode,
        Integer ownerUserId,
        String ownerName,
        LocalDateTime createdAt,
        LocalDateTime updatedAt) {

    public static DocumentSummaryDto from(Document document) {
        return new DocumentSummaryDto(
                document.getId(),
                document.getDocumentNumber(),
                document.getName(),
                document.getStatus() == null ? null : document.getStatus().getValue(),
                document.getDocumentType().getCode(),
                document.getDepartment().getCode(),
                document.getOwner().getId(),
                document.getOwner().getName(),
                document.getCreatedAt(),
                document.getUpdatedAt());
    }
}
