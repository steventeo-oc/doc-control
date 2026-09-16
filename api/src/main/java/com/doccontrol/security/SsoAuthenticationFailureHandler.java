package com.doccontrol.security;

import com.doccontrol.config.AppProperties;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.web.DefaultRedirectStrategy;
import org.springframework.security.web.RedirectStrategy;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.stereotype.Component;

import java.io.IOException;

/**
 * Sends every failed Microsoft sign-in back to the SPA's login page with a
 * query parameter instead of Spring's default error page. The
 * account-linking rejection (no active local match) gets its own parameter
 * so the SPA can show the specific message; every other OAuth2 failure
 * (provider outage, misconfiguration, cancelled consent) lands on the
 * generic one rather than being silently swallowed.
 */
@Component
public class SsoAuthenticationFailureHandler implements AuthenticationFailureHandler {

    private final AppProperties appProperties;
    private final RedirectStrategy redirectStrategy = new DefaultRedirectStrategy();

    public SsoAuthenticationFailureHandler(AppProperties appProperties) {
        this.appProperties = appProperties;
    }

    @Override
    public void onAuthenticationFailure(HttpServletRequest request, HttpServletResponse response,
                                        AuthenticationException exception) throws IOException {
        String error = exception instanceof OAuth2AuthenticationException oauth
                && SsoUserDetailsService.NO_ACCOUNT_ERROR.equals(oauth.getError().getErrorCode())
                ? SsoUserDetailsService.NO_ACCOUNT_ERROR
                : "sso_error";
        redirectStrategy.sendRedirect(request, response, appProperties.baseUrl() + "/login?error=" + error);
    }
}
