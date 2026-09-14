package com.doccontrol.identity;

import jakarta.validation.constraints.NotNull;

/**
 * One department membership assignment on the users API. The level is
 * deliberately @NotNull: an omitted level is a validation error, never an
 * assumption (plan-back F1) — the V8 column's lack of a database default
 * backs the same rule.
 */
public record MembershipInput(
        @NotNull Integer departmentId,
        @NotNull MembershipLevel level) {
}
