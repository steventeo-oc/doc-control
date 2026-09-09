package com.doccontrol.lookup;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CreateDocumentTypeRequest(
        @NotBlank @Size(max = 32) String code,
        @NotBlank @Size(max = 255) String label,
        @NotNull Integer tierId) {
}
