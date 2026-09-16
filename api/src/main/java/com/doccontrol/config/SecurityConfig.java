package com.doccontrol.config;

import com.doccontrol.security.SsoAuthenticationFailureHandler;
import com.doccontrol.security.SsoAuthenticationSuccessHandler;
import com.doccontrol.security.SsoUserDetailsService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.ClientRegistrations;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.HttpStatusAccessDeniedHandler;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.authentication.logout.HttpStatusReturningLogoutSuccessHandler;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    // CSRF: double-submit cookie scheme for the SPA (frontend reads the
    // XSRF-TOKEN cookie and echoes it in X-XSRF-TOKEN). The cookie path must
    // be "/" — the repository's default is the servlet context path (/api),
    // which hides the cookie from the SPA's JS on page paths like /login.
    // SameSite=Lax stays on as defense in depth. See
    // SpaCsrfTokenRequestHandler and CsrfCookieFilter.
    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http,
                                            CorsConfigurationSource corsConfigurationSource,
                                            SsoProperties ssoProperties,
                                            SsoUserDetailsService ssoUserDetailsService,
                                            SsoAuthenticationSuccessHandler ssoSuccessHandler,
                                            SsoAuthenticationFailureHandler ssoFailureHandler) throws Exception {
        CookieCsrfTokenRepository csrfTokenRepository = CookieCsrfTokenRepository.withHttpOnlyFalse();
        csrfTokenRepository.setCookiePath("/");
        http
            .cors(cors -> cors.configurationSource(corsConfigurationSource))
            .csrf(csrf -> csrf
                .csrfTokenRepository(csrfTokenRepository)
                .csrfTokenRequestHandler(new SpaCsrfTokenRequestHandler()))
            .addFilterBefore(new LegacyXsrfCookieExpiryFilter(), CsrfFilter.class)
            .addFilterAfter(new CsrfCookieFilter(), AnonymousAuthenticationFilter.class)
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
            .authorizeHttpRequests(auth -> {
                auth.requestMatchers(org.springframework.http.HttpMethod.POST,
                        "/auth/login", "/auth/forgot-password", "/auth/reset-password").permitAll();
                if (ssoProperties.enabled()) {
                    // The OIDC redirect to Microsoft and the provider's callback
                    // are pre-authentication hops by definition — without
                    // permitAll they'd fall into anyRequest().authenticated()
                    // and 401 before the round-trip can even start.
                    auth.requestMatchers("/oauth2/authorization/**", "/login/oauth2/code/**")
                        .permitAll();
                }
                // lookup usage counts power the admin deactivate/delete
                // confirmations — same surface as the writes they precede
                auth.requestMatchers(org.springframework.http.HttpMethod.GET,
                        "/departments/*/usage", "/document-types/*/usage",
                        "/document-tiers/*/usage").hasRole("ADMIN");
                auth.requestMatchers(org.springframework.http.HttpMethod.GET,
                        "/document-tiers", "/document-tiers/**",
                        "/document-types", "/document-types/**",
                        "/departments", "/departments/**").authenticated();
                // department member management (levels plan-back F5): the
                // Manager-of-this-department check is data-dependent, so the
                // route admits any authenticated user and the service
                // enforces canManageMembers
                auth.requestMatchers(org.springframework.http.HttpMethod.GET,
                        "/departments/*/members").authenticated();
                auth.requestMatchers(org.springframework.http.HttpMethod.PATCH,
                        "/departments/*/members/*").authenticated();
                // remaining writes on lookup resources are admin-only
                auth.requestMatchers("/document-tiers/**", "/document-types/**", "/departments/**")
                    .hasRole("ADMIN");
                // password change is self-service: the owner (or an admin,
                // enforced in UserService) may hit it, unlike the rest of
                // the admin-only /users/** surface
                auth.requestMatchers(org.springframework.http.HttpMethod.POST, "/users/*/password")
                    .authenticated();
                // the audit-log CSV export is the admin evidence surface
                // (activity plan-back); the query itself is open to all
                // authenticated users with server-side scoping, and the
                // service re-checks export admin rights anyway
                auth.requestMatchers(org.springframework.http.HttpMethod.GET, "/audit-log/export")
                    .hasRole("ADMIN");
                auth.requestMatchers("/users/**", "/roles", "/admin/**").hasRole("ADMIN");
                auth.anyRequest().authenticated();
            })
            .exceptionHandling(handling -> handling
                .authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED))
                .accessDeniedHandler(new HttpStatusAccessDeniedHandler(HttpStatus.FORBIDDEN)))
            .logout(logout -> logout
                .logoutUrl("/auth/logout")
                .invalidateHttpSession(true)
                .clearAuthentication(true)
                .deleteCookies("JSESSIONID")
                .logoutSuccessHandler(new HttpStatusReturningLogoutSuccessHandler(HttpStatus.NO_CONTENT)));
        if (ssoProperties.enabled()) {
            // "Sign in with Microsoft" (Microsoft_SSO_PlanBack.md). The custom
            // OidcUserService enforces the account-linking policy; the success
            // handler then swaps the stock OidcUser principal for our
            // AppUserPrincipal — without that swap every later API call would
            // 401 (CurrentUserProvider) and role checks would silently fail.
            http.oauth2Login(login -> login
                .userInfoEndpoint(userInfo -> userInfo.oidcUserService(ssoUserDetailsService))
                .successHandler(ssoSuccessHandler)
                .failureHandler(ssoFailureHandler));
        }
        return http.build();
    }

    /**
     * Manual OIDC client registration for the shared Azure app registration
     * (F1): deliberately NOT the spring.security.oauth2.client.* property
     * namespace, so the Graph sender's DOCCONTROL_NOTIFICATION_* env vars can
     * be reused directly. fromIssuerLocation runs OIDC discovery against the
     * tenant, so no Microsoft endpoint URLs are hardcoded. Only created when
     * doccontrol.auth.sso.enabled=true — disabled deployments never touch the
     * network here, and missing credentials never matter (requireComplete
     * runs first and fails fast when enabled without a full set).
     *
     * The redirect URI is set explicitly from app.base-url rather than left
     * to Spring's default "{baseUrl}/login/oauth2/code/{registrationId}"
     * template: that template expands from the current request's Host
     * header, and nginx's "proxy_set_header Host $host" (web/nginx.conf)
     * strips the port before forwarding to this container — the app would
     * build "http://localhost/api/login/oauth2/code/microsoft" (no :3000),
     * which doesn't match what's registered in Azure. app.base-url is
     * already the trusted, explicit source of truth for externally-visible
     * URLs (PasswordResetService uses it the same way for reset links) —
     * reusing it here sidesteps proxy-header inference entirely rather than
     * chasing nginx/forward-headers-strategy configuration.
     */
    @Bean
    @ConditionalOnProperty(prefix = "doccontrol.auth.sso", name = "enabled", havingValue = "true")
    ClientRegistrationRepository clientRegistrationRepository(SsoProperties ssoProperties,
                                                              AppProperties appProperties) {
        ssoProperties.requireComplete();
        ClientRegistration microsoft = ClientRegistrations
                .fromIssuerLocation("https://login.microsoftonline.com/" + ssoProperties.tenantId() + "/v2.0")
                .registrationId("microsoft")
                .clientId(ssoProperties.clientId())
                .clientSecret(ssoProperties.clientSecret())
                .redirectUri(appProperties.baseUrl() + "/api/login/oauth2/code/microsoft")
                .scope("openid", "profile", "email")
                .build();
        return new InMemoryClientRegistrationRepository(microsoft);
    }

    /**
     * Local email/password authentication. The ProviderManager makes this
     * pluggable: an LDAP/AD provider can be added later without touching the
     * controllers or services (CLAUDE.md auth decision).
     */
    @Bean
    AuthenticationManager authenticationManager(UserDetailsService userDetailsService,
                                                PasswordEncoder passwordEncoder) {
        DaoAuthenticationProvider provider = new DaoAuthenticationProvider();
        provider.setUserDetailsService(userDetailsService);
        provider.setPasswordEncoder(passwordEncoder);
        return new ProviderManager(provider);
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(CorsProperties corsProperties) {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(corsProperties.allowedOrigins());
        configuration.setAllowedMethods(List.of("*"));
        configuration.setAllowedHeaders(List.of("*"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
