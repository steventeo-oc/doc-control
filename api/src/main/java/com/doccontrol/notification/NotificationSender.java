package com.doccontrol.notification;

import com.doccontrol.identity.User;

/**
 * Outbound notification boundary. Implementations: a log-only stub for now;
 * a Microsoft Graph (Mail.Send) implementation follows once the Azure app
 * registration and sender mailbox exist. The reminder/escalation job uses
 * this interface exclusively.
 */
public interface NotificationSender {

    void send(User recipient, String subject, String body);
}
