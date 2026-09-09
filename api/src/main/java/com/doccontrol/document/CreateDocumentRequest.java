package com.doccontrol.document;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Create request. The document_number is deliberately absent — it is always
 * server-generated (CLAUDE.md convention 1). The `file` part of the spec's
 * create body arrives with the versions/MinIO work; for now creation makes a
 * metadata-only document and version 1 is uploaded separately.
 */
public record CreateDocumentRequest(
        @NotNull Integer documentTypeId,
        @NotNull Integer departmentId,
        @NotBlank @Size(max = 255) String name) {
}
