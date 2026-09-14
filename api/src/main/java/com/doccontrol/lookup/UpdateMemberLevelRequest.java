package com.doccontrol.lookup;

import com.doccontrol.identity.MembershipLevel;
import jakarta.validation.constraints.NotNull;

/**
 * Level change on a department member. The level is deliberately @NotNull:
 * an omitted level is a validation error, never an assumption (plan-back F1).
 */
public record UpdateMemberLevelRequest(@NotNull MembershipLevel level) {
}
