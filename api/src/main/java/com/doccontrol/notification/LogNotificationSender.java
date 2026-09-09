package com.doccontrol.notification;

import com.doccontrol.identity.User;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Development stub: writes the notification to the application log instead
 * of sending mail. Replaced by the Microsoft Graph implementation without
 * touching any caller (see go-live checklist — M365 prerequisites are
 * handled operationally).
 */
@Component
public class LogNotificationSender implements NotificationSender {

    private static final Logger log = LoggerFactory.getLogger(LogNotificationSender.class);

    @Override
    public void send(User recipient, String subject, String body) {
        log.info("NOTIFICATION (log-only) to {} <{}>: {} - {}", recipient.getName(), recipient.getEmail(),
                subject, body);
    }
}
