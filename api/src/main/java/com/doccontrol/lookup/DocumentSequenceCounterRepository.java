package com.doccontrol.lookup;

import org.springframework.data.jpa.repository.JpaRepository;

public interface DocumentSequenceCounterRepository extends JpaRepository<DocumentSequenceCounter, Integer> {
}
