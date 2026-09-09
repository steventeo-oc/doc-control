package com.doccontrol.identity;

import com.doccontrol.lookup.DepartmentDto;

import java.util.Comparator;
import java.util.List;

/** API shape of a user — never includes credential material. */
public record UserDto(
        Integer id,
        String name,
        String email,
        List<DepartmentDto> departments,
        String adUsername,
        boolean active,
        List<String> roles) {

    public static UserDto from(User user) {
        List<String> roles = user.getRoles().stream()
                .map(userRole -> userRole.getRole().getName())
                .sorted()
                .toList();
        List<DepartmentDto> departments = user.getDepartments().stream()
                .map(UserDepartment::getDepartment)
                .sorted(Comparator.comparing(com.doccontrol.lookup.Department::getCode))
                .map(DepartmentDto::from)
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
