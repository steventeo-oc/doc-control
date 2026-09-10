package com.doccontrol.acknowledgment;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface DocumentAcknowledgmentAccessRepository extends JpaRepository<DocumentAcknowledgmentAccess, Integer> {

    boolean existsByDocumentIdAndUserId(Integer documentId, Integer userId);

    Optional<DocumentAcknowledgmentAccess> findByDocumentIdAndUserId(Integer documentId, Integer userId);

    List<DocumentAcknowledgmentAccess> findAllByDocumentId(Integer documentId);
}
