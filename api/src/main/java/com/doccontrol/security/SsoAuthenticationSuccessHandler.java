package com.doccontrol.security;

import com.doccontrol.config.AppProperties;
import com.doccontrol.identity.User;
import com.doccontrol.identity.UserRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.security.web.DefaultRedirectStrategy;
import org.springframework.security.web.RedirectStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Bridges a successful Microsoft OIDC login onto this app's own authorization
 * model (Microsoft_SSO_PlanBack.md — "the one thing that must not be gotten
 * wrong"): replaces the OAuth2AuthenticationToken(OidcUser) Spring Security
 * produced with a UsernamePasswordAuthenticationToken carrying a real
 * {@link AppUserPrincipal} — built exactly like
 * AppUserDetailsService.loadUserByUsername — and saves it via the same
 * HttpSessionSecurityContextRepository pattern AuthController.login() uses,
 * before redirecting to the SPA root. From this point an SSO session and a
 * password session are indistinguishable to CurrentUserProvider and every
 * hasRole() check; without the swap every subsequent API call would 401.
 */
@Component
public class SsoAuthenticationSuccessHandler implements AuthenticationSuccessHandler {

    private final UserRepository userRepository;
    private final AppProperties appProperties;
    private final SecurityContextRepository securityContextRepository =
            new HttpSessionSecurityContextRepository();
    private final RedirectStrategy redirectStrategy = new DefaultRedirectStrategy();

    public SsoAuthenticationSuccessHandler(UserRepository userRepository, AppProperties appProperties) {
        this.userRepository = userRepository;
        this.appProperties = appProperties;
    }

    @Override
    @Transactional(readOnly = true)
    public void onAuthenticationSuccess(HttpServletRequest request, HttpServletResponse response,
                                        Authentication authentication) throws IOException {
        if (!(authentication instanceof OAuth2AuthenticationToken oauthToken)
                || !(oauthToken.getPrincipal() instanceof OidcUser oidcUser)) {
            throw new IllegalStateException("Unexpected SSO authentication: "
                    + (authentication == null ? "null" : authentication.getClass().getName()));
        }
        String email = SsoUserDetailsService.resolveEmail(oidcUser.getIdToken());
        User user = email == null ? null
                : userRepository.findByEmailIgnoreCase(email).filter(User::isActive).orElse(null);
        if (user == null) {
            // Unreachable when SsoUserDetailsService accepted the login; if it
            // happens anyway (the user was deactivated between the two
            // lookups), fail closed as a rejection, never as a broken session.
            redirectStrategy.sendRedirect(request, response,
                    appProperties.baseUrl() + "/login?error=" + SsoUserDetailsService.NO_ACCOUNT_ERROR);
            return;
        }

        // Same construction as AppUserDetailsService.loadUserByUsername —
        // authorities are case-normalized (ROLE_ADMIN) so hasRole("ADMIN")
        // matches regardless of the role's display name.
        Set<GrantedAuthority> authorities = user.getRoles().stream()
                .map(userRole -> new SimpleGrantedAuthority(
                        "ROLE_" + userRole.getRole().getName().toUpperCase(Locale.ROOT)))
                .collect(Collectors.toSet());
        AppUserPrincipal principal = new AppUserPrincipal(user.getId(), user.getEmail(),
                user.getPasswordHash(), user.isActive(), authorities);

        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(new UsernamePasswordAuthenticationToken(principal, null, authorities));
        SecurityContextHolder.setContext(context);
        securityContextRepository.saveContext(context, request, response);

        redirectStrategy.sendRedirect(request, response, appProperties.baseUrl() + "/");
    }
}
