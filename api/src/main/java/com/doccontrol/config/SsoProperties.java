package com.doccontrol.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * "Sign in with Microsoft" OIDC login (Microsoft_SSO_PlanBack.md, F1/F2).
 * Disabled by default: deployments without Azure credentials see no change
 * at all. Per F1 the credentials are the SAME Azure app registration the
 * Graph mail sender uses — the values are the existing
 * DOCCONTROL_NOTIFICATION_* env vars (wired in application.yml); the only
 * new variable is DOCCONTROL_SSO_ENABLED.
 */
@ConfigurationProperties(prefix = "doccontrol.auth.sso")
public record SsoProperties(
        boolean enabled,
        String tenantId,
        String clientId,
        String clientSecret) {

    /** The fail-fast check when SSO is enabled (mirrors NotificationProperties). */
    public void requireComplete() {
        if (isBlank(tenantId) || isBlank(clientId) || isBlank(clientSecret)) {
            throw new IllegalArgumentException(
                    "doccontrol.auth.sso.enabled=true requires tenant-id, client-id and "
                            + "client-secret — they reuse the DOCCONTROL_NOTIFICATION_* env vars "
                            + "of the shared Azure app registration (F1).");
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
