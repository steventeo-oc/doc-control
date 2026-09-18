package com.doccontrol.audit;

import com.doccontrol.common.web.ForbiddenException;
import com.doccontrol.identity.User;
import com.doccontrol.identity.UserDepartmentRepository;
import com.doccontrol.lookup.DepartmentRepository;
import com.doccontrol.security.CurrentUserProvider;
import com.doccontrol.document.DocumentVersionRepository;
import com.doccontrol.workflow.WorkflowInstanceRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * The read side of the audit trail (activity plan-back, approved
 * 2026-09-14): one permission-scoped query behind GET /audit-log, the
 * admin CSV export, and the dashboard card. Scoping is server-enforced —
 * a non-admin may only ever see rows performed by them or belonging to
 * their own departments; company scope is admin-only and refused with 403
 * for anyone else (never silently clamped). Rows with a NULL
 * department_id (lookup config, user rows, sweep triggers, deleted
 * departments) are invisible to department scope by design — there is no
 * department to match.
 */
@Service
public class AuditLogQueryService {

    public enum Scope {
        MINE, DEPARTMENTS, COMPANY;

        /** Case-insensitive lookup for the query param. */
        public static Scope parse(String value) {
            return Scope.valueOf(value.trim().toUpperCase());
        }
    }

    /** One activity row as the API returns it. */
    public record AuditLogDto(Integer id, LocalDateTime performedAt, String actorName,
                              String actorEmail, String entityType, String action,
                              Integer entityId, Integer departmentId, String departmentCode,
                              Map<String, Object> details) {
    }

    /** Page payload — mirrors the documents-list shape. */
    public record AuditLogPageDto(List<AuditLogDto> content, int page, int pageSize,
                                  long totalElements, int totalPages) {

        static AuditLogPageDto from(Page<AuditLogDto> page) {
            return new AuditLogPageDto(
                    page.getContent(),
                    page.getNumber(),
                    page.getSize(),
                    page.getTotalElements(),
                    page.getTotalPages());
        }
    }

    private static final int MAX_PAGE_SIZE = 100;

    private final AuditLogRepository auditLogRepository;
    private final UserDepartmentRepository userDepartmentRepository;
    private final DepartmentRepository departmentRepository;
    private final CurrentUserProvider currentUserProvider;
    private final WorkflowInstanceRepository workflowInstanceRepository;
    private final DocumentVersionRepository documentVersionRepository;

    public AuditLogQueryService(AuditLogRepository auditLogRepository,
                                UserDepartmentRepository userDepartmentRepository,
                                DepartmentRepository departmentRepository,
                                CurrentUserProvider currentUserProvider,
                                WorkflowInstanceRepository workflowInstanceRepository,
                                DocumentVersionRepository documentVersionRepository) {
        this.auditLogRepository = auditLogRepository;
        this.userDepartmentRepository = userDepartmentRepository;
        this.departmentRepository = departmentRepository;
        this.currentUserProvider = currentUserProvider;
        this.workflowInstanceRepository = workflowInstanceRepository;
        this.documentVersionRepository = documentVersionRepository;
    }

    /**
     * The scoped, filtered, paged query. {@code from}/{@code to} are
     * inclusive calendar dates on performed_at (the spec's original
     * params; the UI's Today/7/14/28 presets compute them client-side).
     */
    @Transactional(readOnly = true)
    public AuditLogPageDto query(User viewer, Scope scope, ActivityCategory category,
                                 LocalDate from, LocalDate to, int page, int pageSize) {
        return query(viewer, scope, category, null, null, from, to, page, pageSize);
    }

    @Transactional(readOnly = true)
    public AuditLogPageDto query(User viewer, Scope scope, ActivityCategory category,
                                 Integer departmentId, String q,
                                 LocalDate from, LocalDate to, int page, int pageSize) {
        requireScopeAllowed(viewer, scope);
        Pageable pageable = PageRequest.of(Math.max(page, 0), Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE),
                Sort.by(Sort.Direction.DESC, "performedAt", "id"));
        Page<AuditLog> result = auditLogRepository.findAll(
                specification(viewer, scope, category, departmentId, q, from, to), pageable);
        Map<Integer, String> codes = departmentCodesFor(result.getContent());
        return AuditLogPageDto.from(result.map(entry -> toDto(entry, codes)));
    }

    /**
     * Department-specific audit log query for the department activity tab.
     */
    @Transactional(readOnly = true)
    public AuditLogPageDto queryForDepartment(Integer departmentId, int page, int pageSize) {
        Pageable pageable = PageRequest.of(Math.max(page, 0), Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE),
                Sort.by(Sort.Direction.DESC, "performedAt", "id"));
        Specification<AuditLog> spec = (root, q, cb) -> cb.or(
                cb.equal(root.get("departmentId"), departmentId),
                cb.and(cb.equal(root.get("entityType"), "DEPARTMENT"), cb.equal(root.get("entityId"), departmentId))
        );
        Page<AuditLog> result = auditLogRepository.findAll(spec, pageable);
        Map<Integer, String> codes = departmentCodesFor(result.getContent());
        return AuditLogPageDto.from(result.map(entry -> toDto(entry, codes)));
    }

    /**
     * Unpaged rows for the admin CSV export (activity plan-back section 1).
     * Admin-only here as well as at the route — the same 403 rule as
     * company scope, enforced no matter who calls.
     */
    @Transactional(readOnly = true)
    public List<AuditLogDto> exportRows(User viewer, Scope scope, ActivityCategory category,
                                        LocalDate from, LocalDate to) {
        return exportRows(viewer, scope, category, null, null, from, to);
    }

    @Transactional(readOnly = true)
    public List<AuditLogDto> exportRows(User viewer, Scope scope, ActivityCategory category,
                                        Integer departmentId, String q,
                                        LocalDate from, LocalDate to) {
        if (!currentUserProvider.isAdmin()) {
            throw new ForbiddenException("Only admins can export the audit log.");
        }
        requireScopeAllowed(viewer, scope);
        List<AuditLog> rows = auditLogRepository.findAll(
                specification(viewer, scope, category, departmentId, q, from, to),
                Sort.by(Sort.Direction.DESC, "performedAt", "id"));
        Map<Integer, String> codes = departmentCodesFor(rows);
        return rows.stream().map(entry -> toDto(entry, codes)).toList();
    }

    private void requireScopeAllowed(User viewer, Scope scope) {
        if (scope == Scope.COMPANY && !currentUserProvider.isAdmin()) {
            throw new ForbiddenException(
                    "Company-wide activity is only visible to admins.");
        }
    }

    /** Department codes in one batch — the rows carry only the FK integer. */
    private Map<Integer, String> departmentCodesFor(List<AuditLog> rows) {
        List<Integer> ids = rows.stream().map(AuditLog::getDepartmentId)
                .filter(id -> id != null).distinct().toList();
        if (ids.isEmpty()) {
            return Map.of();
        }
        return departmentRepository.findAllById(ids).stream()
                .collect(Collectors.toMap(d -> d.getId(), d -> d.getCode()));
    }

    private AuditLogDto toDto(AuditLog entry, Map<Integer, String> codes) {
        Map<String, Object> details = entry.getDetails() == null ? new HashMap<>() : new HashMap<>(entry.getDetails());
        if ("workflow_instance".equalsIgnoreCase(entry.getEntityType())) {
            if (!details.containsKey("document_id") || !details.containsKey("document_number")) {
                workflowInstanceRepository.findById(entry.getEntityId()).ifPresent(wi -> {
                    if (wi.getDocumentVersion() != null && wi.getDocumentVersion().getDocument() != null) {
                        details.putIfAbsent("document_id", wi.getDocumentVersion().getDocument().getId());
                        details.putIfAbsent("document_number", wi.getDocumentVersion().getDocument().getDocumentNumber());
                    }
                });
            }
        } else if ("document_version".equalsIgnoreCase(entry.getEntityType())) {
            if (!details.containsKey("document_id") || !details.containsKey("document_number")) {
                documentVersionRepository.findById(entry.getEntityId()).ifPresent(dv -> {
                    if (dv.getDocument() != null) {
                        details.putIfAbsent("document_id", dv.getDocument().getId());
                        details.putIfAbsent("document_number", dv.getDocument().getDocumentNumber());
                    }
                });
            }
        }
        return new AuditLogDto(
                entry.getId(),
                entry.getPerformedAt(),
                entry.getPerformedBy().getName(),
                entry.getPerformedBy().getEmail(),
                entry.getEntityType(),
                entry.getAction(),
                entry.getEntityId(),
                entry.getDepartmentId(),
                entry.getDepartmentId() == null ? null : codes.get(entry.getDepartmentId()),
                details);
    }

    private Specification<AuditLog> specification(User viewer, Scope scope,
                                                  ActivityCategory category,
                                                  Integer departmentId, String q,
                                                  LocalDate from, LocalDate to) {
        Specification<AuditLog> spec = switch (scope) {
            case MINE -> (root, query, cb) -> cb.equal(root.get("performedBy").get("id"), viewer.getId());
            case DEPARTMENTS -> {
                List<Integer> departmentIds = userDepartmentRepository.findByUserId(viewer.getId())
                        .stream().map(ud -> ud.getDepartment().getId()).toList();
                // short-circuit: no memberships → no department rows, ever
                yield departmentIds.isEmpty()
                        ? (root, query, cb) -> cb.disjunction()
                        : (root, query, cb) -> root.get("departmentId").in(departmentIds);
            }
            case COMPANY -> (root, query, cb) -> cb.conjunction();
        };
        if (departmentId != null) {
            if (scope == Scope.DEPARTMENTS) {
                List<Integer> departmentIds = userDepartmentRepository.findByUserId(viewer.getId())
                        .stream().map(ud -> ud.getDepartment().getId()).toList();
                if (!departmentIds.contains(departmentId)) {
                    spec = spec.and((root, query, cb) -> cb.disjunction());
                } else {
                    spec = spec.and((root, query, cb) -> cb.equal(root.get("departmentId"), departmentId));
                }
            } else {
                spec = spec.and((root, query, cb) -> cb.equal(root.get("departmentId"), departmentId));
            }
        }
        if (category != null) {
            spec = spec.and((root, query, cb) -> root.get("entityType").in(category.entityTypes()));
        }
        if (from != null) {
            spec = spec.and((root, query, cb) -> cb.greaterThanOrEqualTo(root.get("performedAt"),
                    from.atStartOfDay()));
        }
        if (to != null) {
            spec = spec.and((root, query, cb) -> cb.lessThan(root.get("performedAt"),
                    to.plusDays(1).atStartOfDay()));
        }
        if (q != null && !q.isBlank()) {
            String needle = "%" + q.trim().toLowerCase() + "%";
            spec = spec.and((root, query, cb) -> cb.or(
                    cb.like(cb.lower(root.get("performedBy").get("name")), needle),
                    cb.like(cb.lower(root.get("performedBy").get("email")), needle),
                    cb.like(cb.lower(root.get("action")), needle),
                    cb.like(cb.lower(root.get("entityType")), needle),
                    cb.like(cb.lower(cb.function("text", String.class, root.get("details"))), needle)
            ));
        }
        return spec;
    }
}
