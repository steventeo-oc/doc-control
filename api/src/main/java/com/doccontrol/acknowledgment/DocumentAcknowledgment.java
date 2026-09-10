package com.doccontrol.acknowledgment;

import com.doccontrol.document.DocumentVersion;
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
 * One read-and-understood acknowledgment (Phase 2d): who acknowledged which
 * version, when. Record-only audit evidence — nothing is gated on it. The
 * unique (version, user) constraint IS the no-carry-forward rule: each
 * newly-effective version re-opens acknowledgment for the whole department.
 */
@Entity
@Table(name = "document_acknowledgment",
        uniqueConstraints = @UniqueConstraint(columnNames = {"document_version_id", "user_id"}))
@Getter
@Setter
@NoArgsConstructor
public class DocumentAcknowledgment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Integer id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "document_version_id", nullable = false)
    private DocumentVersion documentVersion;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @CreationTimestamp
    @Column(name = "acknowledged_at", nullable = false, updatable = false)
    private LocalDateTime acknowledgedAt;
}
