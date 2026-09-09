package com.doccontrol.identity;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for the development-default credential guard on the bootstrap
 * admin (warn in dev, hard fail under a prod-like profile).
 */
class AdminBootstrapDefaultsGuardTest {

    @Test
    void devDefaultsAreDetected() {
        assertThat(AdminBootstrap.usesDevelopmentDefaults(
                AdminBootstrap.DEV_DEFAULT_EMAIL, AdminBootstrap.DEV_DEFAULT_PASSWORD)).isTrue();
        assertThat(AdminBootstrap.usesDevelopmentDefaults(
                AdminBootstrap.DEV_DEFAULT_EMAIL, "something-else")).isTrue();
        assertThat(AdminBootstrap.usesDevelopmentDefaults(
                "ops@company.example", AdminBootstrap.DEV_DEFAULT_PASSWORD)).isTrue();
        assertThat(AdminBootstrap.usesDevelopmentDefaults(
                "ops@company.example", "real-password-here")).isFalse();
        // case-insensitive on the email only
        assertThat(AdminBootstrap.usesDevelopmentDefaults(
                "Admin@DocControl.Local", "real-password-here")).isTrue();
    }

    @Test
    void prodLikeProfilesAreRecognized() {
        assertThat(AdminBootstrap.isProdLikeProfile("prod")).isTrue();
        assertThat(AdminBootstrap.isProdLikeProfile("production")).isTrue();
        assertThat(AdminBootstrap.isProdLikeProfile("dev", "PROD")).isTrue();
        assertThat(AdminBootstrap.isProdLikeProfile()).isFalse();
        assertThat(AdminBootstrap.isProdLikeProfile("dev")).isFalse();
        assertThat(AdminBootstrap.isProdLikeProfile("staging")).isFalse();
    }
}
