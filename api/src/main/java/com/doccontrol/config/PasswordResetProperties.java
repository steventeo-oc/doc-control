package com.doccontrol.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties(prefix = "doccontrol.password-reset")
public record PasswordResetProperties(
        @DefaultValue("30") int expiryMinutes,
        @DefaultValue("2") int resendCooldownMinutes) {
}
