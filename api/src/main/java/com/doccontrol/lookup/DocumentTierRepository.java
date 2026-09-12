package com.doccontrol.lookup;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DocumentTierRepository extends JpaRepository<DocumentTier, Integer> {

    List<DocumentTier> findAllByOrderByTierNumberAsc();

    /** The new default shape (plan-back F2/F5): active tiers only. */
    List<DocumentTier> findAllByActiveTrueOrderByTierNumberAsc();

    boolean existsByTierNumber(Integer tierNumber);
}
