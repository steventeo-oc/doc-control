package com.doccontrol.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Microsoft Graph mail sending (Phase 2b, confirmed with QA — M365/Graph,
 * never generic SMTP). Disabled by default: the log-only sender stays in
 * place until doccontrol.notification.enabled=true and the Azure app
 * registration values are provided (env-overridable via
 * DOCCONTROL_NOTIFICATION_*). graphBaseUrl/tokenBaseUrl exist so tests can
 * point the sender at a stub server; never change them in deployment.
 */
@ConfigurationProperties(prefix = "doccontrol.notification")
public record NotificationProperties(
        boolean enabled,
        String tenantId,
        String clientId,
        String clientSecret,
        String senderMailbox,
        @DefaultValue("https://graph.microsoft.com") String graphBaseUrl,
        @DefaultValue("https://login.microsoftonline.com") String tokenBaseUrl) {

    /** The fail-fast check when the Graph sender is enabled. */
    public void requireComplete() {
        if (isBlank(tenantId) || isBlank(clientId) || isBlank(clientSecret) || isBlank(senderMailbox)) {
            throw new IllegalArgumentException(
                    "doccontrol.notification.enabled=true requires tenant-id, client-id, "
                            + "client-secret and sender-mailbox (DOCCONTROL_NOTIFICATION_* env vars).");
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
