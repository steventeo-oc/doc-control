package com.doccontrol.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.CsrfTokenRequestHandler;
import org.springframework.security.web.csrf.XorCsrfTokenRequestAttributeHandler;
import org.springframework.util.StringUtils;

import java.util.function.Supplier;


/**
 * Spring Security's documented SPA pattern: BREACH-protected token rendering
 * (XOR) combined with raw-token validation when the client echoes the token
 * in a header (the XSRF-TOKEN cookie's value).
 */
final class SpaCsrfTokenRequestHandler extends CsrfTokenRequestAttributeHandler {

    // BREACH-protected rendering (the docs' ::delegate pattern doesn't compile
    // on Spring Security 6.5 — the delegate() method isn't visible there)
    private final CsrfTokenRequestHandler xorDelegate = new XorCsrfTokenRequestAttributeHandler();

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, Supplier<CsrfToken> csrfToken) {
        this.xorDelegate.handle(request, response, csrfToken);
    }

    @Override
    public String resolveCsrfTokenValue(HttpServletRequest request, CsrfToken csrfToken) {
        if (StringUtils.hasText(request.getHeader(csrfToken.getHeaderName()))) {
            return request.getHeader(csrfToken.getHeaderName());
        }
        return super.resolveCsrfTokenValue(request, csrfToken);
    }
}
