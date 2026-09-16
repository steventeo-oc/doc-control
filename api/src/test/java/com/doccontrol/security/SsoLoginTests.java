package com.doccontrol.security;

import com.doccontrol.config.AppProperties;
import com.doccontrol.identity.Role;
import com.doccontrol.identity.RoleRepository;
import com.doccontrol.identity.User;
import com.doccontrol.identity.UserRepository;
import com.doccontrol.identity.UserRole;
import com.doccontrol.identity.UserRoleId;
import com.doccontrol.identity.UserRoleRepository;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserRequest;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.OAuth2AccessToken;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import jakarta.persistence.PersistenceContext;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Exercises the "Sign in with Microsoft" account-linking policy against the
 * live database (Microsoft_SSO_PlanBack.md): email matches an active user →
 * success; inactive or unknown → rejection; and — the failure mode "it
 * redirected" testing would miss — the post-login Authentication must carry
 * a real {@link AppUserPrincipal} with the correct authorities, or every
 * subsequent API call 401s (CurrentUserProvider.principal()) and hasRole()
 * checks silently fail. The browser round-trip through Microsoft itself is
 * verified separately against the live tenant (real e2e), not here.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class SsoLoginTests {

    @Autowired
    SsoUserDetailsService ssoUserDetailsService;

    @Autowired
    SsoAuthenticationSuccessHandler successHandler;

    @Autowired
    AppProperties appProperties;

    @Autowired
    UserRepository userRepository;

    @Autowired
    RoleRepository roleRepository;

    @Autowired
    UserRoleRepository userRoleRepository;

    @Autowired
    PasswordEncoder passwordEncoder;

    @Autowired
    MockMvc mockMvc;

    @PersistenceContext
    EntityManager entityManager;

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void emailMatchingActiveUserAuthenticates() {
        User user = createUserWithRoles("sso-match", "Admin", "User");

        OidcUser oidcUser = ssoUserDetailsService.loadUser(oidcRequest(user.getEmail()));

        assertThat(oidcUser).isNotNull();
        assertThat(oidcUser.getEmail()).isEqualTo(user.getEmail());
    }

    @Test
    void emailMatchingInactiveUserIsRejected() {
        User user = createUserWithRoles("sso-inactive", "User");
        user.setActive(false);
        userRepository.save(user);

        assertThatThrownBy(() -> ssoUserDetailsService.loadUser(oidcRequest(user.getEmail())))
                .isInstanceOf(OAuth2AuthenticationException.class)
                .extracting(e -> ((OAuth2AuthenticationException) e).getError().getErrorCode())
                .isEqualTo(SsoUserDetailsService.NO_ACCOUNT_ERROR);
    }

    @Test
    void emailWithNoLocalMatchIsRejected() {
        String email = "nobody-" + System.nanoTime() + "@doccontrol.test";

        assertThatThrownBy(() -> ssoUserDetailsService.loadUser(oidcRequest(email)))
                .isInstanceOf(OAuth2AuthenticationException.class)
                .extracting(e -> ((OAuth2AuthenticationException) e).getError().getErrorCode())
                .isEqualTo(SsoUserDetailsService.NO_ACCOUNT_ERROR);
    }

    /**
     * The critical bridging assertion: after the success handler runs, the
     * SecurityContext saved into the session (what /auth/me and every
     * controller read) must hold a UsernamePasswordAuthenticationToken whose
     * principal is OUR AppUserPrincipal with case-normalized ROLE_* authorities
     * — not Spring's OidcUser. Mirrors how OAuth2LoginAuthenticationFilter
     * constructs the token it hands the handler.
     */
    @Test
    void successHandlerReplacesAuthenticationWithAppUserPrincipalSession() throws Exception {
        User user = createUserWithRoles("sso-bridge", "Admin", "User");

        OidcUserRequest request = oidcRequest(user.getEmail());
        OidcUser oidcUser = ssoUserDetailsService.loadUser(request);
        OAuth2AuthenticationToken oauthToken = new OAuth2AuthenticationToken(
                oidcUser, oidcUser.getAuthorities(), request.getClientRegistration().getRegistrationId());

        MockHttpServletRequest servletRequest = new MockHttpServletRequest();
        MockHttpServletResponse servletResponse = new MockHttpServletResponse();
        SecurityContextHolder.clearContext();
        successHandler.onAuthenticationSuccess(servletRequest, servletResponse, oauthToken);

        Authentication sessionAuth = new HttpSessionSecurityContextRepository()
                .loadDeferredContext(servletRequest).get().getAuthentication();
        assertThat(sessionAuth).isInstanceOf(org.springframework.security.authentication.UsernamePasswordAuthenticationToken.class);
        assertThat(sessionAuth.getPrincipal()).isInstanceOf(AppUserPrincipal.class);
        AppUserPrincipal principal = (AppUserPrincipal) sessionAuth.getPrincipal();
        assertThat(principal.getUserId()).isEqualTo(user.getId());
        assertThat(principal.getUsername()).isEqualTo(user.getEmail());
        assertThat(sessionAuth.getAuthorities())
                .extracting(GrantedAuthority::getAuthority)
                .containsExactlyInAnyOrder("ROLE_ADMIN", "ROLE_USER");
        assertThat(servletResponse.getRedirectedUrl()).isEqualTo(appProperties.baseUrl() + "/");
    }

    /** Disabled deployments leave the OIDC endpoints closed (401), not open. */
    @Test
    void ssoAuthorizationEndpointIsNotReachableWhenSsoIsDisabled() throws Exception {
        mockMvc.perform(get("/oauth2/authorization/microsoft"))
                .andExpect(status().isUnauthorized());
    }

    // --- helpers ---

    /**
     * A hand-built registration with throwaway endpoint URLs — the unit-level
     * seam for OidcUserRequest. Production never hardcodes Microsoft's URLs
     * (ClientRegistrations.fromIssuerLocation does discovery); these constants
     * are only ever read by the test, never contacted.
     */
    private OidcUserRequest oidcRequest(String email) {
        ClientRegistration registration = ClientRegistration.withRegistrationId("microsoft")
                .clientId("test-client")
                .clientSecret("test-secret")
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("{baseUrl}/login/oauth2/code/microsoft")
                .scope("openid", "profile", "email")
                .authorizationUri("https://login.microsoftonline.com/common/oauth2/v2.0/authorize")
                .tokenUri("https://login.microsoftonline.com/common/oauth2/v2.0/token")
                .jwkSetUri("https://login.microsoftonline.com/common/discovery/v2.0/keys")
                .issuerUri("https://login.microsoftonline.com/common/v2.0")
                .build();
        Map<String, Object> claims = new HashMap<>();
        claims.put("iss", "https://login.microsoftonline.com/common/v2.0");
        claims.put("sub", "sub-" + System.nanoTime());
        claims.put("aud", "test-client");
        claims.put("exp", Instant.now().plusSeconds(3600));
        claims.put("iat", Instant.now());
        if (email != null) {
            claims.put("email", email);
        }
        OidcIdToken idToken = new OidcIdToken("id-token-value", Instant.now(),
                Instant.now().plusSeconds(3600), claims);
        OAuth2AccessToken accessToken = new OAuth2AccessToken(OAuth2AccessToken.TokenType.BEARER,
                "access-token-value", Instant.now(), Instant.now().plusSeconds(3600),
                Set.of("openid", "profile", "email"));
        return new OidcUserRequest(registration, accessToken, idToken);
    }

    private User createUserWithRoles(String prefix, String... roleNames) {
        User user = new User();
        user.setName("SSO Test " + prefix);
        user.setEmail(prefix + "-" + System.nanoTime() + "@doccontrol.test");
        user.setPasswordHash(passwordEncoder.encode("pw-" + prefix));
        user.setActive(true);
        user = userRepository.save(user);
        for (String roleName : roleNames) {
            Role role = roleRepository.findByName(roleName).orElseGet(() -> {
                Role created = new Role();
                created.setName(roleName);
                return roleRepository.save(created);
            });
            UserRole userRole = new UserRole();
            userRole.setId(new UserRoleId(user.getId(), role.getId()));
            userRoleRepository.save(userRole);
        }
        // Production runs the policy check and the bridging handler in
        // SEPARATE persistence contexts (the OAuth2 filter has no outer
        // transaction), so the handler's user.getRoles() lazy-loads from the
        // database. Reproduce that here: within one long test transaction the
        // just-persisted User would keep its plain empty HashSet as the known
        // collection state and never trigger the lazy load (verified — this
        // exact artifact produced an empty-authorities session), which would
        // make the test pass vacuously where production fails — or fail where
        // production succeeds. flush+clear forces a fresh DB load, as in prod.
        entityManager.flush();
        entityManager.clear();
        return userRepository.findById(user.getId()).orElseThrow();
    }
}
