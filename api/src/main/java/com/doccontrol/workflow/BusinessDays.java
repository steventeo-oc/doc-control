package com.doccontrol.workflow;

import java.time.DayOfWeek;
import java.time.LocalDate;

/**
 * Business-day arithmetic (Saturday/Sunday excluded). A holiday calendar can
 * be added here later without changing callers.
 */
public final class BusinessDays {

    private BusinessDays() {
    }

    /**
     * The date {@code days} business days after {@code start} — negative
     * values walk backwards.
     */
    public static LocalDate addBusinessDays(LocalDate start, int days) {
        LocalDate date = start;
        int step = days >= 0 ? 1 : -1;
        int remaining = Math.abs(days);
        while (remaining > 0) {
            date = date.plusDays(step);
            if (isBusinessDay(date)) {
                remaining--;
            }
        }
        return date;
    }

    /**
     * Business days in the half-open range [from, to] — e.g. a task due
     * Wednesday checked on Friday is 2 business days overdue.
     */
    public static int businessDaysUntil(LocalDate from, LocalDate to) {
        int count = 0;
        LocalDate date = from;
        while (date.isBefore(to)) {
            if (isBusinessDay(date)) {
                count++;
            }
            date = date.plusDays(1);
        }
        return count;
    }

    /** Business days strictly after {@code dueDate}, up to and including {@code today}. */
    public static int overdueBusinessDays(LocalDate dueDate, LocalDate today) {
        return businessDaysUntil(dueDate.plusDays(1), today.plusDays(1));
    }

    private static boolean isBusinessDay(LocalDate date) {
        DayOfWeek day = date.getDayOfWeek();
        return day != DayOfWeek.SATURDAY && day != DayOfWeek.SUNDAY;
    }
}
