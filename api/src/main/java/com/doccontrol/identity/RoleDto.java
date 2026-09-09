package com.doccontrol.identity;

public record RoleDto(Integer id, String name) {

    public static RoleDto from(Role role) {
        return new RoleDto(role.getId(), role.getName());
    }
}
