package com.doccontrol.document;

import com.doccontrol.identity.User;
import com.doccontrol.lookup.Department;
import com.doccontrol.lookup.DocumentType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * The "folder" for a document — identity and current state. Content and
 * history live in {@link DocumentVersion}, not here.
 */
@Entity
@Table(name = "document")
@Getter
@Setter
@NoArgsConstructor
public class Document {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Integer id;

    /**
     * Always server-generated from document_sequence_counter (CLAUDE.md
     * convention 1) — never accepted from a client.
     */
    @Column(name = "document_number", nullable = false, unique = true)
    private String documentNumber;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "document_type_id", nullable = false)
    private DocumentType documentType;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "department_id", nullable = false)
    private Department department;

    /** The numeric part of the document number. */
    @Column(name = "sequence_number", nullable = false)
    private Integer sequenceNumber;

    /** The one authoritative name field. */
    @Column(nullable = false)
    private String name;

    private DocumentStatus status;

    /**
     * Points to the live version; nullable because a brand-new document has
     * no version until one is uploaded. FK is declared after
     * document_version in the schema (circular reference).
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "current_version_id")
    private DocumentVersion currentVersion;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "owner_user_id", nullable = false)
    private User owner;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    /** Soft delete (CLAUDE.md schema decisions); null means not trashed. */
    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;

    /**
     * Periodic-review clock (Phase 2c): when the in-effect content was last
     * certified (approval, re-approval, or effective-date flip), and when the
     * next review is due. Overdue is derived (next_review_due before today),
     * never stored. The clock resets when a version becomes effective.
     */
    @Column(name = "last_reviewed_at")
    private LocalDate lastReviewedAt;

    @Column(name = "next_review_due")
    private LocalDate nextReviewDue;

    /**
     * A re-approval's chosen future effective date (Phase 2c): the daily job
     * consumes it on that date to reset the review clock. Null when nothing
     * is pending.
     */
    @Column(name = "pending_review_effective_at")
    private LocalDate pendingReviewEffectiveAt;

    /**
     * Derived, never stored (Phase 2c): the in-effect content's review is
     * past due. True only while the document actually has in-effect content
     * (released, or approved pending a future effective date) — a missed
     * review is cleared solely by a completed re-approval resetting the
     * clock.
     */
    @jakarta.persistence.Transient
    public boolean isReviewOverdue() {
        return nextReviewDue != null && nextReviewDue.isBefore(java.time.LocalDate.now())
                && (status == DocumentStatus.RELEASED || status == DocumentStatus.APPROVED);
    }

    @OneToMany(mappedBy = "document", fetch = FetchType.LAZY)
    private List<DocumentVersion> versions = new ArrayList<>();
}
