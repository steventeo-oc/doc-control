package com.doccontrol.document;

import com.doccontrol.audit.AuditService;
import com.doccontrol.common.domain.PersistentEnums;
import com.doccontrol.common.web.ConflictException;
import com.doccontrol.common.web.ForbiddenException;
import com.doccontrol.common.web.NotFoundException;
import com.doccontrol.identity.User;
import com.doccontrol.identity.UserRepository;
import com.doccontrol.lookup.Department;
import com.doccontrol.lookup.DepartmentRepository;
import com.doccontrol.lookup.DocumentSequenceService;
import com.doccontrol.lookup.DocumentType;
import com.doccontrol.lookup.DocumentTypeRepository;
import com.doccontrol.security.CurrentUserProvider;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class DocumentService {

    /**
     * Statuses visible to every authenticated user under the provisional
     * visibility rule (CLAUDE.md schema decisions). Everything else — draft,
     * in_review, and by conservative extension superseded/obsolete — is
     * restricted to owner and admins. "Assigned reviewers" join in Sprint 3
     * when workflow tasks exist.
     */
    private static final List<DocumentStatus> PUBLIC_STATUSES =
            List.of(DocumentStatus.APPROVED, DocumentStatus.RELEASED);

    private final DocumentRepository documentRepository;
    private final DocumentVersionRepository documentVersionRepository;
    private final DocumentTypeRepository documentTypeRepository;
    private final DepartmentRepository departmentRepository;
    private final UserRepository userRepository;
    private final com.doccontrol.identity.UserDepartmentRepository userDepartmentRepository;
    private final DocumentSequenceService documentSequenceService;
    private final AuditService auditService;
    private final CurrentUserProvider currentUserProvider;
    private final com.doccontrol.workflow.ReviewerAccess reviewerAccess;

    public DocumentService(DocumentRepository documentRepository,
                           DocumentVersionRepository documentVersionRepository,
                           DocumentTypeRepository documentTypeRepository,
                           DepartmentRepository departmentRepository,
                           UserRepository userRepository,
                           com.doccontrol.identity.UserDepartmentRepository userDepartmentRepository,
                           DocumentSequenceService documentSequenceService,
                           AuditService auditService,
                           CurrentUserProvider currentUserProvider,
                           com.doccontrol.workflow.ReviewerAccess reviewerAccess) {
        this.documentRepository = documentRepository;
        this.documentVersionRepository = documentVersionRepository;
        this.documentTypeRepository = documentTypeRepository;
        this.departmentRepository = departmentRepository;
        this.userRepository = userRepository;
        this.userDepartmentRepository = userDepartmentRepository;
        this.documentSequenceService = documentSequenceService;
        this.auditService = auditService;
        this.currentUserProvider = currentUserProvider;
        this.reviewerAccess = reviewerAccess;
    }

    private List<String> reviewerRoleNames() {
        return currentUserProvider.getCurrentUserRoleNames();
    }

    @Transactional
    public DocumentDto create(Integer documentTypeId, Integer departmentId, String name) {
        DocumentType type = requireActiveType(documentTypeId);
        Department department = requireActiveDepartment(departmentId);
        // Phase 2a: only members of a department (or admins) create in it
        requireDepartmentMember(department);

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
                "department", department.getCode()));

        return DocumentDto.from(document);
    }

    /** The visible-document gate shared with the version endpoints. */
    public Document requireVisible(Integer id) {
        return findVisible(id);
    }

    /** Owner-or-admin gate shared with the version endpoints. */
    public void requireCanModify(Document document) {
        if (!canModify(document)) {
            throw new ForbiddenException("Only the document owner or an admin can modify this document.");
        }
    }

    /**
     * Phase 2a permission rule: admins are unrestricted; otherwise only
     * members of the document's department may modify it (create/edit/upload/
     * trash). Ownership no longer grants edit rights by itself — ownership
     * transfers are restricted to department members, so owners remain
     * members.
     *
     * Extension seam: named-user overrides (roadmap #3, "Later") plug in here
     * as an additional clause backed by an override table alongside this
     * department rule — not a replacement of it.
     */
    public boolean canModify(Document document) {
        if (currentUserProvider.isAdmin()) {
            return true;
        }
        return isDepartmentMember(document.getDepartment().getId());
    }

    @Transactional(readOnly = true)
    public DocumentDto get(Integer id) {
        Document document = findVisible(id);
        return DocumentDto.from(document);
    }

    @Transactional(readOnly = true)
    public DocumentsPageDto list(String typeCode, String departmentCode, DocumentStatus status,
                                 String q, int page, int pageSize) {
        Pageable pageable = PageRequest.of(page, Math.min(pageSize, 100),
                Sort.by(Sort.Direction.DESC, "createdAt").and(Sort.by(Sort.Direction.DESC, "id")));

        List<Specification<Document>> parts = new ArrayList<>();
        parts.add(notDeleted());
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
            parts.add((root, query, cb) -> cb.like(cb.lower(root.get("name")), "%" + needle + "%"));
        }
        // Permission filtering happens here, in the query — not hidden in the
        // frontend (CLAUDE.md convention 4). Assigned reviewers also see the
        // drafts they are reviewing (provisional visibility rule).
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

        Specification<Document> spec = Specification.allOf(parts);
        Page<DocumentSummaryDto> result = documentRepository.findAll(spec, pageable)
                .map(DocumentSummaryDto::from);
        return DocumentsPageDto.from(result);
    }

    @Transactional
    public DocumentDto update(Integer id, UpdateDocumentRequest request) {
        Document document = findVisible(id);
        requireCanModify(document);

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
            // keep the invariant that the owner can edit the document: the new
            // owner must belong to the document's department
            if (!isDepartmentMember(newOwner.getId(), document.getDepartment().getId())) {
                throw new ForbiddenException(
                        "The new owner must be a member of department '" + document.getDepartment().getCode() + "'.");
            }
            before.put("owner_user_id", document.getOwner().getId());
            after.put("owner_user_id", newOwner.getId());
            document.setOwner(newOwner);
        }

        if (!after.isEmpty()) {
            auditService.record("document", id, "updated", Map.of("before", before, "after", after));
        }

        return DocumentDto.from(document);
    }

    /** Soft delete — moves to trash, never purges (CLAUDE.md schema decisions). */
    @Transactional
    public void delete(Integer id) {
        Document document = findVisible(id);
        requireCanModify(document);

        if (document.getDeletedAt() == null) {
            document.setDeletedAt(LocalDateTime.now());
            auditService.record("document", id, "deleted", Map.of("soft_delete", true));
        }
    }

    @Transactional
    public DocumentDto restore(Integer id) {
        Document document = findVisible(id);
        requireCanModify(document);

        if (document.getDeletedAt() != null) {
            document.setDeletedAt(null);
            auditService.record("document", id, "restored", Map.of());
        }
        return DocumentDto.from(document);
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
     * Publishes an approved version (Phase 2b): identical pointer/status/
     * audit semantics the admin status override used, now driven by the
     * workflow engine when an approval completes.
     */
    @Transactional
    public void promoteVersion(DocumentVersion version) {
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

        if (document.getStatus() != DocumentStatus.RELEASED) {
            DocumentStatus previousStatus = document.getStatus();
            document.setStatus(DocumentStatus.RELEASED);
            Map<String, Object> before = new LinkedHashMap<>();
            before.put("status", previousStatus == null ? "unknown" : previousStatus.getValue());
            before.put("current_version_id", pointerBefore);
            Map<String, Object> after = new LinkedHashMap<>();
            after.put("status", DocumentStatus.RELEASED.getValue());
            after.put("current_version_id", version.getId());
            auditService.record("document", document.getId(), "status_changed",
                    Map.of("before", before, "after", after));
        } else if (!pointerBefore.equals(version.getId())) {
            auditService.record("document", document.getId(), "updated", Map.of(
                    "before", Map.of("current_version_id", pointerBefore),
                    "after", Map.of("current_version_id", version.getId())));
        }
    }

    private Specification<Document> notDeleted() {
        return (root, query, cb) -> cb.isNull(root.get("deletedAt"));
    }

    private java.util.Set<Integer> currentUserDepartmentIds() {
        return currentUserProvider.getCurrentUserDepartmentIds();
    }

    private void requireDepartmentMember(Department department) {
        if (!currentUserProvider.isAdmin() && !isDepartmentMember(department.getId())) {
            throw new ForbiddenException("Only members of department '" + department.getCode()
                    + "' can create documents in it.");
        }
    }

    private boolean isDepartmentMember(Integer departmentId) {
        return isDepartmentMember(currentUserProvider.getCurrentUserId(), departmentId);
    }

    private boolean isDepartmentMember(Integer userId, Integer departmentId) {
        return userDepartmentRepository.existsById(
                new com.doccontrol.identity.UserDepartmentId(userId, departmentId));
    }
}
