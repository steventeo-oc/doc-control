package com.doccontrol.audit;

import com.doccontrol.common.web.NotFoundException;
import com.doccontrol.identity.User;
import com.doccontrol.identity.UserRepository;
import org.springframework.stereotype.Component;

/**
 * The non-login "System" user (created by migration V6, active = false) —
 * the audit actor for state mutations driven by the daily job, where no
 * security context exists (plan-back flag F5). audit_log.performed_by stays
 * mandatory; auditors see a clean "the system did this" trail.
 */
@Component
public class SystemActor {

    public static final String EMAIL = "system@doccontrol.internal";

    private final UserRepository userRepository;

    public SystemActor(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public User get() {
        return userRepository.findByEmailIgnoreCase(EMAIL)
                .orElseThrow(() -> new NotFoundException(
                        "System actor user missing — migration V6 must have run."));
    }
}
