package com.doccontrol.document;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface DocumentVersionRepository extends JpaRepository<DocumentVersion, Integer> {

    @Query("SELECT COALESCE(MAX(v.versionNumber), 0) FROM DocumentVersion v WHERE v.document.id = :documentId")
    int findMaxVersionNumber(@Param("documentId") Integer documentId);

    List<DocumentVersion> findAllByDocumentIdOrderByVersionNumberAsc(Integer documentId);

    List<DocumentVersion> findAllByDocumentIdAndStatus(Integer documentId, DocumentVersionStatus status);

    /** Pending effectivity flips: approved versions whose effective date has arrived. */
    List<DocumentVersion> findAllByStatusAndEffectiveAtLessThanEqualAndDocument_DeletedAtIsNull(
            DocumentVersionStatus status, LocalDate effectiveAt);

    Optional<DocumentVersion> findTopByDocument_IdOrderByVersionNumberDesc(Integer documentId);
}
