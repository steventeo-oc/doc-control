package com.doccontrol.acknowledgment;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface DocumentAcknowledgmentRepository extends JpaRepository<DocumentAcknowledgment, Integer> {

    Optional<DocumentAcknowledgment> findByDocumentVersionIdAndUserId(Integer documentVersionId, Integer userId);

    List<DocumentAcknowledgment> findAllByDocumentVersionIdOrderByAcknowledgedAtAsc(Integer documentVersionId);

    boolean existsByDocumentVersionIdAndUserId(Integer documentVersionId, Integer userId);
}
