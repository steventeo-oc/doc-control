package com.doccontrol.identity;

import com.doccontrol.audit.AuditService;
import com.doccontrol.common.web.ConflictException;
import com.doccontrol.common.web.ForbiddenException;
import com.doccontrol.common.web.NotFoundException;
import com.doccontrol.lookup.Department;
import com.doccontrol.lookup.DepartmentRepository;
import com.doccontrol.security.CurrentUserProvider;
import org.springframework.data.domain.Sort;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class UserService {

    private static final String DEFAULT_ROLE = "User";

    private final UserRepository userRepository;
    private final UserRoleRepository userRoleRepository;
    private final RoleRepository roleRepository;
    private final DepartmentRepository departmentRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuditService auditService;
    private final CurrentUserProvider currentUserProvider;

    public UserService(UserRepository userRepository, UserRoleRepository userRoleRepository,
                       RoleRepository roleRepository, DepartmentRepository departmentRepository,
                       PasswordEncoder passwordEncoder, AuditService auditService,
                       CurrentUserProvider currentUserProvider) {
        this.userRepository = userRepository;
        this.userRoleRepository = userRoleRepository;
        this.roleRepository = roleRepository;
        this.departmentRepository = departmentRepository;
        this.passwordEncoder = passwordEncoder;
        this.auditService = auditService;
        this.currentUserProvider = currentUserProvider;
    }

    @Transactional(readOnly = true)
    public List<UserDto> list() {
        return userRepository.findAll(Sort.by(Sort.Direction.ASC, "id")).stream()
                .map(UserDto::from)
                .toList();
    }

    @Transactional
    public UserDto create(CreateUserRequest request) {
        if (userRepository.existsByEmailIgnoreCase(request.email())) {
            throw new ConflictException("A user with email '" + request.email() + "' already exists.");
        }
        Department department = departmentRepository.findById(request.departmentId())
                .orElseThrow(() -> new NotFoundException("Department " + request.departmentId() + " not found."));

        List<String> roleNames = request.roles() == null || request.roles().isEmpty()
                ? List.of(DEFAULT_ROLE)
                : request.roles().stream().distinct().toList();
        List<Role> roles = roleNames.stream()
                .map(name -> roleRepository.findByName(name)
                        .orElseThrow(() -> new NotFoundException("Role '" + name + "' not found.")))
                .toList();

        User user = new User();
        user.setName(request.name());
        user.setEmail(request.email());
        user.setDepartment(department);
        user.setAdUsername(request.adUsername());
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setActive(true);
        userRepository.save(user);

        for (Role role : roles) {
            UserRole membership = new UserRole();
            membership.setId(new UserRoleId(user.getId(), role.getId()));
            membership.setUser(user);
            membership.setRole(role);
            userRoleRepository.save(membership);
            user.getRoles().add(membership);
        }

        auditService.record("user", user.getId(), "created", Map.of(
                "email", user.getEmail(),
                "department", department.getCode(),
                "roles", roleNames));

        return UserDto.from(user);
    }

    @Transactional
    public UserDto update(Integer id, UpdateUserRequest request) {
        User user = userRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("User " + id + " not found."));

        if (request.active() != null && !request.active() && user.getId().equals(currentUserProvider.getCurrentUserId())) {
            throw new ConflictException("You cannot deactivate your own account.");
        }

        Map<String, Object> before = new LinkedHashMap<>();
        Map<String, Object> after = new LinkedHashMap<>();

        if (request.name() != null && !request.name().equals(user.getName())) {
            before.put("name", user.getName());
            after.put("name", request.name());
            user.setName(request.name());
        }
        if (request.departmentId() != null && !request.departmentId().equals(user.getDepartment().getId())) {
            Department department = departmentRepository.findById(request.departmentId())
                    .orElseThrow(() -> new NotFoundException("Department " + request.departmentId() + " not found."));
            before.put("department_id", user.getDepartment().getId());
            after.put("department_id", department.getId());
            user.setDepartment(department);
        }
        if (request.adUsername() != null && !request.adUsername().equals(user.getAdUsername())) {
            before.put("ad_username", user.getAdUsername());
            after.put("ad_username", request.adUsername());
            user.setAdUsername(request.adUsername());
        }
        if (request.active() != null && request.active() != user.isActive()) {
            before.put("active", user.isActive());
            after.put("active", request.active());
            user.setActive(request.active());
        }

        if (!after.isEmpty()) {
            auditService.record("user", id, "updated", Map.of("before", before, "after", after));
        }
        return UserDto.from(user);
    }

    /**
     * Password change (go-live checklist: admin password rotation).
     * Self-service requires the current password as proof of authority over
     * the account; admins may reset other accounts' passwords without it.
     * Passwords themselves never appear in the audit trail.
     */
    @Transactional
    public void changePassword(Integer targetUserId, ChangePasswordRequest request) {
        boolean selfService = currentUserProvider.getCurrentUserId().equals(targetUserId);
        if (!selfService && !currentUserProvider.isAdmin()) {
            throw new ForbiddenException("You can only change your own password.");
        }

        User target = userRepository.findById(targetUserId)
                .orElseThrow(() -> new NotFoundException("User " + targetUserId + " not found."));

        if (selfService) {
            String currentPassword = request.currentPassword();
            if (currentPassword == null || !passwordEncoder.matches(currentPassword, target.getPasswordHash())) {
                throw new IllegalArgumentException("Current password is incorrect.");
            }
        }

        target.setPasswordHash(passwordEncoder.encode(request.newPassword()));
        auditService.record("user", targetUserId, "password_changed", Map.of(
                "self_service", selfService));
    }
}
