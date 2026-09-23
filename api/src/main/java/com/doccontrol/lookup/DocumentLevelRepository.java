package com.doccontrol.lookup;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DocumentLevelRepository extends JpaRepository<DocumentLevel, Integer> {

    List<DocumentLevel> findAllByOrderByLevelNumberAsc();

    /** The new default shape (plan-back F2/F5): active levels only. */
    List<DocumentLevel> findAllByActiveTrueOrderByLevelNumberAsc();

    boolean existsByLevelNumber(Integer levelNumber);
}
