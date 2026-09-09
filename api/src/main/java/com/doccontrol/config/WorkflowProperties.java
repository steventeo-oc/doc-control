package com.doccontrol.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Escalation/reminder tuning, confirmed with QA and deliberately
 * configurable (not hardcoded): due date 3 business days after start,
 * reminders 1 day before and on the due date, escalation to owner + admin
 * at 2+ business days overdue.
 */
@ConfigurationProperties(prefix = "doccontrol.workflow")
public record WorkflowProperties(
        int dueBusinessDays,
        int reminderBeforeDays,
        int escalateAfterOverdueDays) {
}
