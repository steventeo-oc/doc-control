package com.doccontrol.auth.dto;

import com.doccontrol.identity.DepartmentMembershipDto;
import com.doccontrol.identity.User;
import com.doccontrol.identity.UserDepartment;

import java.util.Comparator;
import java.util.List;

/** Current user's profile, departments (with membership levels) and roles — the /auth/me response. */
public record UserSummaryDto(
        Integer id,
        String name,
        String email,
        List<DepartmentMembershipDto> departments,
        List<String> roles,
        boolean active) {

    public static UserSummaryDto from(User user) {
        List<String> roles = user.getRoles().stream()
                .map(userRole -> userRole.getRole().getName())
                .sorted()
                .toList();
        List<DepartmentMembershipDto> departments = user.getDepartments().stream()
                .sorted(Comparator.comparing(membership -> membership.getDepartment().getCode()))
                .map(DepartmentMembershipDto::from)
                .toList();
        return new UserSummaryDto(
                user.getId(),
                user.getName(),
                user.getEmail(),
                departments,
                roles,
                user.isActive());
    }
}
