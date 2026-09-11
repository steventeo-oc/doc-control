package com.doccontrol.notification;

import com.doccontrol.config.NotificationProperties;
import com.doccontrol.identity.User;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;

/**
 * Microsoft Graph mail sender (Phase 2b, confirmed with QA: M365/Graph,
 * never generic SMTP). Sends from the configured sender mailbox via
 * Mail.Send with client-credentials auth. Activated by
 * doccontrol.notification.enabled=true (see NotificationConfig); failures
 * throw so the caller's per-item error handling applies — a broken Graph
 * must not silently swallow notifications.
 *
 * Deliberately uses the JDK HTTP client and raw Graph JSON — no Azure SDK
 * dependency for a single sendMail call. Tokens are cached until shortly
 * before expiry.
 */
public class GraphNotificationSender implements NotificationSender {

    private static final Logger log = LoggerFactory.getLogger(GraphNotificationSender.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    private final NotificationProperties properties;
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    private volatile CachedToken cachedToken;

    private record CachedToken(String value, Instant expiresAt) {
    }

    public GraphNotificationSender(NotificationProperties properties) {
        properties.requireComplete();
        this.properties = properties;
    }

    @Override
    public String channel() {
        return "graph";
    }

    @Override
    public void send(User recipient, String subject, String body) {
        String sendMailUrl = properties.graphBaseUrl() + "/v1.0/users/"
                + properties.senderMailbox() + "/sendMail";
        String payload;
        try {
            payload = JSON.writeValueAsString(Map.of(
                    "message", Map.of(
                            "subject", subject,
                            "body", Map.of("contentType", "Text", "content", body),
                            "toRecipients", java.util.List.of(Map.of(
                                    "emailAddress", Map.of("address", recipient.getEmail())))),
                    "saveToSentItems", false));
        } catch (IOException e) {
            throw new IllegalStateException("Could not serialize Graph message", e);
        }

        HttpRequest request = HttpRequest.newBuilder(URI.create(sendMailUrl))
                .timeout(Duration.ofSeconds(30))
                .header("Authorization", "Bearer " + accessToken())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(payload, StandardCharsets.UTF_8))
                .build();
        HttpResponse<String> response = exchange(request);
        if (response.statusCode() >= 300) {
            throw new IllegalStateException("Graph sendMail failed with HTTP "
                    + response.statusCode() + ": " + truncate(response.body()));
        }
        log.info("NOTIFICATION (graph) to {} <{}>: {}", recipient.getName(), recipient.getEmail(),
                subject);
    }

    /** Client-credentials token from the tenant's v2.0 endpoint, cached until shortly before expiry. */
    private String accessToken() {
        CachedToken cached = cachedToken;
        if (cached != null && Instant.now().isBefore(cached.expiresAt())) {
            return cached.value();
        }
        String tokenUrl = properties.tokenBaseUrl() + "/" + properties.tenantId()
                + "/oauth2/v2.0/token";
        String form = "grant_type=client_credentials"
                + "&client_id=" + urlEncode(properties.clientId())
                + "&client_secret=" + urlEncode(properties.clientSecret())
                + "&scope=" + urlEncode("https://graph.microsoft.com/.default");
        HttpRequest request = HttpRequest.newBuilder(URI.create(tokenUrl))
                .timeout(Duration.ofSeconds(30))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(form, StandardCharsets.UTF_8))
                .build();
        HttpResponse<String> response = exchange(request);
        if (response.statusCode() >= 300) {
            throw new IllegalStateException("Graph token request failed with HTTP "
                    + response.statusCode() + ": " + truncate(response.body()));
        }
        JsonNode json;
        try {
            json = JSON.readTree(response.body());
        } catch (IOException e) {
            throw new IllegalStateException("Graph token response was not valid JSON", e);
        }
        String token = json.path("access_token").asText(null);
        if (token == null || token.isBlank()) {
            throw new IllegalStateException("Graph token response carried no access_token");
        }
        long expiresInSeconds = json.path("expires_in").asLong(3600);
        // refresh a minute early so a sweep never runs on a just-expired token
        cachedToken = new CachedToken(token, Instant.now().plusSeconds(Math.max(60, expiresInSeconds - 60)));
        return token;
    }

    private HttpResponse<String> exchange(HttpRequest request) {
        try {
            return http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new IllegalStateException("Graph request to " + request.uri().getHost() + " failed: "
                    + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Graph request interrupted", e);
        }
    }

    private static String urlEncode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static String truncate(String value) {
        if (value == null) {
            return "";
        }
        // keep responses out of logs at a sane size; they can carry tenant details
        String oneLine = value.replaceAll("\\s+", " ").trim();
        return oneLine.length() <= 300 ? oneLine : oneLine.substring(0, 300) + "…";
    }
}
