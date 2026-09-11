package com.doccontrol.notification;

import com.doccontrol.config.NotificationProperties;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Sender selection (Phase 2b → Graph): the log-only stub is the default;
 * doccontrol.notification.enabled=true swaps in the Graph sender and
 * fails fast when the Azure app registration values are missing.
 */
class NotificationSenderWiringTests {

    @SpringBootTest
    @Nested
    class DefaultContext {
        @Autowired
        ApplicationContext context;

        @Test
        void logSenderIsTheDefault() {
            NotificationSender sender = context.getBean(NotificationSender.class);
            assertThat(sender).isInstanceOf(LogNotificationSender.class);
            assertThat(sender.channel()).isEqualTo("log");
        }
    }

    @SpringBootTest
    @Nested
    @TestPropertySource(properties = {
            "doccontrol.notification.enabled=true",
            "doccontrol.notification.tenant-id=tenant",
            "doccontrol.notification.client-id=client",
            "doccontrol.notification.client-secret=secret",
            "doccontrol.notification.sender-mailbox=doccontrol@example.com",
    })
    class GraphEnabledContext {
        @Autowired
        ApplicationContext context;
        @Autowired
        NotificationProperties properties;

        @Test
        void graphSenderTakesOverWhenEnabled() {
            NotificationSender sender = context.getBean(NotificationSender.class);
            assertThat(sender).isInstanceOf(GraphNotificationSender.class);
            assertThat(sender.channel()).isEqualTo("graph");
            assertThat(properties.enabled()).isTrue();
        }
    }

    @Test
    void incompleteConfigurationFailsFast() {
        NotificationProperties incomplete = new NotificationProperties(
                true, "tenant", null, "secret", "doccontrol@example.com",
                "https://graph.example.com", "https://token.example.com");
        assertThatThrownBy(incomplete::requireComplete)
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("client-id");
    }
}
