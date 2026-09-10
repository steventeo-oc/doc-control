package com.doccontrol.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Read-and-understood acknowledgment tuning (Phase 2d, confirmed with QA):
 * a 7-business-day window by default with its own reminder/escalation
 * knobs — deliberately separate from the approval workflow's 3/1/2-day
 * settings, since this is explicitly longer and lower-stakes. Record-only:
 * nothing is blocked by a missing acknowledgment.
 */
@ConfigurationProperties(prefix = "doccontrol.acknowledgment")
public record AcknowledgmentProperties(
        int windowBusinessDays,
        int reminderBeforeDays,
        int escalateAfterOverdueDays) {
}
