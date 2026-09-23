package com.doccontrol.document;

import com.doccontrol.audit.AuditService;
import com.doccontrol.audit.NotificationLog;
import com.doccontrol.audit.NotificationLogRepository;
import com.doccontrol.common.domain.PersistentEnums;
import com.doccontrol.common.web.ConflictException;
import com.doccontrol.common.web.ForbiddenException;
import com.doccontrol.common.web.NotFoundException;
import com.doccontrol.config.ReviewProperties;
import com.doccontrol.notification.NotificationSender;
import com.doccontrol.identity.User;
import com.doccontrol.identity.UserRepository;
import com.doccontrol.lookup.Department;
import com.doccontrol.lookup.DepartmentRepository;
import com.doccontrol.lookup.DocumentSequenceService;
import com.doccontrol.lookup.DocumentType;
import com.doccontrol.lookup.DocumentTypeRepository;
import com.doccontrol.security.CurrentUserProvider;
import jakarta.persistence.criteria.Predicate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class DocumentService {

    private static final Logger log = LoggerFactory.getLogger(DocumentService.class);


    /**
     * Statuses visible to every authenticated user under the provisional
     * visibility rule (CLAUDE.md schema decisions). Everything else — draft,
     * in_review, and obsolete — is restricted to owner and admins. "Assigned reviewers" join in Sprint 3
     * when workflow tasks exist.
     */
    private static final List<DocumentStatus> PUBLIC_STATUSES =
            List.of(DocumentStatus.APPROVED, DocumentStatus.RELEASED);

    private final DocumentRepository documentRepository;
    private final DocumentVersionRepository documentVersionRepository;
    private final DocumentTypeRepository documentTypeRepository;
    private final DepartmentRepository departmentRepository;
    private final UserRepository userRepository;
    private final com.doccontrol.identity.DepartmentAccessService departmentAccessService;
    private final DocumentSequenceService documentSequenceService;
    private final AuditService auditService;
    private final CurrentUserProvider currentUserProvider;
    private final com.doccontrol.workflow.ReviewerAccess reviewerAccess;
    private final ReviewProperties reviewProperties;
    private final NotificationSender notificationSender;
    private final NotificationLogRepository notificationLogRepository;
    private final com.doccontrol.audit.AuditLogRepository auditLogRepository;
    private final UserDocumentFavoriteRepository userDocumentFavoriteRepository;
    private final com.doccontrol.workflow.WorkflowInstanceRepository workflowInstanceRepository;

    public DocumentService(DocumentRepository documentRepository,
                           DocumentVersionRepository documentVersionRepository,
                           DocumentTypeRepository documentTypeRepository,
                           DepartmentRepository departmentRepository,
                           UserRepository userRepository,
                           com.doccontrol.identity.DepartmentAccessService departmentAccessService,
                           DocumentSequenceService documentSequenceService,
                           AuditService auditService,
                           CurrentUserProvider currentUserProvider,
                           com.doccontrol.workflow.ReviewerAccess reviewerAccess,
                           ReviewProperties reviewProperties,
                           NotificationSender notificationSender,
                           NotificationLogRepository notificationLogRepository,
                           com.doccontrol.audit.AuditLogRepository auditLogRepository,
                           UserDocumentFavoriteRepository userDocumentFavoriteRepository,
                           com.doccontrol.workflow.WorkflowInstanceRepository workflowInstanceRepository) {
        this.documentRepository = documentRepository;
        this.documentVersionRepository = documentVersionRepository;
        this.documentTypeRepository = documentTypeRepository;
        this.departmentRepository = departmentRepository;
        this.userRepository = userRepository;
        this.departmentAccessService = departmentAccessService;
        this.documentSequenceService = documentSequenceService;
        this.auditService = auditService;
        this.currentUserProvider = currentUserProvider;
        this.reviewerAccess = reviewerAccess;
        this.reviewProperties = reviewProperties;
        this.notificationSender = notificationSender;
        this.notificationLogRepository = notificationLogRepository;
        this.auditLogRepository = auditLogRepository;
        this.userDocumentFavoriteRepository = userDocumentFavoriteRepository;
        this.workflowInstanceRepository = workflowInstanceRepository;
    }

    private List<String> reviewerRoleNames() {
        return currentUserProvider.getCurrentUserRoleNames();
    }

    @Transactional
    public DocumentDto create(Integer documentTypeId, Integer departmentId, String name) {
        DocumentType type = requireActiveType(documentTypeId);
        Department department = requireActiveDepartment(departmentId);
        // Plan-back section 1: every level except CONSUMER may create here
        requireCanCreateIn(department);

        // The number allocation and the document insert share one transaction:
        // the counter row lock guarantees distinct numbers under concurrency,
        // and a rollback simply burns the number (gaps are expected).
        DocumentSequenceService.AllocatedNumber allocated =
                documentSequenceService.allocateNext(type, department);

        Document document = new Document();
        document.setDocumentNumber(allocated.documentNumber());
        document.setDocumentType(type);
        document.setDepartment(department);
        document.setSequenceNumber(allocated.sequenceNumber());
        document.setName(name);
        document.setStatus(DocumentStatus.DRAFT);
        document.setOwner(currentUserProvider.getCurrentUser());
        documentRepository.save(document);

        auditService.record("document", document.getId(), "created", Map.of(
                "document_number", document.getDocumentNumber(),
                "name", document.getName(),
                "type", type.getCode(),
                "department", department.getCode()), document.getDepartment());

        return DocumentDto.from(document);
    }

    @Transactional(readOnly = true)
    public DocumentNumberPreviewDto previewNextNumber(Integer typeId, Integer departmentId) {
        DocumentType type = requireActiveType(typeId);

        if (departmentId == null) {
            Optional<Document> latestForType = documentRepository
                    .findFirstByDocumentTypeIdOrderBySequenceNumberDesc(type.getId());
            return new DocumentNumberPreviewDto(
                    type.getId(),
                    type.getCode(),
                    null,
                    null,
                    null,
                    String.format("%s-[Dept]-????", type.getCode()),
                    latestForType.map(Document::getSequenceNumber).orElse(null),
                    latestForType.map(Document::getDocumentNumber).orElse(null)
            );
        }

        Department department = requireActiveDepartment(departmentId);
        int counterNext = documentSequenceService.peekNextSequence(type.getId(), department.getId());
        Optional<Document> latestForTypeAndDept = documentRepository
                .findFirstByDocumentTypeIdAndDepartmentIdOrderBySequenceNumberDesc(type.getId(), department.getId());

        int nextSeq = Math.max(counterNext, latestForTypeAndDept.map(d -> d.getSequenceNumber() + 1).orElse(counterNext));
        String nextDocNumber = String.format("%s-%s-%04d", type.getCode(), department.getCode(), nextSeq);

        Integer latestSeq = latestForTypeAndDept.map(Document::getSequenceNumber)
                .orElse(counterNext > 1 ? counterNext - 1 : null);
        String latestDocNumber = latestForTypeAndDept.map(Document::getDocumentNumber)
                .orElse(latestSeq != null ? String.format("%s-%s-%04d", type.getCode(), department.getCode(), latestSeq) : null);

        return new DocumentNumberPreviewDto(
                type.getId(),
                type.getCode(),
                department.getId(),
                department.getCode(),
                nextSeq,
                nextDocNumber,
                latestSeq,
                latestDocNumber
        );
    }

    /** The visible-document gate shared with the version endpoints. */
    public Document requireVisible(Integer id) {
        return findVisible(id);
    }

    /** Edit gate (metadata, versions, approval starts) — plan-back section 1. */
    public void requireCanEdit(Document document) {
        if (!canEdit(document)) {
            throw new ForbiddenException(
                    "Only a Manager or Collaborator of department '"
                            + document.getDepartment().getCode()
                            + "' (or the document's owner at Contributor level) can modify this document.");
        }
    }

    public boolean canEdit(Document document) {
        return departmentAccessService.canEdit(
                document.getOwner().getId(), document.getDepartment().getId());
    }

    /** Manage gate (soft-delete/restore) — Collaborators and Contributors on their own documents only. */
    public void requireCanManageDocument(Document document) {
        if (!canManageDocument(document)) {
            throw new ForbiddenException(
                    "Only a Manager of department '"
                            + document.getDepartment().getCode()
                            + "' (or the document's owner) can delete or restore this document.");
        }
    }

    public boolean canManageDocument(Document document) {
        return departmentAccessService.canManageDocument(
                document.getOwner().getId(), document.getDepartment().getId());
    }

    @Transactional(readOnly = true)
    public DocumentDto get(Integer id) {
        Document document = findVisible(id);
        boolean isFav = userDocumentFavoriteRepository.existsByUserIdAndDocumentId(
                currentUserProvider.getCurrentUserId(), document.getId());
        return DocumentDto.from(document, isFav);
    }

    @Transactional(readOnly = true)
    public DocumentsPageDto list(String typeCode, String departmentCode, DocumentStatus status,
                                 String q, Boolean reviewOverdue, Boolean trashed, String owner,
                                 int page, int pageSize) {
        return list(typeCode, departmentCode, status, q, reviewOverdue, trashed, owner, null, null, page, pageSize);
    }

    @Transactional(readOnly = true)
    public DocumentsPageDto list(String typeCode, String departmentCode, DocumentStatus status,
                                 String q, Boolean reviewOverdue, Boolean trashed, String owner,
                                 String sort, int page, int pageSize) {
        return list(typeCode, departmentCode, status, q, reviewOverdue, trashed, null, owner, null, sort, page, pageSize);
    }

    @Transactional(readOnly = true)
    public DocumentsPageDto list(String typeCode, String departmentCode, DocumentStatus status,
                                 String q, Boolean reviewOverdue, Boolean trashed, String owner,
                                 Boolean favorite, String sort, int page, int pageSize) {
        return list(typeCode, departmentCode, status, q, reviewOverdue, trashed, null, owner, favorite, sort, page, pageSize);
    }

    @Transactional(readOnly = true)
    public DocumentsPageDto list(String typeCode, String departmentCode, DocumentStatus status,
                                 String q, Boolean reviewOverdue, Boolean trashed, Boolean archived, String owner,
                                 Boolean favorite, String sort, int page, int pageSize) {
        return list(typeCode, null, departmentCode, status, q, reviewOverdue, trashed, archived, owner, favorite, sort, page, pageSize);
    }

    @Transactional(readOnly = true)
    public DocumentsPageDto list(String typeCode, Integer level, String departmentCode, DocumentStatus status,
                                 String q, Boolean reviewOverdue, Boolean trashed, Boolean archived, String owner,
                                 Boolean favorite, String sort, int page, int pageSize) {
        Sort sortSpec = parseSort(sort);
        Pageable pageable = PageRequest.of(page, Math.min(pageSize, 100), sortSpec);
        Specification<Document> spec = buildSpecification(typeCode, level, departmentCode, status, q,
                reviewOverdue, trashed, archived, owner, favorite);
        Page<Document> docPage = documentRepository.findAll(spec, pageable);
        List<DocumentSummaryDto> summaries = toSummaryDtos(docPage.getContent());
        Page<DocumentSummaryDto> result = new PageImpl<>(summaries, pageable, docPage.getTotalElements());
        return DocumentsPageDto.from(result);
    }

    @Transactional(readOnly = true)
    public List<DocumentSummaryDto> exportRows(String typeCode, Integer level, String departmentCode,
                                               DocumentStatus status, String q, Boolean reviewOverdue,
                                               Boolean trashed, Boolean archived, String owner,
                                               Boolean favorite, String sort) {
        Sort sortSpec = parseSort(sort);
        Specification<Document> spec = buildSpecification(typeCode, level, departmentCode, status, q,
                reviewOverdue, trashed, archived, owner, favorite);
        List<Document> documents = documentRepository.findAll(spec, sortSpec);
        return toSummaryDtos(documents);
    }

    private Specification<Document> buildSpecification(String typeCode, Integer level, String departmentCode,
                                                       DocumentStatus status, String q, Boolean reviewOverdue,
                                                       Boolean trashed, Boolean archived, String owner,
                                                       Boolean favorite) {
        List<Specification<Document>> parts = new ArrayList<>();
        if (level != null) {
            parts.add((root, query, cb) -> cb.equal(root.get("documentType").get("level").get("levelNumber"), level));
        }
        if (Boolean.TRUE.equals(archived)) {
            parts.add((root, query, cb) -> cb.equal(root.get("status"), DocumentStatus.OBSOLETE));
            parts.add(notDeleted());
        } else if (Boolean.TRUE.equals(trashed)) {
            parts.add((root, query, cb) -> root.get("deletedAt").isNotNull());
            if (!currentUserProvider.isAdmin()) {
                Integer me = currentUserProvider.getCurrentUserId();
                List<Integer> managedIds = departmentAccessService.managedDepartmentIdsOfCurrentUser();
                parts.add((root, query, cb) -> {
                    Predicate managed = managedIds.isEmpty()
                            ? cb.disjunction()
                            : root.get("department").get("id").in(managedIds);
                    return cb.or(managed, cb.equal(root.get("owner").get("id"), me));
                });
            }
        } else {
            parts.add(notDeleted());
            if (status == null) {
                // Exclude obsolete documents from active list by default
                parts.add((root, query, cb) -> cb.notEqual(root.get("status"), DocumentStatus.OBSOLETE));
            }
        }
        if ("me".equals(owner)) {
            parts.add((root, query, cb) ->
                    cb.equal(root.get("owner").get("id"), currentUserProvider.getCurrentUserId()));
        }
        if (Boolean.TRUE.equals(favorite)) {
            Integer me = currentUserProvider.getCurrentUserId();
            List<Integer> favIds = userDocumentFavoriteRepository.findDocumentIdsByUserId(me);
            parts.add((root, query, cb) -> favIds.isEmpty()
                    ? cb.disjunction()
                    : root.get("id").in(favIds));
        }
        if (typeCode != null && !typeCode.isBlank()) {
            parts.add((root, query, cb) -> cb.equal(root.get("documentType").get("code"), typeCode));
        }
        if (departmentCode != null && !departmentCode.isBlank()) {
            parts.add((root, query, cb) -> cb.equal(root.get("department").get("code"), departmentCode));
        }
        if (status != null) {
            parts.add((root, query, cb) -> cb.equal(root.get("status"), status));
        }
        if (q != null && !q.isBlank()) {
            String needle = q.toLowerCase();
            parts.add((root, query, cb) -> cb.or(
                    cb.like(cb.lower(root.get("name")), "%" + needle + "%"),
                    cb.like(cb.lower(root.get("documentNumber")), "%" + needle + "%")));
        }
        if (reviewOverdue != null) {
            LocalDate today = LocalDate.now();
            parts.add((root, query, cb) -> {
                Predicate overdue = cb.and(
                        cb.isNotNull(root.get("nextReviewDue")),
                        cb.lessThan(root.get("nextReviewDue"), today),
                        root.get("status").in(List.of(DocumentStatus.RELEASED, DocumentStatus.APPROVED)));
                return reviewOverdue ? overdue : cb.not(overdue);
            });
        }
        if (!currentUserProvider.isAdmin()) {
            Integer userId = currentUserProvider.getCurrentUserId();
            Set<Integer> reviewing = reviewerAccess.reviewerVisibleDocumentIds(
                    userId, reviewerRoleNames());
            Set<Integer> myDepartments = currentUserDepartmentIds();
            parts.add((root, query, cb) -> {
                Predicate base = cb.or(
                        root.get("status").in(PUBLIC_STATUSES),
                        cb.equal(root.get("owner").get("id"), userId),
                        myDepartments.isEmpty()
                                ? cb.disjunction()
                                : root.get("department").get("id").in(myDepartments));
                return reviewing.isEmpty()
                        ? base
                        : cb.or(base, root.get("id").in(reviewing));
            });
        }
        return Specification.allOf(parts);
    }

    private List<DocumentSummaryDto> toSummaryDtos(List<Document> documents) {
        if (documents.isEmpty()) {
            return List.of();
        }
        Integer me = currentUserProvider.getCurrentUserId();
        Set<Integer> userFavIds = new HashSet<>(userDocumentFavoriteRepository.findDocumentIdsByUserId(me));
        List<Integer> docIds = documents.stream().map(Document::getId).toList();

        Map<Integer, com.doccontrol.workflow.WorkflowInstance> activeWfByDocId = docIds.isEmpty() ? Map.of() :
                workflowInstanceRepository.findInProgressByDocumentIdIn(docIds).stream()
                        .collect(Collectors.toMap(
                                wi -> wi.getDocumentVersion().getDocument().getId(),
                                wi -> wi,
                                (a, b) -> a));

        Map<Integer, DocumentVersion> draftVerByDocId = docIds.isEmpty() ? Map.of() :
                documentVersionRepository.findDraftsByDocumentIdIn(docIds).stream()
                        .collect(Collectors.toMap(
                                v -> v.getDocument().getId(),
                                v -> v,
                                (a, b) -> a));

        return documents.stream().map(doc -> {
            boolean fav = userFavIds.contains(doc.getId());
            Integer revVerNum = null;
            String revStatus = null;
            if (doc.getStatus() == DocumentStatus.RELEASED) {
                com.doccontrol.workflow.WorkflowInstance activeWf = activeWfByDocId.get(doc.getId());
                if (activeWf != null) {
                    revStatus = activeWf.getKind() == com.doccontrol.workflow.WorkflowInstanceKind.REAPPROVAL
                            ? "RE_APPROVAL"
                            : "IN_REVIEW";
                    revVerNum = activeWf.getDocumentVersion() != null
                            ? activeWf.getDocumentVersion().getVersionNumber()
                            : null;
                } else {
                    DocumentVersion draftVer = draftVerByDocId.get(doc.getId());
                    if (draftVer != null) {
                        revStatus = "DRAFT";
                        revVerNum = draftVer.getVersionNumber();
                    }
                }
            }
            return DocumentSummaryDto.from(doc, fav, revVerNum, revStatus);
        }).toList();
    }

    @Transactional
    public void favorite(Integer documentId) {
        Document document = requireVisible(documentId);
        Integer userId = currentUserProvider.getCurrentUserId();
        if (!userDocumentFavoriteRepository.existsByUserIdAndDocumentId(userId, documentId)) {
            User user = currentUserProvider.getCurrentUser();
            userDocumentFavoriteRepository.save(new UserDocumentFavorite(user, document));
            auditService.record("document", documentId, "favorited", Map.of(
                    "document_number", document.getDocumentNumber(),
                    "user_id", userId), document.getDepartment());
        }
    }

    @Transactional
    public void unfavorite(Integer documentId) {
        Document document = requireVisible(documentId);
        Integer userId = currentUserProvider.getCurrentUserId();
        userDocumentFavoriteRepository.deleteByUserIdAndDocumentId(userId, documentId);
        auditService.record("document", documentId, "unfavorited", Map.of(
                "document_number", document.getDocumentNumber(),
                "user_id", userId), document.getDepartment());
    }

    @Transactional
    public DocumentDto update(Integer id, UpdateDocumentRequest request) {
        Document document = findVisible(id);
        requireCanEdit(document);
        if (!workflowInstanceRepository.findInProgressByDocumentId(document.getId()).isEmpty()) {
            throw new ConflictException("Document is locked: metadata cannot be modified while an approval workflow is in progress.");
        }

        Map<String, Object> before = new LinkedHashMap<>();
        Map<String, Object> after = new LinkedHashMap<>();

        if (request.name() != null && !request.name().equals(document.getName())) {
            before.put("name", document.getName());
            after.put("name", request.name());
            document.setName(request.name());
        }
        if (request.ownerUserId() != null && !request.ownerUserId().equals(document.getOwner().getId())) {
            User newOwner = userRepository.findById(request.ownerUserId())
                    .filter(User::isActive)
                    .orElseThrow(() -> new NotFoundException("User " + request.ownerUserId() + " not found."));
            // keep the invariant that the owner can work with the document:
            // the new owner must hold at least CONTRIBUTOR in the department
            // — a Consumer owning a document could never edit it (plan-back F6)
            com.doccontrol.identity.MembershipLevel newOwnerLevel = departmentAccessService
                    .levelOf(newOwner.getId(), document.getDepartment().getId())
                    .orElseThrow(() -> new ForbiddenException(
                            "The new owner must be a member of department '"
                                    + document.getDepartment().getCode() + "'."));
            if (newOwnerLevel == com.doccontrol.identity.MembershipLevel.CONSUMER) {
                throw new ForbiddenException(
                        "The new owner must hold at least Contributor level in department '"
                                + document.getDepartment().getCode() + "'.");
            }
            before.put("owner_user_id", document.getOwner().getId());
            after.put("owner_user_id", newOwner.getId());
            document.setOwner(newOwner);
        }

        if (!after.isEmpty()) {
            auditService.record("document", id, "updated", Map.of("before", before, "after", after),
                    document.getDepartment());
        }

        return DocumentDto.from(document);
    }

    /** Soft delete — moves to trash, never purges (CLAUDE.md schema decisions). */
    @Transactional
    public void delete(Integer id) {
        Document document = findVisible(id);
        requireCanManageDocument(document);
        if (!workflowInstanceRepository.findInProgressByDocumentId(document.getId()).isEmpty()) {
            throw new ConflictException("Document is locked: cannot be moved to trash while an approval workflow is in progress.");
        }

        if (document.getDeletedAt() == null) {
            document.setDeletedAt(LocalDateTime.now());
            auditService.record("document", id, "deleted", Map.of("soft_delete", true),
                    document.getDepartment());
        }
    }

    @Transactional
    public DocumentDto restore(Integer id) {
        Document document = findVisible(id);
        requireCanManageDocument(document);

        if (document.getDeletedAt() != null) {
            document.setDeletedAt(null);
            auditService.record("document", id, "restored", Map.of(), document.getDepartment());
        }
        return DocumentDto.from(document);
    }

    @Transactional
    public void markObsolete(Integer id, String reason) {
        Document document = findVisible(id);
        requireCanManageDocument(document);

        if (document.getStatus() != DocumentStatus.RELEASED) {
            throw new ConflictException("Only released documents can be retired and marked as obsolete.");
        }

        DocumentStatus previousStatus = document.getStatus();
        document.setStatus(DocumentStatus.OBSOLETE);

        Map<String, Object> details = new LinkedHashMap<>();
        details.put("document_number", document.getDocumentNumber());
        details.put("previous_status", previousStatus.getValue());
        details.put("new_status", DocumentStatus.OBSOLETE.getValue());
        if (reason != null && !reason.isBlank()) {
            details.put("reason", reason.trim());
        }

        auditService.record("document", id, "obsoleted", details, document.getDepartment());
    }

    @Transactional
    public void reactivate(Integer id, String reason) {
        Document document = findVisible(id);
        requireCanManageDocument(document);

        if (document.getStatus() != DocumentStatus.OBSOLETE) {
            throw new ConflictException("Only obsolete documents can be reactivated.");
        }

        document.setStatus(DocumentStatus.RELEASED);

        Map<String, Object> details = new LinkedHashMap<>();
        details.put("document_number", document.getDocumentNumber());
        details.put("new_status", DocumentStatus.RELEASED.getValue());
        if (reason != null && !reason.isBlank()) {
            details.put("reason", reason.trim());
        }

        auditService.record("document", id, "reactivated", details, document.getDepartment());
    }

    @Transactional
    public void discardDraftDocument(Integer id) {
        Document document = findVisible(id);
        requireCanManageDocument(document);

        if (document.getStatus() != DocumentStatus.DRAFT) {
            throw new ConflictException("Only unreleased draft documents can be discarded.");
        }

        boolean hasReleased = documentVersionRepository.findAllByDocumentIdOrderByVersionNumberAsc(id)
                .stream().anyMatch(v -> v.getStatus() == DocumentVersionStatus.CURRENT || v.getStatus() == DocumentVersionStatus.SUPERSEDED);
        if (hasReleased) {
            throw new ConflictException("Cannot discard a document that has released revision history.");
        }

        document.setDeletedAt(LocalDateTime.now());
        auditService.record("document", id, "draft_discarded", Map.of(
                "document_number", document.getDocumentNumber(),
                "name", document.getName()), document.getDepartment());
    }

    @Transactional(readOnly = true)
    public List<DocumentActivityDto> documentActivity(Integer id) {
        Document document = findVisible(id);
        List<com.doccontrol.audit.AuditLog> logs = auditLogRepository.findByDocumentId(document.getId());
        return logs.stream().map(log -> new DocumentActivityDto(
                log.getId(),
                log.getPerformedAt(),
                log.getPerformedBy() != null ? log.getPerformedBy().getId() : null,
                log.getPerformedBy() != null ? log.getPerformedBy().getName() : "System",
                log.getPerformedBy() != null ? log.getPerformedBy().getEmail() : null,
                log.getEntityType(),
                log.getEntityId(),
                log.getAction(),
                log.getDetails()
        )).toList();
    }

    /**
     * Visibility is enforced in the service layer (CLAUDE.md convention 4).
     * Hidden documents produce 404, not 403 — the response must not confirm
     * that an invisible document exists.
     */
    private Document findVisible(Integer id) {
        Document document = documentRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Document " + id + " not found."));
        boolean isOwner = document.getOwner().getId().equals(currentUserProvider.getCurrentUserId());
        boolean isReviewer = !currentUserProvider.isAdmin()
                && reviewerAccess.isReviewer(currentUserProvider.getCurrentUserId(),
                        reviewerRoleNames(), document.getId());
        boolean isDepartmentMember = currentUserDepartmentIds()
                .contains(document.getDepartment().getId());
        if (!isOwner && !isReviewer && !isDepartmentMember && !currentUserProvider.isAdmin()
                && !PUBLIC_STATUSES.contains(document.getStatus())) {
            throw new NotFoundException("Document " + id + " not found.");
        }
        return document;
    }

    private DocumentType requireActiveType(Integer typeId) {
        DocumentType type = documentTypeRepository.findById(typeId)
                .orElseThrow(() -> new NotFoundException("Document type " + typeId + " not found."));
        if (!type.isActive()) {
            throw new ConflictException("Document type '" + type.getCode() + "' is inactive.");
        }
        return type;
    }

    private Department requireActiveDepartment(Integer departmentId) {
        Department department = departmentRepository.findById(departmentId)
                .orElseThrow(() -> new NotFoundException("Department " + departmentId + " not found."));
        if (!department.isActive()) {
            throw new ConflictException("Department '" + department.getCode() + "' is inactive.");
        }
        return department;
    }

    /**
     * Publishes an approved version (Phase 2b, extended by Phase 2c): the
     * pointer/status/audit semantics the engine drives on approval, now with
     * effectivity and the review clock. The version takes effect on
     * {@code effectiveDate} (the approval date for immediate releases, the
     * chosen date when the daily job flips a deferred one); the review clock
     * resets at effectiveness — the one rule that covers approvals,
     * re-approvals, and flips alike.
     */
    @Transactional
    public void promoteVersion(DocumentVersion version, LocalDate effectiveDate, User actor) {
        Document document = version.getDocument();
        DocumentVersion previous = document.getCurrentVersion();
        Integer pointerBefore = previous == null ? null : previous.getId();

        if (!version.equals(previous)) {
            document.setCurrentVersion(version);
        }
        if (version.getStatus() != DocumentVersionStatus.CURRENT) {
            version.setStatus(DocumentVersionStatus.CURRENT);
        }
        if (previous != null && !previous.equals(version)
                && previous.getStatus() != DocumentVersionStatus.SUPERSEDED) {
            previous.setStatus(DocumentVersionStatus.SUPERSEDED);
        }
        version.setEffectiveAt(effectiveDate);

        if (document.getStatus() != DocumentStatus.RELEASED) {
            DocumentStatus previousStatus = document.getStatus();
            document.setStatus(DocumentStatus.RELEASED);
            Map<String, Object> before = new LinkedHashMap<>();
            before.put("status", previousStatus == null ? "unknown" : previousStatus.getValue());
            before.put("current_version_id", pointerBefore);
            Map<String, Object> after = new LinkedHashMap<>();
            after.put("status", DocumentStatus.RELEASED.getValue());
            after.put("current_version_id", version.getId());
            after.put("effective_at", effectiveDate.toString());
            auditService.recordAs(actor, "document", document.getId(), "status_changed",
                    Map.of("before", before, "after", after), document.getDepartment());
        } else if (!pointerBefore.equals(version.getId())) {
            auditService.recordAs(actor, "document", document.getId(), "updated", Map.of(
                    "before", Map.of("current_version_id", pointerBefore),
                    "after", Map.of("current_version_id", version.getId())), document.getDepartment());
        }
        resetReviewClock(document, effectiveDate, actor);
    }

    /**
     * Records an approval outcome whose effectivity is deferred (Phase 2c):
     * document and version become "approved" — a visible state distinct from
     * released — but the public version pointer does not move until the
     * daily job flips it on the effective date (amends the pilot-era
     * pointer rule; see plan-back flag F2). Any older still-pending version
     * is retired first: at most one pending-effective promotion per document
     * (decision D2).
     */
    @Transactional
    public void approveVersionPendingEffectivity(DocumentVersion version, LocalDate effectiveDate, User actor) {
        Document document = version.getDocument();
        for (DocumentVersion stale : documentVersionRepository
                .findAllByDocumentIdAndStatus(document.getId(), DocumentVersionStatus.APPROVED)) {
            if (!stale.getId().equals(version.getId())) {
                stale.setStatus(DocumentVersionStatus.SUPERSEDED);
                auditService.recordAs(actor, "document_version", stale.getId(),
                        "superseded_before_effective", Map.of(
                                "document_number", document.getDocumentNumber(),
                                "version_number", stale.getVersionNumber(),
                                "effective_at", String.valueOf(stale.getEffectiveAt())),
                        document.getDepartment());
                notifyOwnerOfSupersededPending(document, stale);
            }
        }

        DocumentStatus previousStatus = document.getStatus();
        version.setStatus(DocumentVersionStatus.APPROVED);
        version.setEffectiveAt(effectiveDate);
        document.setStatus(DocumentStatus.APPROVED);

        // LinkedHashMap, not Map.of: current_version_id is legitimately null
        // for a first approval (no released version yet).
        Map<String, Object> before = new LinkedHashMap<>();
        before.put("status", previousStatus == null ? "unknown" : previousStatus.getValue());
        before.put("current_version_id", document.getCurrentVersion() == null
                ? null : document.getCurrentVersion().getId());
        Map<String, Object> after = new LinkedHashMap<>(before);
        after.put("status", DocumentStatus.APPROVED.getValue());
        after.put("pending_effective_at", effectiveDate.toString());
        auditService.recordAs(actor, "document", document.getId(), "status_changed",
                Map.of("before", before, "after", after), document.getDepartment());
    }

    /**
     * The one review-clock reset rule (Phase 2c): the clock restarts when
     * content becomes effective — on approval/re-approval completion day, or
     * on the effective date for deferred outcomes. Consumes any pending
     * review reset (decision: the newest certification wins).
     */
    @Transactional
    public void resetReviewClock(Document document, LocalDate certifiedOn, User actor) {
        document.setLastReviewedAt(certifiedOn);
        document.setNextReviewDue(reviewProperties.intervalMonths() > 0
                ? certifiedOn.plusMonths(reviewProperties.intervalMonths())
                : null);
        document.setPendingReviewEffectiveAt(null);
        auditService.recordAs(actor, "document", document.getId(), "review_clock_reset", Map.of(
                "last_reviewed_at", certifiedOn.toString(),
                "next_review_due", document.getNextReviewDue() == null
                        ? "none" : document.getNextReviewDue().toString()), document.getDepartment());
    }

    /**
     * A re-approval completed with a future effective date (Phase 2c): the
     * in-effect version stays in effect, and the review clock resets on the
     * chosen date via the daily job — not now.
     */
    @Transactional
    public void schedulePendingReviewReset(Document document, LocalDate effectiveDate, User actor) {
        document.setPendingReviewEffectiveAt(effectiveDate);
        auditService.recordAs(actor, "document", document.getId(), "review_reset_scheduled", Map.of(
                "effective_at", effectiveDate.toString()), document.getDepartment());
    }

    private void notifyOwnerOfSupersededPending(Document document, DocumentVersion retired) {
        User owner = document.getOwner();
        String subject = "Pending approval superseded: " + document.getDocumentNumber()
                + " Rev " + retired.getVersionNumber();
        String body = "Revision " + retired.getVersionNumber() + " was approved with effect from "
                + retired.getEffectiveAt() + " but a newer approval outcome was recorded first, "
                + "so it never took effect. No action needed.";
        notificationSender.send(owner, subject, body);

        NotificationLog entry = new NotificationLog();
        entry.setKind("PENDING_SUPERSEDED");
        entry.setDocument(document);
        entry.setDocumentVersion(retired);
        entry.setDedupKey("pending-superseded:version=" + retired.getId());
        entry.setRecipient(owner);
        entry.setSubject(subject);
        entry.setNotificationDate(java.time.LocalDate.now());
        entry.setChannel("log");
        notificationLogRepository.save(entry);
    }

    /**
     * Phase 2e change notification: everyone in the document's department
     * (the same live {@code user_department} lookup the acknowledgment
     * sweep uses — confirmed with QA, no exclusions), sent once per
     * version per recipient ever via the dedup key. Best-effort by design
     * (plan-back flag F1): a send failure is logged and never propagates —
     * an approval completion or an effective-date flip must not roll back
     * because mail was down. The daily sweep's change-notification phase
     * (and a manual daily-sweep re-run for that business date) redelivers
     * to whoever has no log row yet.
     */
    public void notifyDepartmentOfChange(Document document, DocumentVersion version,
                                         LocalDate notificationDate) {
        String dedupKey = "change:version=" + version.getId();
        String subject = "Document changed: " + document.getDocumentNumber()
                + " Rev " + version.getVersionNumber() + " now in effect";
        String body = document.getDocumentNumber() + " \"" + document.getName()
                + "\" — revision " + version.getVersionNumber()
                + " is now in effect (effective " + version.getEffectiveAt() + ")."
                + (version.getChangeReference() == null || version.getChangeReference().isBlank()
                        ? "" : "\nChange reference: " + version.getChangeReference());
        for (User member : userRepository.findActiveByDepartmentId(document.getDepartment().getId())) {
            if (notificationLogRepository.existsByKindAndDedupKeyAndRecipientId(
                    "DOCUMENT_CHANGED", dedupKey, member.getId())) {
                continue;
            }
            try {
                notificationSender.send(member, subject, body);

                NotificationLog entry = new NotificationLog();
                entry.setKind("DOCUMENT_CHANGED");
                entry.setDocument(document);
                entry.setDocumentVersion(version);
                entry.setDedupKey(dedupKey);
                entry.setRecipient(member);
                entry.setSubject(subject);
                entry.setNotificationDate(notificationDate);
                entry.setChannel(notificationSender.channel());
                notificationLogRepository.save(entry);
            } catch (Exception e) {
                log.warn("Change notification failed for {} Rev {} to {}: {}",
                        document.getDocumentNumber(), version.getVersionNumber(),
                        member.getEmail(), e.getMessage());
            }
        }
    }

    private Specification<Document> notDeleted() {
        return (root, query, cb) -> cb.isNull(root.get("deletedAt"));
    }

    private java.util.Set<Integer> currentUserDepartmentIds() {
        return currentUserProvider.getCurrentUserDepartmentIds();
    }

    private void requireCanCreateIn(Department department) {
        if (!departmentAccessService.canCreate(department.getId())) {
            throw new ForbiddenException("Only members of department '" + department.getCode()
                    + "' at Contributor level or above can create documents in it.");
        }
    }

    private Sort parseSort(String sort) {
        if (sort == null || sort.isBlank()) {
            return Sort.by(Sort.Direction.DESC, "createdAt").and(Sort.by(Sort.Direction.DESC, "id"));
        }
        String[] tokens = sort.split(",");
        String property = tokens[0].trim().toLowerCase();
        Sort.Direction direction = tokens.length > 1 && "asc".equalsIgnoreCase(tokens[1].trim())
                ? Sort.Direction.ASC : Sort.Direction.DESC;
        String field = switch (property) {
            case "number", "documentnumber", "document_number" -> "documentNumber";
            case "name" -> "name";
            case "status" -> "status";
            case "updated", "updatedat", "updated_at" -> "updatedAt";
            default -> "createdAt";
        };
        return Sort.by(direction, field).and(Sort.by(Sort.Direction.DESC, "id"));
    }
}
