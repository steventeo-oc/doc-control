package com.doccontrol.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Periodic-review tuning (Phase 2c, confirmed with QA): ONE review interval
 * applies to every document (never per-type), the owner is responsible, and
 * reminders/escalation mirror the approval shape with independent knobs —
 * annual cycles want a longer reminder horizon than the 3/1/2 approval
 * defaults. intervalMonths = 0 switches review tracking off entirely.
 */
@ConfigurationProperties(prefix = "doccontrol.review")
public record ReviewProperties(
        int intervalMonths,
        int reminderBeforeDays,
        int escalateAfterOverdueDays) {
}
