package com.doccontrol.security;

import com.doccontrol.identity.User;
import com.doccontrol.identity.UserRepository;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserRequest;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserService;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.stereotype.Service;

/**
 * OIDC login for "Sign in with Microsoft" (Microsoft_SSO_PlanBack.md).
 * Microsoft only proves identity; the account MUST already exist locally —
 * matched case-insensitively by email (the same uniqueness rule the user
 * table enforces) and active — with no auto-provisioning and no default
 * role: anything else is rejected before a session can exist. On success
 * the default OidcUser flows on to {@link SsoAuthenticationSuccessHandler},
 * which bridges the session onto our own principal type, because the rest
 * of the app (CurrentUserProvider, every hasRole() check) hard-requires
 * AppUserPrincipal and would 401 a stock OidcUser session.
 */
@Service
public class SsoUserDetailsService extends OidcUserService {

    /** Error code the failure handler maps to the SPA's ?error= parameter. */
    public static final String NO_ACCOUNT_ERROR = "sso_no_account";

    private final UserRepository userRepository;

    public SsoUserDetailsService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Override
    public OidcUser loadUser(OidcUserRequest userRequest) throws OAuth2AuthenticationException {
        String email = resolveEmail(userRequest.getIdToken());
        if (email == null) {
            throw noAccount();
        }
        userRepository.findByEmailIgnoreCase(email)
                .filter(User::isActive)
                .orElseThrow(this::noAccount);
        return super.loadUser(userRequest);
    }

    /**
     * The identity we match on: the `email` claim, falling back to Entra ID's
     * `preferred_username` — for work accounts that is the UPN, i.e. the same
     * address local accounts are keyed on, and Microsoft often omits the
     * `email` claim entirely for them.
     */
    public static String resolveEmail(OidcIdToken idToken) {
        String email = idToken.getClaimAsString("email");
        if (email != null && !email.isBlank()) {
            return email;
        }
        String upn = idToken.getClaimAsString("preferred_username");
        return upn != null && upn.contains("@") ? upn : null;
    }

    private OAuth2AuthenticationException noAccount() {
        return new OAuth2AuthenticationException(
                new OAuth2Error(NO_ACCOUNT_ERROR),
                "No active local account matches this Microsoft identity.");
    }
}
