package com.doccontrol.lookup;

import com.doccontrol.audit.AuditService;
import com.doccontrol.common.web.ConflictException;
import com.doccontrol.common.web.NotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Departments are pure lookup data (CLAUDE.md convention 3): creating one is
 * a data change, and this service is exactly that — no code changes anywhere
 * else when a new department appears.
 */
@Service
public class DepartmentService {

    private final DepartmentRepository departmentRepository;
    private final AuditService auditService;

    public DepartmentService(DepartmentRepository departmentRepository, AuditService auditService) {
        this.departmentRepository = departmentRepository;
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
        Department department = departmentRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Department " + id + " not found."));

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
}
