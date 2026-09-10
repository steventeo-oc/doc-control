package com.doccontrol.acknowledgment;

import com.doccontrol.audit.AuditService;
import com.doccontrol.common.web.ConflictException;
import com.doccontrol.common.web.ForbiddenException;
import com.doccontrol.common.web.NotFoundException;
import com.doccontrol.acknowledgment.dto.AcknowledgmentAccessDto;
import com.doccontrol.acknowledgment.dto.AcknowledgmentDto;
import com.doccontrol.acknowledgment.dto.AcknowledgmentStatusDto;
import com.doccontrol.acknowledgment.dto.AcknowledgmentUserDto;
import com.doccontrol.config.AcknowledgmentProperties;
import com.doccontrol.document.Document;
import com.doccontrol.document.DocumentService;
import com.doccontrol.document.DocumentStatus;
import com.doccontrol.document.DocumentVersion;
import com.doccontrol.identity.User;
import com.doccontrol.identity.UserDepartmentId;
import com.doccontrol.identity.UserDepartmentRepository;
import com.doccontrol.identity.UserRepository;
import com.doccontrol.security.CurrentUserProvider;
import com.doccontrol.workflow.BusinessDays;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;

/**
 * Read &amp; understood acknowledgment (Phase 2d). Scope is the document's
 * department, evaluated live against user_department — exactly the existing
 * department model, no snapshot, no new carve-out. Record-only: nothing is
 * blocked by a missing acknowledgment, and the window (7 business days by
 * default, configurable) merely drives reminders and the overdue flag.
 */
@Service
public class AcknowledgmentService {

    private final DocumentAcknowledgmentRepository acknowledgmentRepository;
    private final DocumentAcknowledgmentAccessRepository accessRepository;
    private final DocumentService documentService;
    private final UserRepository userRepository;
    private final UserDepartmentRepository userDepartmentRepository;
    private final AcknowledgmentProperties properties;
    private final AuditService auditService;
    private final CurrentUserProvider currentUserProvider;

    public AcknowledgmentService(DocumentAcknowledgmentRepository acknowledgmentRepository,
                                 DocumentAcknowledgmentAccessRepository accessRepository,
                                 DocumentService documentService,
                                 UserRepository userRepository,
                                 UserDepartmentRepository userDepartmentRepository,
                                 AcknowledgmentProperties properties,
                                 AuditService auditService,
                                 CurrentUserProvider currentUserProvider) {
        this.acknowledgmentRepository = acknowledgmentRepository;
        this.accessRepository = accessRepository;
        this.documentService = documentService;
        this.userRepository = userRepository;
        this.userDepartmentRepository = userDepartmentRepository;
        this.properties = properties;
        this.auditService = auditService;
        this.currentUserProvider = currentUserProvider;
    }

    /**
     * Acknowledges the document's current (effective) version. Idempotent —
     * re-acknowledging returns the existing record. Only members of the
     * document's department may acknowledge (admins are not exempt: the
     * acknowledged population is defined by the department model).
     */
    @Transactional
    public AcknowledgmentDto acknowledge(Integer documentId) {
        Document document = documentService.requireVisible(documentId);
        if (document.getStatus() != DocumentStatus.RELEASED || document.getCurrentVersion() == null) {
            throw new ConflictException(
                    "Only in-effect (released) documents can be acknowledged.");
        }
        User me = currentUserProvider.getCurrentUser();
        if (!userDepartmentRepository.existsById(
                new UserDepartmentId(me.getId(), document.getDepartment().getId()))) {
            throw new ForbiddenException(
                    "Only members of department '" + document.getDepartment().getCode()
                            + "' can acknowledge this document.");
        }

        DocumentVersion version = document.getCurrentVersion();
        DocumentAcknowledgment existing = acknowledgmentRepository
                .findByDocumentVersionIdAndUserId(version.getId(), me.getId())
                .orElse(null);
        if (existing != null) {
            return AcknowledgmentDto.from(existing);
        }

        DocumentAcknowledgment acknowledgment = new DocumentAcknowledgment();
        acknowledgment.setDocumentVersion(version);
        acknowledgment.setUser(me);
        acknowledgmentRepository.save(acknowledgment);

        auditService.record("document_acknowledgment", acknowledgment.getId(), "created", java.util.Map.of(
                "document_number", document.getDocumentNumber(),
                "version_number", version.getVersionNumber(),
                "user_id", me.getId()));
        return AcknowledgmentDto.from(acknowledgment);
    }

    /** Status for the current version — owner, admins, and granted users. */
    @Transactional(readOnly = true)
    public AcknowledgmentStatusDto status(Integer documentId) {
        Document document = documentService.requireVisible(documentId);
        requireStatusViewer(document);
        return statusOf(document);
    }

    /** Core status computation, shared with the daily sweep (Phase 2d job). */
    @Transactional(readOnly = true)
    public AcknowledgmentStatusDto statusOf(Document document) {
        DocumentVersion version = document.getCurrentVersion();
        if (version == null) {
            return new AcknowledgmentStatusDto(
                    document.getId(), null, null, null, null, false, 0, List.of(), List.of());
        }
        LocalDate opensAt = version.getEffectiveAt();
        LocalDate closesAt = opensAt == null ? null
                : BusinessDays.addBusinessDays(opensAt, properties.windowBusinessDays());
        boolean overdue = closesAt != null && LocalDate.now().isAfter(closesAt);

        List<AcknowledgmentDto> acknowledged =
                acknowledgmentRepository
                        .findAllByDocumentVersionIdOrderByAcknowledgedAtAsc(version.getId())
                        .stream()
                        .map(AcknowledgmentDto::from)
                        .toList();
        List<AcknowledgmentUserDto> outstanding =
                outstandingUsers(document).stream()
                        .map(AcknowledgmentUserDto::from)
                        .toList();
        return new AcknowledgmentStatusDto(
                document.getId(),
                version.getId(),
                version.getVersionNumber(),
                opensAt,
                closesAt,
                overdue,
                acknowledged.size() + outstanding.size(),
                acknowledged,
                outstanding);
    }

    /**
     * Active members of the document's department who have not yet
     * acknowledged the current version — evaluated live (plan-back §3.1).
     */
    @Transactional(readOnly = true)
    public List<User> outstandingUsers(Document document) {
        DocumentVersion version = document.getCurrentVersion();
        if (version == null) {
            return List.of();
        }
        List<User> members = userRepository.findActiveByDepartmentId(document.getDepartment().getId());
        return members.stream()
                .filter(member -> !acknowledgmentRepository.existsByDocumentVersionIdAndUserId(
                        version.getId(), member.getId()))
                .toList();
    }

    /** The acknowledgment window of the current version: [effective date, +N business days]. */
    public LocalDate windowClosesAt(Document document) {
        DocumentVersion version = document.getCurrentVersion();
        if (version == null || version.getEffectiveAt() == null) {
            return null;
        }
        return BusinessDays.addBusinessDays(version.getEffectiveAt(), properties.windowBusinessDays());
    }

    // ---- status-visibility grants (owner/admin by default) ----

    @Transactional(readOnly = true)
    public List<AcknowledgmentAccessDto> listAccess(Integer documentId) {
        Document document = documentService.requireVisible(documentId);
        requireAccessManager(document);
        return accessRepository.findAllByDocumentId(documentId).stream()
                .map(AcknowledgmentAccessDto::from)
                .toList();
    }

    @Transactional
    public AcknowledgmentAccessDto grant(Integer documentId, Integer userId) {
        Document document = documentService.requireVisible(documentId);
        requireAccessManager(document);

        User target = userRepository.findById(userId)
                .filter(User::isActive)
                .orElseThrow(() -> new NotFoundException("User " + userId + " not found."));

        DocumentAcknowledgmentAccess existing = accessRepository
                .findByDocumentIdAndUserId(documentId, userId)
                .orElse(null);
        if (existing != null) {
            return AcknowledgmentAccessDto.from(existing);
        }

        DocumentAcknowledgmentAccess access = new DocumentAcknowledgmentAccess();
        access.setDocument(document);
        access.setUser(target);
        access.setGrantedBy(currentUserProvider.getCurrentUser());
        accessRepository.save(access);

        auditService.record("document_acknowledgment_access", access.getId(), "granted", java.util.Map.of(
                "document_number", document.getDocumentNumber(),
                "granted_to", target.getId(),
                "granted_by", currentUserProvider.getCurrentUserId()));
        return AcknowledgmentAccessDto.from(access);
    }

    @Transactional
    public void revoke(Integer documentId, Integer userId) {
        Document document = documentService.requireVisible(documentId);
        requireAccessManager(document);

        DocumentAcknowledgmentAccess access = accessRepository
                .findByDocumentIdAndUserId(documentId, userId)
                .orElseThrow(() -> new NotFoundException(
                        "User " + userId + " has no acknowledgment-status access to this document."));
        accessRepository.delete(access);

        auditService.record("document_acknowledgment_access", access.getId(), "revoked", java.util.Map.of(
                "document_number", document.getDocumentNumber(),
                "revoked_from", userId,
                "revoked_by", currentUserProvider.getCurrentUserId()));
    }

    private void requireStatusViewer(Document document) {
        if (canViewStatus(document)) {
            return;
        }
        throw new ForbiddenException(
                "Only the document owner, an admin, or a granted user can view acknowledgment status.");
    }

    private void requireAccessManager(Document document) {
        if (currentUserProvider.isAdmin()
                || document.getOwner().getId().equals(currentUserProvider.getCurrentUserId())) {
            return;
        }
        throw new ForbiddenException("Only the document owner or an admin can manage acknowledgment access.");
    }

    private boolean canViewStatus(Document document) {
        return currentUserProvider.isAdmin()
                || document.getOwner().getId().equals(currentUserProvider.getCurrentUserId())
                || accessRepository.existsByDocumentIdAndUserId(
                        document.getId(), currentUserProvider.getCurrentUserId());
    }
}
