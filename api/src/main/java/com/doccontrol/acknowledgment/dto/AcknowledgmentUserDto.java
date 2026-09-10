package com.doccontrol.acknowledgment.dto;

import com.doccontrol.identity.User;

/** Minimal user projection inside acknowledgment status responses. */
public record AcknowledgmentUserDto(Integer userId, String userName) {

    public static AcknowledgmentUserDto from(User user) {
        return new AcknowledgmentUserDto(user.getId(), user.getName());
    }
}
