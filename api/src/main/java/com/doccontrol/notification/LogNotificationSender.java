package com.doccontrol.notification;

import com.doccontrol.identity.User;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Writes the notification to the application log instead of sending mail.
 * The default sender; the Microsoft Graph implementation takes over when
 * doccontrol.notification.enabled=true (see NotificationConfig).
 */
public class LogNotificationSender implements NotificationSender {

    private static final Logger log = LoggerFactory.getLogger(LogNotificationSender.class);

    @Override
    public void send(User recipient, String subject, String body) {
        log.info("NOTIFICATION (log-only) to {} <{}>: {} - {}", recipient.getName(), recipient.getEmail(),
                subject, body);
    }
}
