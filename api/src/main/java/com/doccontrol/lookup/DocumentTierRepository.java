package com.doccontrol.lookup;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DocumentTierRepository extends JpaRepository<DocumentTier, Integer> {

    List<DocumentTier> findAllByOrderByTierNumberAsc();
}
