package com.doccontrol.document;

import java.time.LocalDate;
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
        LocalDate lastReviewedAt,
        LocalDate nextReviewDue,
        boolean reviewOverdue,
        LocalDate pendingEffectiveDate,
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
                document.getLastReviewedAt(),
                document.getNextReviewDue(),
                document.isReviewOverdue(),
                pendingEffectiveDateOf(document),
                document.getCreatedAt(),
                document.getUpdatedAt(),
                document.getDeletedAt());
    }

    /**
     * The chosen effective date while an approval outcome is pending
     * (document status "approved") — null once released.
     */
    private static LocalDate pendingEffectiveDateOf(Document document) {
        if (document.getStatus() != DocumentStatus.APPROVED) {
            return null;
        }
        return document.getVersions().stream()
                .filter(version -> version.getStatus() == DocumentVersionStatus.APPROVED)
                .map(DocumentVersion::getEffectiveAt)
                .findFirst()
                .orElse(null);
    }
}
