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
        Integer tierNumber,
        String tierLabel,
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
        LocalDateTime deletedAt,
        Boolean isFavorite) {

    public static DocumentDto from(Document document) {
        return from(document, false);
    }

    public static DocumentDto from(Document document, boolean isFavorite) {
        Integer tierNumber = document.getDocumentType() != null && document.getDocumentType().getTier() != null
                ? document.getDocumentType().getTier().getTierNumber() : null;
        String tierLabel = document.getDocumentType() != null && document.getDocumentType().getTier() != null
                ? document.getDocumentType().getTier().getLabel() : null;

        return new DocumentDto(
                document.getId(),
                document.getDocumentNumber(),
                document.getName(),
                document.getStatus() == null ? null : document.getStatus().getValue(),
                document.getDocumentType().getId(),
                document.getDocumentType().getCode(),
                tierNumber,
                tierLabel,
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
                document.getDeletedAt(),
                isFavorite);
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
