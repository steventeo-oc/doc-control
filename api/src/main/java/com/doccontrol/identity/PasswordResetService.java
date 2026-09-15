package com.doccontrol.identity;

import com.doccontrol.audit.AuditService;
import com.doccontrol.audit.SystemActor;
import com.doccontrol.config.AppProperties;
import com.doccontrol.config.PasswordResetProperties;
import com.doccontrol.notification.NotificationSender;
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
    private final SecureRandom secureRandom = new SecureRandom();

    public PasswordResetService(UserRepository userRepository,
                                 PasswordResetTokenRepository tokenRepository,
                                 PasswordEncoder passwordEncoder,
                                 NotificationSender notificationSender,
                                 AuditService auditService,
                                 SystemActor systemActor,
                                 AppProperties appProperties,
                                 PasswordResetProperties resetProperties) {
        this.userRepository = userRepository;
        this.tokenRepository = tokenRepository;
        this.passwordEncoder = passwordEncoder;
        this.notificationSender = notificationSender;
        this.auditService = auditService;
        this.systemActor = systemActor;
        this.appProperties = appProperties;
        this.resetProperties = resetProperties;
    }

    /**
     * Always succeeds from the caller's perspective — never throws for a
     * nonexistent or inactive email (non-enumeration).
     */
    @Transactional
    public void requestReset(String email) {
        Optional<User> maybeUser = userRepository.findByEmailIgnoreCase(email);
        if (maybeUser.isEmpty() || !maybeUser.get().isActive()) {
            return;
        }
        User user = maybeUser.get();

        LocalDateTime now = LocalDateTime.now();
        List<PasswordResetToken> existing = tokenRepository.findByUserIdAndUsedAtIsNull(user.getId());

        // Resend cooldown: skip silently if an unexpired token was already
        // issued within the cooldown window — still no observable
        // difference to the caller.
        LocalDateTime cooldownStart = now.minusMinutes(resetProperties.resendCooldownMinutes());
        boolean withinCooldown = existing.stream()
                .anyMatch(t -> t.getExpiresAt().isAfter(now) && t.getCreatedAt().isAfter(cooldownStart));
        if (withinCooldown) {
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
        String body = "Someone requested a password reset for this account. If this was you, "
                + "click the link below within " + resetProperties.expiryMinutes()
                + " minutes to choose a new password:\n\n" + link
                + "\n\nIf you didn't request this, you can ignore this email — your password "
                + "hasn't changed.";
        notificationSender.send(user, "Reset your Document Control password", body);

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
