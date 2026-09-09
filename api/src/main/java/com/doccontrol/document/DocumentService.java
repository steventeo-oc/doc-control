package com.doccontrol.document;

import com.doccontrol.audit.AuditService;
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
    private final DocumentTypeRepository documentTypeRepository;
    private final DepartmentRepository departmentRepository;
    private final UserRepository userRepository;
    private final DocumentSequenceService documentSequenceService;
    private final AuditService auditService;
    private final CurrentUserProvider currentUserProvider;

    public DocumentService(DocumentRepository documentRepository,
                           DocumentTypeRepository documentTypeRepository,
                           DepartmentRepository departmentRepository,
                           UserRepository userRepository,
                           DocumentSequenceService documentSequenceService,
                           AuditService auditService,
                           CurrentUserProvider currentUserProvider) {
        this.documentRepository = documentRepository;
        this.documentTypeRepository = documentTypeRepository;
        this.departmentRepository = departmentRepository;
        this.userRepository = userRepository;
        this.documentSequenceService = documentSequenceService;
        this.auditService = auditService;
        this.currentUserProvider = currentUserProvider;
    }

    @Transactional
    public DocumentDto create(Integer documentTypeId, Integer departmentId, String name) {
        DocumentType type = requireActiveType(documentTypeId);
        Department department = requireActiveDepartment(departmentId);

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
        boolean isOwner = document.getOwner().getId().equals(currentUserProvider.getCurrentUserId());
        if (!isOwner && !currentUserProvider.isAdmin()) {
            throw new ForbiddenException("Only the document owner or an admin can modify this document.");
        }
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
        // frontend (CLAUDE.md convention 4).
        if (!currentUserProvider.isAdmin()) {
            Integer userId = currentUserProvider.getCurrentUserId();
            parts.add((root, query, cb) -> cb.or(
                    root.get("status").in(PUBLIC_STATUSES),
                    cb.equal(root.get("owner").get("id"), userId)));
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
        if (!isOwner && !currentUserProvider.isAdmin() && !PUBLIC_STATUSES.contains(document.getStatus())) {
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

    private Specification<Document> notDeleted() {
        return (root, query, cb) -> cb.isNull(root.get("deletedAt"));
    }
}
