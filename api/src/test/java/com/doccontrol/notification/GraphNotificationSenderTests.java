package com.doccontrol.notification;

import com.doccontrol.config.NotificationProperties;
import com.doccontrol.identity.User;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Microsoft Graph sender against a local stub server (JDK HttpServer, no
 * Azure SDK): client-credentials token flow, sendMail payload shape, token
 * caching, and error propagation. The base URLs point at the stub via the
 * graphBaseUrl/tokenBaseUrl properties, which exist for exactly this.
 */
class GraphNotificationSenderTests {

    private HttpServer server;
    private final List<String> tokenRequests = new CopyOnWriteArrayList<>();
    private final List<Map.Entry<String, String>> sendMailRequests = new CopyOnWriteArrayList<>();
    private int sendMailStatus = 202;

    @BeforeEach
    void startStub() throws IOException {
        server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/", exchange -> {
            String path = exchange.getRequestURI().getPath();
            if (path.endsWith("/oauth2/v2.0/token")) {
                tokenRequests.add(new String(exchange.getRequestBody().readAllBytes(),
                        StandardCharsets.UTF_8));
                byte[] body = "{\"access_token\":\"stub-token\",\"expires_in\":3600}"
                        .getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, body.length);
                exchange.getResponseBody().write(body);
            } else if (path.endsWith("/sendMail")) {
                sendMailRequests.add(Map.entry(
                        exchange.getRequestHeaders().getFirst("Authorization"),
                        new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
                exchange.sendResponseHeaders(sendMailStatus, -1);
            } else {
                exchange.sendResponseHeaders(404, -1);
            }
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stopStub() {
        server.stop(0);
    }

    private GraphNotificationSender sender() {
        String base = "http://localhost:" + server.getAddress().getPort();
        NotificationProperties properties = new NotificationProperties(
                true, "stub-tenant", "stub-client", "stub-secret", "doccontrol@example.com",
                base, base);
        return new GraphNotificationSender(properties);
    }

    private User recipient() {
        User user = new User();
        user.setId(1);
        user.setName("Reviewer One");
        user.setEmail("reviewer@example.com");
        return user;
    }

    @Test
    void sendsMailViaGraphAndCachesTheToken() throws Exception {
        GraphNotificationSender sender = sender();

        sender.send(recipient(), "Approval due soon", "Please review.");

        // token flow: client credentials against the tenant's v2.0 endpoint
        assertThat(tokenRequests).hasSize(1);
        assertThat(tokenRequests.get(0))
                .contains("grant_type=client_credentials")
                .contains("client_id=stub-client")
                .contains("client_secret=stub-secret")
                .contains("scope=https%3A%2F%2Fgraph.microsoft.com%2F.default");

        // sendMail: posted from the configured mailbox to the recipient
        assertThat(sendMailRequests).hasSize(1);
        assertThat(sendMailRequests.get(0).getKey()).isEqualTo("Bearer stub-token");
        JsonNode message = new ObjectMapper().readTree(sendMailRequests.get(0).getValue());
        assertThat(message.path("message").path("subject").asText()).isEqualTo("Approval due soon");
        assertThat(message.path("message").path("body").path("content").asText())
                .isEqualTo("Please review.");
        assertThat(message.path("message").path("toRecipients").get(0)
                .path("emailAddress").path("address").asText()).isEqualTo("reviewer@example.com");
        assertThat(message.path("saveToSentItems").asBoolean()).isFalse();

        // second send reuses the cached token — no second token request
        sender.send(recipient(), "Escalation", "Still pending.");
        assertThat(tokenRequests).hasSize(1);
        assertThat(sendMailRequests).hasSize(2);
    }

    @Test
    void graphErrorsPropagateToTheCaller() throws Exception {
        sendMailStatus = 500;
        assertThatThrownBy(() -> sender().send(recipient(), "Reminder", "Body"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("500");
        assertThat(sendMailRequests).hasSize(1);
    }
}
