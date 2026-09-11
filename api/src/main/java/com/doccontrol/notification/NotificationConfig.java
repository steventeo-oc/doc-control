package com.doccontrol.notification;

import com.doccontrol.config.NotificationProperties;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Sender selection: the log-only stub by default; the Microsoft Graph
 * implementation takes over when doccontrol.notification.enabled=true.
 * Mutually exclusive via the same property, so exactly one bean exists —
 * the reminder/escalation job and the completion paths need no changes.
 */
@Configuration
public class NotificationConfig {

    @Bean
    @ConditionalOnProperty(prefix = "doccontrol.notification", name = "enabled", havingValue = "true")
    public NotificationSender graphNotificationSender(NotificationProperties properties) {
        properties.requireComplete();
        return new GraphNotificationSender(properties);
    }

    @Bean
    @ConditionalOnProperty(prefix = "doccontrol.notification", name = "enabled",
            havingValue = "false", matchIfMissing = true)
    public NotificationSender logNotificationSender() {
        return new LogNotificationSender();
    }
}
