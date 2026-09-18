package com.doccontrol.lookup;

import com.doccontrol.identity.MembershipLevel;
import jakarta.validation.constraints.NotNull;

public record AddDepartmentMemberRequest(
        @NotNull(message = "userId is required")
        Integer userId,

        @NotNull(message = "level is required")
        MembershipLevel level) {
}
