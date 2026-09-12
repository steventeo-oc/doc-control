package com.doccontrol.lookup;

import com.doccontrol.audit.AuditService;
import com.doccontrol.common.web.ConflictException;
import com.doccontrol.common.web.DeletionBlockedException;
import com.doccontrol.common.web.NotFoundException;
import com.doccontrol.document.DocumentRepository;
import com.doccontrol.identity.UserDepartment;
import com.doccontrol.identity.UserDepartmentRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Departments are pure lookup data (CLAUDE.md convention 3): creating one is
 * a data change, and this service is exactly that — no code changes anywhere
 * else when a new department appears. Deactivation is the lifecycle for
 * anything referenced; hard delete is only for rows nothing points at
 * (lookup admin plan-back F1–F4).
 */
@Service
public class DepartmentService {

    private final DepartmentRepository departmentRepository;
    private final DocumentRepository documentRepository;
    private final UserDepartmentRepository userDepartmentRepository;
    private final DocumentSequenceCounterRepository documentSequenceCounterRepository;
    private final AuditService auditService;

    public DepartmentService(DepartmentRepository departmentRepository,
                             DocumentRepository documentRepository,
                             UserDepartmentRepository userDepartmentRepository,
                             DocumentSequenceCounterRepository documentSequenceCounterRepository,
                             AuditService auditService) {
        this.departmentRepository = departmentRepository;
        this.documentRepository = documentRepository;
        this.userDepartmentRepository = userDepartmentRepository;
        this.documentSequenceCounterRepository = documentSequenceCounterRepository;
        this.auditService = auditService;
    }

    @Transactional
    public DepartmentDto create(CreateDepartmentRequest request) {
        if (departmentRepository.findByCode(request.code()).isPresent()) {
            throw new ConflictException("Department code '" + request.code() + "' already exists.");
        }

        Department department = new Department();
        department.setCode(request.code());
        department.setLabel(request.label());
        department.setActive(true);
        departmentRepository.save(department);

        auditService.record("department", department.getId(), "created",
                Map.of("code", department.getCode(), "label", department.getLabel()));

        return DepartmentDto.from(department);
    }

    @Transactional
    public DepartmentDto update(Integer id, UpdateDepartmentRequest request) {
        Department department = requireDepartment(id);

        Map<String, Object> before = new LinkedHashMap<>();
        Map<String, Object> after = new LinkedHashMap<>();

        if (request.label() != null && !request.label().equals(department.getLabel())) {
            before.put("label", department.getLabel());
            after.put("label", request.label());
            department.setLabel(request.label());
        }
        if (request.active() != null && request.active() != department.isActive()) {
            before.put("active", department.isActive());
            after.put("active", request.active());
            department.setActive(request.active());
        }

        if (!after.isEmpty()) {
            auditService.record("department", id, "updated", Map.of("before", before, "after", after));
        }

        return DepartmentDto.from(department);
    }

    /** Counts powering the deactivate confirmation (plan-back F1). */
    @Transactional(readOnly = true)
    public DepartmentUsageDto usage(Integer id) {
        requireDepartment(id);
        return new DepartmentUsageDto(
                documentRepository.countByDepartmentId(id),
                userDepartmentRepository.countActiveUsersByDepartmentId(id));
    }

    /**
     * Hard delete (plan-back F4): blocked while any document — including
     * soft-deleted ones, whose FKs are as live as ever — references the
     * department; otherwise the membership and sequence-counter rows go
     * with it, and the audit details list exactly which users were
     * detached (the re-add reference after a future re-creation, D7).
     */
    @Transactional
    public void delete(Integer id) {
        Department department = requireDepartment(id);
        long documents = documentRepository.countByDepartmentId(id);
        if (documents > 0) {
            throw new DeletionBlockedException(
                    documents + " document(s) (including soft-deleted) reference department '"
                            + department.getCode() + "' — deactivate it instead of deleting.",
                    Map.of("documents", documents));
        }

        List<UserDepartment> memberships = userDepartmentRepository.findAllByDepartmentId(id);
        List<Integer> removedUserIds = memberships.stream()
                .map(membership -> membership.getUser().getId())
                .toList();
        long counters = documentSequenceCounterRepository.deleteByDepartmentId(id);
        userDepartmentRepository.deleteAll(memberships);
        departmentRepository.delete(department);

        auditService.record("department", id, "deleted", Map.of(
                "code", department.getCode(),
                "label", department.getLabel(),
                "removed_user_ids", removedUserIds,
                "removed_sequence_counters", counters));
    }

    private Department requireDepartment(Integer id) {
        return departmentRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Department " + id + " not found."));
    }
}
