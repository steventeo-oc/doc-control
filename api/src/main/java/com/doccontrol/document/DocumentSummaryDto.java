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
        Integer tierNumber,
        String tierLabel,
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
        Integer tierNumber = document.getDocumentType() != null && document.getDocumentType().getTier() != null
                ? document.getDocumentType().getTier().getTierNumber() : null;
        String tierLabel = document.getDocumentType() != null && document.getDocumentType().getTier() != null
                ? document.getDocumentType().getTier().getLabel() : null;

        return new DocumentSummaryDto(
                document.getId(),
                document.getDocumentNumber(),
                document.getName(),
                document.getStatus() == null ? null : document.getStatus().getValue(),
                document.getDocumentType().getCode(),
                tierNumber,
                tierLabel,
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
