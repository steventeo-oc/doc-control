package com.doccontrol.notification;

import com.doccontrol.identity.User;

/**
 * Outbound notification boundary. Implementations: a log-only stub (the
 * default) and a Microsoft Graph (Mail.Send) implementation used when
 * doccontrol.notification.enabled=true. The reminder/escalation job and
 * the completion paths use this interface exclusively.
 */
public interface NotificationSender {

    void send(User recipient, String subject, String body);

    /** The transport identifier recorded in notification_log ('log' / 'graph'). */
    default String channel() {
        return "log";
    }
}
