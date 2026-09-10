package com.doccontrol.acknowledgment.dto;

import java.time.LocalDate;
import java.util.List;

/**
 * Acknowledgment status for a document's current (effective) version:
 * the window, who has acknowledged, and who still owes one. Record-only —
 * an overdue status gates nothing.
 */
public record AcknowledgmentStatusDto(
        Integer documentId,
        Integer documentVersionId,
        Integer versionNumber,
        LocalDate opensAt,
        LocalDate closesAt,
        boolean overdue,
        int requiredCount,
        List<AcknowledgmentDto> acknowledged,
        List<AcknowledgmentUserDto> outstanding) {
}
