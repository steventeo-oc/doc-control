package com.doccontrol;

import jakarta.servlet.http.Cookie;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * Test support for the CSRF double-submit scheme. The built-in
 * {@code SecurityMockMvcRequestPostProcessors.csrf()} does not satisfy
 * {@link CookieCsrfTokenRepository}: that repository validates the request
 * token against the request's own XSRF-TOKEN cookie, which the built-in
 * post-processor never sets. This post-processor mirrors what the SPA does —
 * cookie plus matching header — so tests exercise the real validation path.
 *
 * Import statically in tests: {@code import static com.doccontrol.CsrfTestSupport.csrf;}
 */
public final class CsrfTestSupport {

    private static final String TOKEN = "test-csrf-token";

    private CsrfTestSupport() {
    }

    public static RequestPostProcessor csrf() {
        return request -> {
            request.setCookies(new Cookie("XSRF-TOKEN", TOKEN));
            request.addHeader("X-XSRF-TOKEN", TOKEN);
            request.addHeader("X-CSRF-TOKEN", TOKEN);
            return request;
        };
    }
}
