package com.doccontrol.identity;

import java.util.Comparator;
import java.util.List;

/** API shape of a user — never includes credential material. */
public record UserDto(
        Integer id,
        String name,
        String email,
        List<DepartmentMembershipDto> departments,
        String adUsername,
        boolean active,
        List<String> roles) {

    public static UserDto from(User user) {
        List<String> roles = user.getRoles().stream()
                .map(userRole -> userRole.getRole().getName())
                .sorted()
                .toList();
        List<DepartmentMembershipDto> departments = user.getDepartments().stream()
                .sorted(Comparator.comparing(membership -> membership.getDepartment().getCode()))
                .map(DepartmentMembershipDto::from)
                .toList();
        return new UserDto(
                user.getId(),
                user.getName(),
                user.getEmail(),
                departments,
                user.getAdUsername(),
                user.isActive(),
                roles);
    }
}
