package com.doccontrol.lookup;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Lookup table — extensible by data, never a hardcoded enum (CLAUDE.md
 * convention 3). Level 1-4 today; a 5th level would be a row insert.
 */
@Entity
@Table(name = "document_level")
@Getter
@Setter
@NoArgsConstructor
public class DocumentLevel {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Integer id;

    @Column(name = "level_number", nullable = false)
    private Integer levelNumber;

    @Column(nullable = false)
    private String label;

    /** Soft-disable instead of deleting. */
    @Column(nullable = false)
    private boolean active = true;
}
