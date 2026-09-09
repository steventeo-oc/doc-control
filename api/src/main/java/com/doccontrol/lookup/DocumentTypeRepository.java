package com.doccontrol.lookup;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DocumentTypeRepository extends JpaRepository<DocumentType, Integer> {

    List<DocumentType> findAllByActiveTrueOrderByCodeAsc();

    boolean existsByCode(String code);
}
