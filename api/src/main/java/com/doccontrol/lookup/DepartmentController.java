package com.doccontrol.lookup;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.List;

/**
 * Reads are open to any authenticated user; writes are admin-only (enforced
 * in SecurityConfig, see the /departments/** rule).
 */
@RestController
@RequestMapping("/departments")
public class DepartmentController {

    private final DepartmentRepository departmentRepository;
    private final DepartmentService departmentService;

    public DepartmentController(DepartmentRepository departmentRepository, DepartmentService departmentService) {
        this.departmentRepository = departmentRepository;
        this.departmentService = departmentService;
    }

    @GetMapping
    public List<DepartmentDto> list() {
        return departmentRepository.findAllByActiveTrueOrderByCodeAsc().stream()
                .map(DepartmentDto::from)
                .toList();
    }

    @PostMapping
    public ResponseEntity<DepartmentDto> create(@Valid @RequestBody CreateDepartmentRequest request) {
        DepartmentDto created = departmentService.create(request);
        return ResponseEntity
                .created(URI.create("/departments/" + created.id()))
                .body(created);
    }

    @PatchMapping("/{id}")
    public DepartmentDto update(@PathVariable Integer id,
                                @Valid @RequestBody UpdateDepartmentRequest request) {
        return departmentService.update(id, request);
    }
}
