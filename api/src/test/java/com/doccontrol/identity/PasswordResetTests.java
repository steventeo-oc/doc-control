package com.doccontrol.identity;

import com.doccontrol.CsrfTestSupport;
import com.doccontrol.audit.AuditLog;
import com.doccontrol.audit.AuditLogRepository;
import com.doccontrol.auth.dto.ForgotPasswordRequest;
import com.doccontrol.auth.dto.ResetPasswordRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.doccontrol.config.PasswordResetProperties;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static com.doccontrol.CsrfTestSupport.csrf;

/**
 * Exercises the forgot-password flow end to end against the live database
 * (ForgotPassword_PlanBack.md). See PasswordResetService for the security
 * reasoning behind each assertion here — this test proves that reasoning
 * holds, it doesn't restate it.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(CsrfTestSupport.class)
@Transactional
class PasswordResetTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    UserRepository userRepository;

    @Autowired
    PasswordResetTokenRepository tokenRepository;

    @Autowired
    AuditLogRepository auditLogRepository;

    @Autowired
    PasswordEncoder passwordEncoder;

    @Autowired
    PasswordResetProperties resetProperties;

    @Test
    void requestingResetForKnownEmailCreatesTokenAndAuditsTheRequest() throws Exception {
        User user = createActiveUser("known");

        mockMvc.perform(forgotPassword(user.getEmail()))
                .andExpect(status().isAccepted());

        List<PasswordResetToken> tokens = tokenRepository.findByUserIdAndUsedAtIsNull(user.getId());
        assertThat(tokens).hasSize(1);
        assertThat(tokens.get(0).getTokenHash()).isNotBlank();
        assertThat(tokens.get(0).getExpiresAt()).isAfter(LocalDateTime.now());

        boolean requestAudited = auditLogRepository.findAll().stream()
                .anyMatch(a -> "user".equals(a.getEntityType())
                        && user.getId().equals(a.getEntityId())
                        && "password_reset_requested".equals(a.getAction()));
        assertThat(requestAudited).isTrue();
    }

    @Test
    void requestingResetForUnknownEmailReturnsIdenticalResponseAndCreatesNothing() throws Exception {
        User user = createActiveUser("compare");

        MvcResult known = mockMvc.perform(forgotPassword(user.getEmail()))
                .andExpect(status().isAccepted())
                .andReturn();
        MvcResult unknown = mockMvc.perform(forgotPassword("nobody-" + System.nanoTime() + "@doccontrol.test"))
                .andExpect(status().isAccepted())
                .andReturn();

        // Non-enumeration: identical status AND identical body — the whole
        // point is a bogus email is indistinguishable from a real one.
        assertThat(unknown.getResponse().getStatus()).isEqualTo(known.getResponse().getStatus());
        assertThat(unknown.getResponse().getContentAsString())
                .isEqualTo(known.getResponse().getContentAsString());
    }

    @Test
    void secondRequestWithinCooldownCreatesNoNewToken() throws Exception {
        User user = createActiveUser("cooldown");

        mockMvc.perform(forgotPassword(user.getEmail())).andExpect(status().isAccepted());
        String firstHash = tokenRepository.findByUserIdAndUsedAtIsNull(user.getId()).get(0).getTokenHash();

        mockMvc.perform(forgotPassword(user.getEmail())).andExpect(status().isAccepted());

        List<PasswordResetToken> tokens = tokenRepository.findByUserIdAndUsedAtIsNull(user.getId());
        assertThat(tokens).hasSize(1);
        assertThat(tokens.get(0).getTokenHash()).isEqualTo(firstHash); // unchanged, not superseded
    }

    @Test
    void requestOutsideCooldownWindowSupersedesThePriorToken() throws Exception {
        User user = createActiveUser("supersede");

        mockMvc.perform(forgotPassword(user.getEmail())).andExpect(status().isAccepted());
        PasswordResetToken first = tokenRepository.findByUserIdAndUsedAtIsNull(user.getId()).get(0);
        String firstHash = first.getTokenHash();

        // Push the existing token's createdAt outside the cooldown window
        // directly — no real sleeping in a test.
        first.setCreatedAt(LocalDateTime.now().minusMinutes(resetProperties.resendCooldownMinutes() + 1));
        tokenRepository.save(first);

        mockMvc.perform(forgotPassword(user.getEmail())).andExpect(status().isAccepted());

        List<PasswordResetToken> tokens = tokenRepository.findByUserIdAndUsedAtIsNull(user.getId());
        assertThat(tokens).hasSize(1); // old one deleted, not accumulated
        assertThat(tokens.get(0).getTokenHash()).isNotEqualTo(firstHash);
    }

    @Test
    void validTokenResetsPasswordAndOldPasswordNoLongerWorks() throws Exception {
        User user = createActiveUser("reset-success");
        String rawToken = "raw-" + System.nanoTime();
        insertToken(user, rawToken, LocalDateTime.now().plusMinutes(30), null);

        mockMvc.perform(resetPassword(rawToken, "brand-new-pass-1"))
                .andExpect(status().isNoContent());

        User reloaded = userRepository.findById(user.getId()).orElseThrow();
        assertThat(passwordEncoder.matches("brand-new-pass-1", reloaded.getPasswordHash())).isTrue();
        assertThat(passwordEncoder.matches("pw-" + user.getEmail(), reloaded.getPasswordHash())).isFalse();
    }

    @Test
    void successfulResetWritesPasswordChangedAuditRowWithEmailResetDetail() throws Exception {
        User user = createActiveUser("reset-audit");
        String rawToken = "raw-" + System.nanoTime();
        insertToken(user, rawToken, LocalDateTime.now().plusMinutes(30), null);

        mockMvc.perform(resetPassword(rawToken, "brand-new-pass-2"))
                .andExpect(status().isNoContent());

        AuditLog row = auditLogRepository.findAll().stream()
                .filter(a -> "user".equals(a.getEntityType())
                        && user.getId().equals(a.getEntityId())
                        && "password_changed".equals(a.getAction()))
                .reduce((first, second) -> second) // most recent
                .orElseThrow(() -> new AssertionError("Expected a password_changed audit row"));
        assertThat(row.getDetails()).containsEntry("self_service", false);
        assertThat(row.getDetails()).containsEntry("via", "email_reset");
    }

    @Test
    void expiredTokenIsRejectedWithGenericMessage() throws Exception {
        User user = createActiveUser("expired");
        String rawToken = "raw-" + System.nanoTime();
        insertToken(user, rawToken, LocalDateTime.now().minusMinutes(1), null); // already expired

        mockMvc.perform(resetPassword(rawToken, "irrelevant-pass-1"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void usedTokenCannotBeReplayed() throws Exception {
        User user = createActiveUser("replay");
        String rawToken = "raw-" + System.nanoTime();
        insertToken(user, rawToken, LocalDateTime.now().plusMinutes(30), null);

        mockMvc.perform(resetPassword(rawToken, "first-use-pass-1"))
                .andExpect(status().isNoContent());
        mockMvc.perform(resetPassword(rawToken, "second-use-pass-1"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void bogusExpiredAndUsedTokensAllReturnTheIdenticalErrorBody() throws Exception {
        User bogusUser = createActiveUser("bogus-compare");
        String usedToken = "raw-" + System.nanoTime();
        insertToken(bogusUser, usedToken, LocalDateTime.now().plusMinutes(30), LocalDateTime.now());
        String expiredToken = "raw-" + (System.nanoTime() + 1);
        insertToken(bogusUser, expiredToken, LocalDateTime.now().minusMinutes(1), null);

        MvcResult bogus = mockMvc.perform(resetPassword("totally-made-up-token", "x-pass-12345678"))
                .andExpect(status().isBadRequest()).andReturn();
        MvcResult used = mockMvc.perform(resetPassword(usedToken, "x-pass-12345678"))
                .andExpect(status().isBadRequest()).andReturn();
        MvcResult expired = mockMvc.perform(resetPassword(expiredToken, "x-pass-12345678"))
                .andExpect(status().isBadRequest()).andReturn();

        String bogusBody = bogus.getResponse().getContentAsString();
        assertThat(used.getResponse().getContentAsString()).isEqualTo(bogusBody);
        assertThat(expired.getResponse().getContentAsString()).isEqualTo(bogusBody);
    }

    // --- helpers ---

    private MockHttpServletRequestBuilder forgotPassword(String email) throws Exception {
        return post("/auth/forgot-password").with(csrf())
                .contentType("application/json")
                .content(objectMapper.writeValueAsString(new ForgotPasswordRequest(email)));
    }

    private MockHttpServletRequestBuilder resetPassword(String token, String newPassword) throws Exception {
        return post("/auth/reset-password").with(csrf())
                .contentType("application/json")
                .content(objectMapper.writeValueAsString(new ResetPasswordRequest(token, newPassword)));
    }

    private User createActiveUser(String prefix) {
        User user = new User();
        user.setName(prefix + System.nanoTime() + "@doccontrol.test");
        user.setEmail(user.getName());
        user.setPasswordHash(passwordEncoder.encode("pw-" + user.getEmail()));
        user.setActive(true);
        return userRepository.save(user);
    }

    private void insertToken(User user, String rawToken, LocalDateTime expiresAt, LocalDateTime usedAt) {
        PasswordResetToken token = new PasswordResetToken();
        token.setUser(user);
        token.setTokenHash(sha256Hex(rawToken));
        token.setCreatedAt(LocalDateTime.now());
        token.setExpiresAt(expiresAt);
        token.setUsedAt(usedAt);
        tokenRepository.save(token);
    }

    /** Duplicated on purpose (not reaching into PasswordResetService's
     *  private hash() method) — a tiny, obviously-correct pure function is
     *  fine to mirror in a test rather than loosening production encapsulation. */
    private static String sha256Hex(String rawToken) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest(rawToken.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(hashed.length * 2);
            for (byte b : hashed) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
