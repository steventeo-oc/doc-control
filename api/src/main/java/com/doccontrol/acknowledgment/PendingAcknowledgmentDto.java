package com.doccontrol.acknowledgment;

import java.time.LocalDate;

/**
 * One entry of the "Pending My Acknowledgment" view (nav restructure
 * plan-back F2): a released document in one of the caller's departments
 * whose current version the caller has not acknowledged yet.
 */
public record PendingAcknowledgmentDto(
        Integer documentId,
        Integer versionId,
        String documentNumber,
        String name,
        String departmentCode,
        Integer versionNumber,
        LocalDate effectiveAt,
        LocalDate windowClosesAt,
        boolean overdue) {
}
