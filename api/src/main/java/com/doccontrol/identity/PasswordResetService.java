package com.doccontrol.identity;

import com.doccontrol.audit.AuditService;
import com.doccontrol.audit.SystemActor;
import com.doccontrol.config.AppProperties;
import com.doccontrol.config.PasswordResetProperties;
import com.doccontrol.notification.NotificationSender;
import com.doccontrol.notification.NotificationTemplateService;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Self-service "forgot password" flow (ForgotPassword_PlanBack.md).
 * Deliberately never reveals whether an email is registered — requestReset
 * returns void and behaves identically whether or not a user was found.
 */
@Service
public class PasswordResetService {

    private final UserRepository userRepository;
    private final PasswordResetTokenRepository tokenRepository;
    private final PasswordEncoder passwordEncoder;
    private final NotificationSender notificationSender;
    private final AuditService auditService;
    private final SystemActor systemActor;
    private final AppProperties appProperties;
    private final PasswordResetProperties resetProperties;
    private final NotificationTemplateService templateService;
    private final SecureRandom secureRandom = new SecureRandom();

    public PasswordResetService(UserRepository userRepository,
                                 PasswordResetTokenRepository tokenRepository,
                                 PasswordEncoder passwordEncoder,
                                 NotificationSender notificationSender,
                                 AuditService auditService,
                                 SystemActor systemActor,
                                 AppProperties appProperties,
                                 PasswordResetProperties resetProperties,
                                 NotificationTemplateService templateService) {
        this.userRepository = userRepository;
        this.tokenRepository = tokenRepository;
        this.passwordEncoder = passwordEncoder;
        this.notificationSender = notificationSender;
        this.auditService = auditService;
        this.systemActor = systemActor;
        this.appProperties = appProperties;
        this.resetProperties = resetProperties;
        this.templateService = templateService;
    }

    /**
     * Always succeeds from the caller's perspective — never throws for a
     * nonexistent or inactive email (non-enumeration).
     */
    @Transactional
    public void requestReset(String rawEmail) {
        if (rawEmail == null || rawEmail.isBlank()) {
            return;
        }

        String email = rawEmail.trim().toLowerCase();
        User user = userRepository.findByEmailIgnoreCase(email).orElse(null);

        // Non-enumeration: silent return for nonexistent or inactive accounts
        if (user == null || !user.isActive()) {
            return;
        }

        LocalDateTime now = LocalDateTime.now();

        // Rate-limit: if a token was already issued recently, silently ignore
        // the request so a mail storm cannot be triggered.
        List<PasswordResetToken> existing = tokenRepository.findByUserIdAndUsedAtIsNull(user.getId());
        boolean inCooldown = existing.stream().anyMatch(t ->
                t.getCreatedAt().plusMinutes(resetProperties.resendCooldownMinutes()).isAfter(now));
        if (inCooldown) {
            return;
        }

        // Supersede: at most one live token per user at a time.
        tokenRepository.deleteAll(existing);

        String rawToken = generateRawToken();
        PasswordResetToken token = new PasswordResetToken();
        token.setUser(user);
        token.setTokenHash(hash(rawToken));
        token.setCreatedAt(now);
        token.setExpiresAt(now.plusMinutes(resetProperties.expiryMinutes()));
        tokenRepository.save(token);

        String link = appProperties.baseUrl() + "/reset-password?token=" + rawToken;

        Map<String, String> details = new java.util.LinkedHashMap<>();
        details.put("Account", user.getEmail());
        details.put("Expires In", resetProperties.expiryMinutes() + " minutes");

        String leadParagraph = "Someone requested a password reset for your account. If this was you, "
                + "click the button below within " + resetProperties.expiryMinutes() + " minutes to choose a new password. "
                + "If you didn't request this, you can safely ignore this email — your password hasn't changed.";

        NotificationTemplateService.EmailContent content = templateService.render(
                user.getName(),
                "Password Reset",
                NotificationTemplateService.BadgeStyle.BLUE,
                "Reset Your Password",
                leadParagraph,
                details,
                null,
                null,
                "Reset Password",
                link
        );

        notificationSender.sendHtml(user, "Reset your Document Control password",
                content.textBody(), content.htmlBody());

        auditService.recordAs(systemActor.get(), "user", user.getId(), "password_reset_requested",
                Map.of());
    }

    /**
     * Throws IllegalArgumentException (-> 400 via GlobalExceptionHandler) for
     * every failure case alike — invalid, expired, and already-used tokens
     * all get the identical message (non-enumeration).
     */
    @Transactional
    public void resetPassword(String rawToken, String newPassword) {
        PasswordResetToken token = tokenRepository.findByTokenHash(hash(rawToken))
                .filter(t -> t.getUsedAt() == null)
                .filter(t -> t.getExpiresAt().isAfter(LocalDateTime.now()))
                .orElseThrow(() -> new IllegalArgumentException(
                        "This reset link is invalid or has expired."));

        User user = token.getUser();
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        token.setUsedAt(LocalDateTime.now());

        auditService.recordAs(user, "user", user.getId(), "password_changed",
                Map.of("self_service", false, "via", "email_reset"));
    }

    private String generateRawToken() {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String hash(String rawToken) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest(rawToken.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(hashed.length * 2);
            for (byte b : hashed) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
