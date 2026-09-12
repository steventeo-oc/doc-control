package com.doccontrol.lookup;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DocumentTypeRepository extends JpaRepository<DocumentType, Integer> {

    List<DocumentType> findAllByActiveTrueOrderByCodeAsc();

    /** The includeInactive=true shape: every row, active or not. */
    List<DocumentType> findAllByOrderByCodeAsc();

    boolean existsByCode(String code);

    /** Types referencing a tier — the tier delete-blocking count (F5). */
    long countByTierId(Integer tierId);
}
