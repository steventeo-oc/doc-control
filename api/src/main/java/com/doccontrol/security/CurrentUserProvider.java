package com.doccontrol.security;

import com.doccontrol.identity.User;
import com.doccontrol.identity.UserDepartment;
import com.doccontrol.identity.UserDepartmentRepository;
import com.doccontrol.identity.UserRepository;
import com.doccontrol.identity.UserRole;
import com.doccontrol.identity.UserRoleRepository;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@Component
public class CurrentUserProvider {

    private final UserRepository userRepository;
    private final UserDepartmentRepository userDepartmentRepository;
    private final UserRoleRepository userRoleRepository;

    public CurrentUserProvider(UserRepository userRepository,
                               UserDepartmentRepository userDepartmentRepository,
                               UserRoleRepository userRoleRepository) {
        this.userRepository = userRepository;
        this.userDepartmentRepository = userDepartmentRepository;
        this.userRoleRepository = userRoleRepository;
    }

    /**
     * The caller's department ids, read from the database (authoritative) —
     * entity collections can be stale within long-lived persistence contexts.
     */
    public java.util.Set<Integer> getCurrentUserDepartmentIds() {
        return userDepartmentRepository.findByUserId(getCurrentUserId()).stream()
                .map(UserDepartment::getDepartment)
                .map(department -> department.getId())
                .collect(java.util.stream.Collectors.toSet());
    }

    /** The caller's role names, read from the database (authoritative). */
    public List<String> getCurrentUserRoleNames() {
        return userRoleRepository.findByUserId(getCurrentUserId()).stream()
                .map(UserRole::getRole)
                .map(role -> role.getName())
                .toList();
    }

    /**
     * The authenticated caller as our User entity, for ownership checks and
     * audit_log.performed_by. Returns a lazy reference — safe to use for FKs
     * inside a transaction.
     */
    public User getCurrentUser() {
        return userRepository.getReferenceById(getCurrentUserId());
    }

    public Integer getCurrentUserId() {
        return principal().getUserId();
    }

    /** True when the caller holds the Admin role (checked on authorities, no DB hit). */
    public boolean isAdmin() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        return authentication != null && authentication.getAuthorities().stream()
                .anyMatch(authority -> "ROLE_ADMIN".equals(authority.getAuthority()));
    }

    private AppUserPrincipal principal() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.getPrincipal() instanceof AppUserPrincipal principal) {
            return principal;
        }
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "No authenticated user.");
    }
}
