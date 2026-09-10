package com.doccontrol.document;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.time.LocalDate;
import java.util.List;

public interface DocumentRepository extends JpaRepository<Document, Integer>, JpaSpecificationExecutor<Document> {

    /** Documents whose re-approval review-clock reset takes effect today or earlier. */
    List<Document> findAllByPendingReviewEffectiveAtLessThanEqualAndDeletedAtIsNull(LocalDate date);

    /** In-effect documents with a live review clock — the daily review sweep's candidates. */
    List<Document> findAllByNextReviewDueIsNotNullAndDeletedAtIsNullAndStatusIn(List<DocumentStatus> statuses);
}
