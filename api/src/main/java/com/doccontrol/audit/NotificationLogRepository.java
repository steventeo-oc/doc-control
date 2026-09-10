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

    /** Once-per-cycle dedup via a stable key (e.g. review-overdue:doc=8:due=2026-10-01). */
    boolean existsByKindAndDedupKeyAndRecipientId(String kind, String dedupKey, Integer recipientId);

    /** Document-anchored reminder dedup: once per document per recipient per business date. */
    boolean existsByKindAndDocumentIdAndRecipientIdAndNotificationDate(
            String kind, Integer documentId, Integer recipientId, LocalDate notificationDate);
}
