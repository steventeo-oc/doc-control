package com.doccontrol.document;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface DocumentVersionRepository extends JpaRepository<DocumentVersion, Integer> {

    @Query("SELECT MAX(v.versionNumber) FROM DocumentVersion v WHERE v.document.id = :documentId")
    Integer findMaxVersionNumber(@Param("documentId") Integer documentId);

    List<DocumentVersion> findAllByDocumentIdOrderByVersionNumberAsc(Integer documentId);

    List<DocumentVersion> findAllByDocumentIdAndStatus(Integer documentId, DocumentVersionStatus status);

    /** Draft versions across a batch of documents. */
    @Query("SELECT v FROM DocumentVersion v " +
            "JOIN FETCH v.document d " +
            "WHERE d.id IN :documentIds " +
            "AND v.status = com.doccontrol.document.DocumentVersionStatus.DRAFT")
    List<DocumentVersion> findDraftsByDocumentIdIn(@Param("documentIds") Collection<Integer> documentIds);

    /** Pending effectivity flips: approved versions whose effective date has arrived. */
    List<DocumentVersion> findAllByStatusAndEffectiveAtLessThanEqualAndDocument_DeletedAtIsNull(
            DocumentVersionStatus status, LocalDate effectiveAt);

    /** Phase 2e catch-up: versions that became effective on the given date. */
    List<DocumentVersion> findAllByStatusAndEffectiveAtAndDocument_DeletedAtIsNull(
            DocumentVersionStatus status, LocalDate effectiveAt);

    Optional<DocumentVersion> findTopByDocument_IdOrderByVersionNumberDesc(Integer documentId);
}
