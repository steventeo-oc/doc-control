package com.doccontrol.document;

import com.doccontrol.identity.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * Real, system-tracked versioning. version_number is a system field,
 * auto-incremented per document — never embedded in filenames (CLAUDE.md
 * convention 5).
 */
@Entity
@Table(name = "document_version")
@Getter
@Setter
@NoArgsConstructor
public class DocumentVersion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Integer id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "document_id", nullable = false)
    private Document document;

    @Column(name = "version_number", nullable = false)
    private Integer versionNumber;

    /** Path/key of the stored file in object storage (MinIO). */
    @Column(name = "file_reference", nullable = false)
    private String fileReference;

    /**
     * Optional "Rev 0"-style label kept only for migration reference — not
     * used going forward (CLAUDE.md convention 5).
     */
    @Column(name = "legacy_revision_label")
    private String legacyRevisionLabel;

    private DocumentVersionStatus status;

    @Column(name = "change_notes")
    private String changeNotes;

    /**
     * Optional free-text Change Request / CAPA / Deviation reference
     * (Phase 2c, Should priority) — recorded as-is, never validated against
     * an external system.
     */
    @Column(name = "change_reference")
    private String changeReference;

    /**
     * The date this version takes (or took) effect: the approval date for
     * immediate releases, the approver-chosen date for deferred ones
     * (Phase 2c). Immutable once effective.
     */
    @Column(name = "effective_at")
    private LocalDate effectiveAt;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "uploaded_by", nullable = false)
    private User uploadedBy;

    @CreationTimestamp
    @Column(name = "uploaded_at", nullable = false, updatable = false)
    private LocalDateTime uploadedAt;
}
