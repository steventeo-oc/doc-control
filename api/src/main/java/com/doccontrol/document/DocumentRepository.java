package com.doccontrol.document;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

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

    /**
     * The "Pending My Acknowledgment" reverse query (nav restructure
     * plan-back F2): released documents in the caller's departments whose
     * current version the caller has not acknowledged — the inverse of the
     * per-document outstandingUsers query.
     */
    @Query("""
            SELECT d FROM Document d
            WHERE d.deletedAt IS NULL
              AND d.status = com.doccontrol.document.DocumentStatus.RELEASED
              AND d.currentVersion IS NOT NULL
              AND d.department.id IN :departmentIds
              AND NOT EXISTS (
                  SELECT a FROM com.doccontrol.acknowledgment.DocumentAcknowledgment a
                  WHERE a.documentVersion.id = d.currentVersion.id
                    AND a.user.id = :userId)
            ORDER BY d.documentNumber
            """)
    List<Document> findPendingAcknowledgments(@Param("userId") Integer userId,
                                              @Param("departmentIds") Collection<Integer> departmentIds);

    Optional<Document> findFirstByDocumentTypeIdAndDepartmentIdOrderBySequenceNumberDesc(Integer documentTypeId, Integer departmentId);

    Optional<Document> findFirstByDocumentTypeIdOrderBySequenceNumberDesc(Integer documentTypeId);
}

