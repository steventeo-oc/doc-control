package com.doccontrol.lookup;

import com.doccontrol.identity.MembershipLevel;
import com.doccontrol.identity.UserDepartment;

/** A department's member as the Manager self-service surface reports it (plan-back F5). */
public record DepartmentMemberDto(
        Integer userId,
        String name,
        String email,
        boolean userActive,
        MembershipLevel level) {

    public static DepartmentMemberDto from(UserDepartment membership) {
        return new DepartmentMemberDto(
                membership.getUser().getId(),
                membership.getUser().getName(),
                membership.getUser().getEmail(),
                membership.getUser().isActive(),
                membership.getLevel());
    }
}
