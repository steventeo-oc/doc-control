package com.doccontrol.audit;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;

public interface NotificationLogRepository extends JpaRepository<NotificationLog, Integer> {

    /** Escalation dedup: once per task per recipient, ever. */
    boolean existsByKindAndFlowableTaskIdAndRecipientId(
            String kind, String flowableTaskId, Integer recipientId);

    /** Reminder dedup: once per task per recipient per business date. */
    boolean existsByKindAndFlowableTaskIdAndRecipientIdAndNotificationDate(
            String kind, String flowableTaskId, Integer recipientId, LocalDate notificationDate);
}
