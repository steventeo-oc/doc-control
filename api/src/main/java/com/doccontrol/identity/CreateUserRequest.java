package com.doccontrol.identity;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * Admin-side user creation (local accounts — the spec's "if not using
 * AD/LDAP sync" case). The initial password is required for local accounts
 * and stored bcrypt-hashed. Users must belong to at least one department;
 * roles default to ["User"] when omitted.
 */
public record CreateUserRequest(
        @NotBlank @Size(max = 255) String name,
        @NotBlank @Email @Size(max = 255) String email,
        @NotEmpty List<@NotNull Integer> departmentIds,
        @NotBlank @Size(min = 8, max = 100) String password,
        List<String> roles,
        @Size(max = 255) String adUsername) {
}
