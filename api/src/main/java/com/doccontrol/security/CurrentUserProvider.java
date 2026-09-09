package com.doccontrol.security;

import com.doccontrol.identity.User;
import com.doccontrol.identity.UserRepository;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
public class CurrentUserProvider {

    private final UserRepository userRepository;

    public CurrentUserProvider(UserRepository userRepository) {
        this.userRepository = userRepository;
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
