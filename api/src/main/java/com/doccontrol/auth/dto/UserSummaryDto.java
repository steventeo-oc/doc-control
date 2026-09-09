package com.doccontrol.auth.dto;

import com.doccontrol.identity.User;
import com.doccontrol.lookup.DepartmentDto;

import java.util.List;

/** Current user's profile, department and roles — the /auth/me response. */
public record UserSummaryDto(
        Integer id,
        String name,
        String email,
        DepartmentDto department,
        List<String> roles,
        boolean active) {

    public static UserSummaryDto from(User user) {
        List<String> roles = user.getRoles().stream()
                .map(userRole -> userRole.getRole().getName())
                .sorted()
                .toList();
        return new UserSummaryDto(
                user.getId(),
                user.getName(),
                user.getEmail(),
                DepartmentDto.from(user.getDepartment()),
                roles,
                user.isActive());
    }
}
