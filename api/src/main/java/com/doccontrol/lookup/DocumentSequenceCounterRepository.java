package com.doccontrol.lookup;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface DocumentSequenceCounterRepository extends JpaRepository<DocumentSequenceCounter, Integer> {

    /**
     * Atomically allocate-or-create the counter row for a (type, department)
     * pair and lock it until the end of the transaction: the INSERT ... ON
     * CONFLICT DO UPDATE takes the row lock (a concurrent creator for the
     * same pair blocks here until the first transaction commits), and
     * RETURNING hands back the current next_sequence_number. The caller must
     * advance the counter afterwards via {@link #advance}. Gaps are expected
     * and fine (CLAUDE.md convention 1) — a rolled-back transaction keeps its
     * number.
     */
    @Query(value = """
            INSERT INTO document_sequence_counter (document_type_id, department_id, next_sequence_number)
            VALUES (:typeId, :deptId, 1)
            ON CONFLICT (document_type_id, department_id)
            DO UPDATE SET next_sequence_number = document_sequence_counter.next_sequence_number
            RETURNING id, next_sequence_number
            """, nativeQuery = true)
    List<Object[]> lockAndReadNext(@Param("typeId") Integer typeId, @Param("deptId") Integer deptId);

    @Modifying
    @Query(value = "UPDATE document_sequence_counter SET next_sequence_number = :next WHERE id = :id", nativeQuery = true)
    void advance(@Param("id") Integer id, @Param("next") Integer next);
}
