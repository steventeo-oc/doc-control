package com.doccontrol.lookup;

import com.doccontrol.audit.AuditService;
import com.doccontrol.common.web.ConflictException;
import com.doccontrol.common.web.DeletionBlockedException;
import com.doccontrol.common.web.ForbiddenException;
import com.doccontrol.common.web.NotFoundException;
import com.doccontrol.document.DocumentRepository;
import com.doccontrol.identity.DepartmentAccessService;
import com.doccontrol.identity.UserDepartment;
import com.doccontrol.identity.UserDepartmentId;
import com.doccontrol.identity.UserDepartmentRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Departments are pure lookup data (CLAUDE.md convention 3): creating one is
 * a data change, and this service is exactly that — no code changes anywhere
 * else when a new department appears. Deactivation is the lifecycle for
 * anything referenced; hard delete is only for rows nothing points at
 * (lookup admin plan-back F1–F4). Member level management is the Manager
 * self-service surface (department levels plan-back F5).
 */
@Service
public class DepartmentService {

    private final DepartmentRepository departmentRepository;
    private final DocumentRepository documentRepository;
    private final UserDepartmentRepository userDepartmentRepository;
    private final DocumentSequenceCounterRepository documentSequenceCounterRepository;
    private final DepartmentAccessService departmentAccessService;
    private final AuditService auditService;
    private final com.doccontrol.identity.UserRepository userRepository;

    public DepartmentService(DepartmentRepository departmentRepository,
                             DocumentRepository documentRepository,
                             UserDepartmentRepository userDepartmentRepository,
                             DocumentSequenceCounterRepository documentSequenceCounterRepository,
                             DepartmentAccessService departmentAccessService,
                             AuditService auditService,
                             com.doccontrol.identity.UserRepository userRepository) {
        this.departmentRepository = departmentRepository;
        this.documentRepository = documentRepository;
        this.userDepartmentRepository = userDepartmentRepository;
        this.documentSequenceCounterRepository = documentSequenceCounterRepository;
        this.departmentAccessService = departmentAccessService;
        this.auditService = auditService;
        this.userRepository = userRepository;
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
                Map.of("code", department.getCode(), "label", department.getLabel()), department);

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
            auditService.record("department", id, "updated", Map.of("before", before, "after", after),
                    department);
        }

        return DepartmentDto.from(department);
    }

    @Transactional(readOnly = true)
    public DepartmentDto get(Integer id) {
        return DepartmentDto.from(requireDepartment(id));
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
     * The department's members with their levels — the Manager self-service
     * surface (department levels plan-back F5). Only a Manager of the
     * department (or an admin) may see and manage them.
     */
    @Transactional(readOnly = true)
    public List<DepartmentMemberDto> members(Integer id) {
        requireDepartment(id);
        requireMemberManager(id);
        return userDepartmentRepository.findAllByDepartmentId(id).stream()
                .map(DepartmentMemberDto::from)
                .sorted(Comparator.comparing(DepartmentMemberDto::name))
                .toList();
    }

    /**
     * Active users who are not currently members of this department — candidate
     * list for Manager self-service member onboarding. Supports search by name/email
     * and result limiting for large organizations.
     */
    @Transactional(readOnly = true)
    public List<DepartmentCandidateUserDto> availableUsers(Integer id, String q, int limit) {
        requireDepartment(id);
        requireMemberManager(id);
        List<Integer> existingUserIds = userDepartmentRepository.findAllByDepartmentId(id).stream()
                .map(membership -> membership.getUser().getId())
                .toList();

        int maxResults = Math.min(Math.max(limit, 1), 100);
        String query = q != null ? q.trim().toLowerCase() : "";

        return userRepository.findAllByActiveTrueOrderByNameAsc().stream()
                .filter(u -> !existingUserIds.contains(u.getId()))
                .filter(u -> query.isEmpty()
                        || (u.getName() != null && u.getName().toLowerCase().contains(query))
                        || (u.getEmail() != null && u.getEmail().toLowerCase().contains(query)))
                .limit(maxResults)
                .map(DepartmentCandidateUserDto::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<DepartmentCandidateUserDto> availableUsers(Integer id) {
        return availableUsers(id, null, 100);
    }

    /**
     * Adds an existing active user to the department with an explicit level.
     */
    @Transactional
    public DepartmentMemberDto addMember(Integer id, AddDepartmentMemberRequest request) {
        Department department = requireDepartment(id);
        requireMemberManager(id);

        com.doccontrol.identity.User user = userRepository.findById(request.userId())
                .orElseThrow(() -> new NotFoundException("User " + request.userId() + " not found."));
        if (!user.isActive()) {
            throw new ConflictException("User " + user.getEmail() + " is inactive and cannot be added.");
        }

        UserDepartmentId membershipId = new UserDepartmentId(user.getId(), department.getId());
        if (userDepartmentRepository.existsById(membershipId)) {
            throw new ConflictException("User " + user.getEmail() + " is already a member of department '" + department.getCode() + "'.");
        }

        UserDepartment membership = new UserDepartment();
        membership.setId(membershipId);
        membership.setUser(user);
        membership.setDepartment(department);
        membership.setLevel(request.level());
        userDepartmentRepository.save(membership);

        auditService.record("department", id, "member_added", Map.of(
                "user_id", user.getId(),
                "user_email", user.getEmail(),
                "level", request.level().toString()), department);

        return DepartmentMemberDto.from(membership);
    }

    /**
     * Removes a member from the department.
     */
    @Transactional
    public void removeMember(Integer id, Integer userId) {
        Department department = requireDepartment(id);
        requireMemberManager(id);

        UserDepartment membership = userDepartmentRepository
                .findById(new UserDepartmentId(userId, id))
                .orElseThrow(() -> new NotFoundException("User " + userId
                        + " is not a member of department '" + department.getCode() + "'."));

        com.doccontrol.identity.User user = membership.getUser();
        com.doccontrol.identity.MembershipLevel level = membership.getLevel();
        userDepartmentRepository.delete(membership);

        auditService.record("department", id, "member_removed", Map.of(
                "user_id", userId,
                "user_email", user.getEmail(),
                "level", level.toString()), department);
    }

    /**
     * Changes one member's level (plan-back F5): Manager of the department
     * or admin; self-changes included (D2) — a Manager demoting themselves
     * simply leaves level management to the admins if they were the last
     * one. The audit row lands under the department with the user, the old
     * level and the new level.
     */
    @Transactional
    public DepartmentMemberDto updateMemberLevel(Integer id, Integer userId,
                                                 UpdateMemberLevelRequest request) {
        Department department = requireDepartment(id);
        requireMemberManager(id);

        UserDepartment membership = userDepartmentRepository
                .findById(new UserDepartmentId(userId, id))
                .orElseThrow(() -> new NotFoundException("User " + userId
                        + " is not a member of department '" + department.getCode() + "'."));

        com.doccontrol.identity.MembershipLevel before = membership.getLevel();
        membership.setLevel(request.level());
        auditService.record("department", id, "member_level_changed", Map.of(
                "user_id", userId,
                "user_email", membership.getUser().getEmail(),
                "before", before.toString(),
                "after", request.level().toString()), department);
        return DepartmentMemberDto.from(membership);
    }

    private void requireMemberManager(Integer departmentId) {
        if (!departmentAccessService.canManageMembers(departmentId)) {
            throw new ForbiddenException("Only a Manager of department '"
                    + requireDepartment(departmentId).getCode()
                    + "' (or an admin) can view or manage its members.");
        }
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
