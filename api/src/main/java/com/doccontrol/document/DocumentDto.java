package com.doccontrol.document;

import java.time.LocalDateTime;

/** Detail shape of a document (GET /documents/{id}, POST, PATCH, restore). */
public record DocumentDto(
        Integer id,
        String documentNumber,
        String name,
        String status,
        Integer documentTypeId,
        String documentTypeCode,
        Integer departmentId,
        String departmentCode,
        Integer sequenceNumber,
        Integer ownerUserId,
        String ownerName,
        Integer currentVersionId,
        LocalDateTime createdAt,
        LocalDateTime updatedAt,
        LocalDateTime deletedAt) {

    public static DocumentDto from(Document document) {
        return new DocumentDto(
                document.getId(),
                document.getDocumentNumber(),
                document.getName(),
                document.getStatus() == null ? null : document.getStatus().getValue(),
                document.getDocumentType().getId(),
                document.getDocumentType().getCode(),
                document.getDepartment().getId(),
                document.getDepartment().getCode(),
                document.getSequenceNumber(),
                document.getOwner().getId(),
                document.getOwner().getName(),
                document.getCurrentVersion() == null ? null : document.getCurrentVersion().getId(),
                document.getCreatedAt(),
                document.getUpdatedAt(),
                document.getDeletedAt());
    }
}
