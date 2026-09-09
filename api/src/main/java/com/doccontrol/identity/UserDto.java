package com.doccontrol.identity;

import com.doccontrol.lookup.DepartmentDto;

import java.util.List;

/** API shape of a user — never includes credential material. */
public record UserDto(
        Integer id,
        String name,
        String email,
        DepartmentDto department,
        String adUsername,
        boolean active,
        List<String> roles) {

    public static UserDto from(User user) {
        List<String> roles = user.getRoles().stream()
                .map(userRole -> userRole.getRole().getName())
                .sorted()
                .toList();
        return new UserDto(
                user.getId(),
                user.getName(),
                user.getEmail(),
                DepartmentDto.from(user.getDepartment()),
                user.getAdUsername(),
                user.isActive(),
                roles);
    }
}
