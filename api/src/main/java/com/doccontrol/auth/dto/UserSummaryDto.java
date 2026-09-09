package com.doccontrol.auth.dto;

import com.doccontrol.identity.User;
import com.doccontrol.identity.UserDepartment;
import com.doccontrol.lookup.DepartmentDto;

import java.util.List;

/** Current user's profile, departments and roles — the /auth/me response. */
public record UserSummaryDto(
        Integer id,
        String name,
        String email,
        List<DepartmentDto> departments,
        List<String> roles,
        boolean active) {

    public static UserSummaryDto from(User user) {
        List<String> roles = user.getRoles().stream()
                .map(userRole -> userRole.getRole().getName())
                .sorted()
                .toList();
        List<DepartmentDto> departments = user.getDepartments().stream()
                .map(UserDepartment::getDepartment)
                .sorted(java.util.Comparator.comparing(com.doccontrol.lookup.Department::getCode))
                .map(DepartmentDto::from)
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
