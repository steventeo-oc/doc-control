package com.doccontrol.document;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** List-row shape of a document (GET /documents). */
public record DocumentSummaryDto(
        Integer id,
        String documentNumber,
        String name,
        String status,
        String documentTypeCode,
        Integer levelNumber,
        String levelLabel,
        String departmentCode,
        Integer ownerUserId,
        String ownerName,
        LocalDate nextReviewDue,
        boolean reviewOverdue,
        LocalDateTime createdAt,
        LocalDateTime updatedAt,
        Boolean isFavorite,
        Integer revisionVersionNumber,
        String revisionStatus) {

    public static DocumentSummaryDto from(Document document) {
        return from(document, false, null, null);
    }

    public static DocumentSummaryDto from(Document document, boolean isFavorite) {
        return from(document, isFavorite, null, null);
    }

    public static DocumentSummaryDto from(
            Document document,
            boolean isFavorite,
            Integer revisionVersionNumber,
            String revisionStatus) {
        Integer levelNumber = document.getDocumentType() != null && document.getDocumentType().getLevel() != null
                ? document.getDocumentType().getLevel().getLevelNumber() : null;
        String levelLabel = document.getDocumentType() != null && document.getDocumentType().getLevel() != null
                ? document.getDocumentType().getLevel().getLabel() : null;

        return new DocumentSummaryDto(
                document.getId(),
                document.getDocumentNumber(),
                document.getName(),
                document.getStatus() == null ? null : document.getStatus().getValue(),
                document.getDocumentType().getCode(),
                levelNumber,
                levelLabel,
                document.getDepartment().getCode(),
                document.getOwner().getId(),
                document.getOwner().getName(),
                document.getNextReviewDue(),
                document.isReviewOverdue(),
                document.getCreatedAt(),
                document.getUpdatedAt(),
                isFavorite,
                revisionVersionNumber,
                revisionStatus);
    }
}
