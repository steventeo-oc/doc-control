package com.doccontrol.lookup;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CreateDocumentTierRequest(
        @NotNull Integer tierNumber,
        @NotBlank @Size(max = 255) String label) {
}
