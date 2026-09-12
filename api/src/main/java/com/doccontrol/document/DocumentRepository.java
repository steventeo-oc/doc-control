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

    /** Released, non-trashed documents — the acknowledgment sweep's candidates. */
    List<Document> findAllByStatusAndDeletedAtIsNull(DocumentStatus status);

    /**
     * All documents referencing a lookup row, soft-deleted ones included —
     * a lookup's FKs are as live as ever after a soft delete, so the
     * delete-blocking count must include them (lookup plan-back D3).
     */
    long countByDepartmentId(Integer departmentId);

    long countByDocumentTypeId(Integer documentTypeId);
}
