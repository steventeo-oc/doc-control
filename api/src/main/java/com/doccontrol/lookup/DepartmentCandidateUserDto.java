package com.doccontrol.lookup;

import com.doccontrol.identity.User;

public record DepartmentCandidateUserDto(
        Integer id,
        String name,
        String email) {

    public static DepartmentCandidateUserDto from(User user) {
        return new DepartmentCandidateUserDto(user.getId(), user.getName(), user.getEmail());
    }
}
