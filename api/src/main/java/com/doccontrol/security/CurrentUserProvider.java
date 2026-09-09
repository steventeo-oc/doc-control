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
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.getPrincipal() instanceof AppUserPrincipal principal) {
            return userRepository.getReferenceById(principal.getUserId());
        }
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "No authenticated user.");
    }
}
