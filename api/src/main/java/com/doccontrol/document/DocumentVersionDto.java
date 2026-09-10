package com.doccontrol.document;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** API shape of a document version (list, detail). */
public record DocumentVersionDto(
        Integer id,
        Integer documentId,
        Integer versionNumber,
        String status,
        String changeNotes,
        String changeReference,
        LocalDate effectiveAt,
        String fileName,
        Integer uploadedByUserId,
        String uploadedByName,
        LocalDateTime uploadedAt) {

    public static DocumentVersionDto from(DocumentVersion version) {
        String reference = version.getFileReference();
        String fileName = reference.substring(reference.lastIndexOf('/') + 1);
        return new DocumentVersionDto(
                version.getId(),
                version.getDocument().getId(),
                version.getVersionNumber(),
                version.getStatus() == null ? null : version.getStatus().getValue(),
                version.getChangeNotes(),
                version.getChangeReference(),
                version.getEffectiveAt(),
                fileName,
                version.getUploadedBy().getId(),
                version.getUploadedBy().getName(),
                version.getUploadedAt());
    }
}
