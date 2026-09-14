package com.doccontrol.identity;

import com.doccontrol.lookup.DepartmentDto;

/** A membership as the API reports it: the department plus its level (plan-back F1). */
public record DepartmentMembershipDto(
        Integer id,
        String code,
        String label,
        boolean active,
        MembershipLevel level) {

    public static DepartmentMembershipDto from(UserDepartment membership) {
        DepartmentDto department = DepartmentDto.from(membership.getDepartment());
        return new DepartmentMembershipDto(
                department.id(),
                department.code(),
                department.label(),
                department.active(),
                membership.getLevel());
    }
}
