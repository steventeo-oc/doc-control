package com.doccontrol.acknowledgment;

import com.doccontrol.document.Document;
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
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * Per-document, per-user grant to view a document's acknowledgment status
 * (Phase 2d): owner and admins see it by default; the owner/admin can grant
 * specific other users. Deliberately NOT a role or department-level
 * exception, and it carries no document permissions whatsoever.
 */
@Entity
@Table(name = "document_acknowledgment_access",
        uniqueConstraints = @UniqueConstraint(columnNames = {"document_id", "user_id"}))
@Getter
@Setter
@NoArgsConstructor
public class DocumentAcknowledgmentAccess {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Integer id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "document_id", nullable = false)
    private Document document;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "granted_by", nullable = false)
    private User grantedBy;

    @CreationTimestamp
    @Column(name = "granted_at", nullable = false, updatable = false)
    private LocalDateTime grantedAt;
}
