package com.doccontrol.lookup;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.List;

/**
 * Reads are open to any authenticated user; writes are admin-only (enforced
 * in SecurityConfig, see the /departments/** rule — usage reads too, so the
 * deactivate/delete confirmation numbers match the write surface).
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

    /**
     * Active rows only by default; `includeInactive=true` is the admin and
     * filter shape (plan-back F2) — deactivated departments stay visible
     * for reactivation and for searching the documents that reference them.
     */
    @GetMapping
    public List<DepartmentDto> list(
            @RequestParam(value = "includeInactive", required = false, defaultValue = "false")
            boolean includeInactive) {
        return (includeInactive
                ? departmentRepository.findAllByOrderByCodeAsc()
                : departmentRepository.findAllByActiveTrueOrderByCodeAsc())
                .stream()
                .map(DepartmentDto::from)
                .toList();
    }

    @GetMapping("/{id}")
    public DepartmentDto get(@PathVariable Integer id) {
        return departmentService.get(id);
    }

    @GetMapping("/{id}/usage")
    public DepartmentUsageDto usage(@PathVariable Integer id) {
        return departmentService.usage(id);
    }

    /** Manager self-service (department levels plan-back F5): members + levels. */
    @GetMapping("/{id}/members")
    public List<DepartmentMemberDto> members(@PathVariable Integer id) {
        return departmentService.members(id);
    }

    @GetMapping("/{id}/available-users")
    public List<DepartmentCandidateUserDto> availableUsers(
            @PathVariable Integer id,
            @RequestParam(value = "q", required = false) String q,
            @RequestParam(value = "limit", required = false, defaultValue = "30") int limit) {
        return departmentService.availableUsers(id, q, limit);
    }

    @PostMapping("/{id}/members")
    public ResponseEntity<DepartmentMemberDto> addMember(
            @PathVariable Integer id,
            @Valid @RequestBody AddDepartmentMemberRequest request) {
        DepartmentMemberDto created = departmentService.addMember(id, request);
        return ResponseEntity
                .created(URI.create("/departments/" + id + "/members/" + created.userId()))
                .body(created);
    }

    @DeleteMapping("/{id}/members/{userId}")
    public ResponseEntity<Void> removeMember(
            @PathVariable Integer id,
            @PathVariable Integer userId) {
        departmentService.removeMember(id, userId);
        return ResponseEntity.noContent().build();
    }

    @PatchMapping("/{id}/members/{userId}")
    public DepartmentMemberDto updateMemberLevel(@PathVariable Integer id,
                                                 @PathVariable Integer userId,
                                                 @Valid @RequestBody UpdateMemberLevelRequest request) {
        return departmentService.updateMemberLevel(id, userId, request);
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

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Integer id) {
        departmentService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
