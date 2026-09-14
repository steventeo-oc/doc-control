package com.doccontrol.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Self-heals browsers still carrying the pre-fix legacy XSRF-TOKEN cookie.
 * The repository's original cookie path was the servlet context path
 * (/api); the 2c/2d fix moved the cookie to Path=/, but browsers that ever
 * held the old variant keep it alongside the current one and send BOTH to
 * /api requests — the legacy one first (more specific path wins), so the
 * repository reads the stale value while the SPA echoes the fresh one:
 * an intermittent CSRF mismatch on login.
 *
 * Browsers never send a cookie's path back, so the tell is a duplicated
 * name: when a request carries more than one XSRF-TOKEN cookie, expire
 * the Path=/api variant explicitly (Set-Cookie: XSRF-TOKEN=; Path=/api;
 * Max-Age=0). Once the browser drops it the duplicates disappear and this
 * header stops being emitted — no manual cookie clearing for anyone.
 *
 * Registered BEFORE CsrfFilter so even a mismatch-rejected request
 * carries the heal: the browser drops the legacy cookie and the very
 * next login attempt succeeds.
 */
public class LegacyXsrfCookieExpiryFilter extends OncePerRequestFilter {

    static final String CSRF_COOKIE_NAME = "XSRF-TOKEN";
    static final String LEGACY_COOKIE_PATH = "/api";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        Cookie[] cookies = request.getCookies();
        if (cookies != null) {
            int seen = 0;
            for (Cookie cookie : cookies) {
                if (CSRF_COOKIE_NAME.equals(cookie.getName()) && ++seen > 1) {
                    Cookie expiry = new Cookie(CSRF_COOKIE_NAME, "");
                    expiry.setPath(LEGACY_COOKIE_PATH);
                    expiry.setMaxAge(0);
                    response.addCookie(expiry);
                    break;
                }
            }
        }
        filterChain.doFilter(request, response);
    }
}
