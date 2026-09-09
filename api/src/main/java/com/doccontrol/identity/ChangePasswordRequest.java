package com.doccontrol.identity;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Self-service changes must carry the current password (proof of authority
 * over the account); admin resets of other accounts do not.
 */
public record ChangePasswordRequest(
        String currentPassword,
        @NotBlank @Size(min = 8, max = 100) String newPassword) {
}
