package com.doccontrol.auth;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import jakarta.servlet.http.Cookie;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The self-heal for the pre-fix legacy XSRF-TOKEN cookie (Path=/api — the
 * repository's original default): browsers holding it send BOTH cookies to
 * /api requests, legacy first, so the repository reads the stale value and
 * login intermittently mismatches. When a request carries a duplicated
 * XSRF-TOKEN cookie, the response must explicitly expire the Path=/api
 * variant; a single cookie must never trigger it. The filter runs before
 * CsrfFilter, so even a mismatch-rejected request carries the heal.
 */
@SpringBootTest
@AutoConfigureMockMvc
class CsrfLegacyCookieSelfHealTests {

    @Autowired
    MockMvc mockMvc;

    @Test
    void duplicateXsrfCookiesTriggerTheLegacyExpiry() throws Exception {
        MvcResult result = mockMvc.perform(get("/auth/me")
                        .cookie(new Cookie("XSRF-TOKEN", "stale-legacy-value"),
                                new Cookie("XSRF-TOKEN", "current-root-value")))
                .andExpect(status().isUnauthorized())
                .andReturn();
        List<String> setCookies = result.getResponse().getHeaders("Set-Cookie");
        assertThat(setCookies).anyMatch(value ->
                value.startsWith("XSRF-TOKEN=")
                        && value.contains("Path=/api")
                        && value.contains("Max-Age=0"));
    }

    @Test
    void aSingleXsrfCookieNeverTriggersTheExpiry() throws Exception {
        MvcResult result = mockMvc.perform(get("/auth/me")
                        .cookie(new Cookie("XSRF-TOKEN", "current-root-value")))
                .andExpect(status().isUnauthorized())
                .andReturn();
        assertThat(result.getResponse().getHeaders("Set-Cookie"))
                .noneMatch(value -> value.contains("Path=/api"));
    }

    @Test
    void noCookiesNothingToHeal() throws Exception {
        MvcResult result = mockMvc.perform(get("/auth/me"))
                .andExpect(status().isUnauthorized())
                .andReturn();
        assertThat(result.getResponse().getHeaders("Set-Cookie"))
                .noneMatch(value -> value.contains("Path=/api"));
    }

    /**
     * End-to-end shape of the bug: a browser sending the stale legacy cookie
     * first gets the heal header on the very request that would have failed
     * CSRF — and once the legacy cookie is gone (browser dropped it after the
     * heal), a login with just the current cookie goes through normally.
     */
    @Test
    void healedBrowserCanLogIn() throws Exception {
        // the mismatched browser: legacy cookie first (browser path order)
        MvcResult mismatched = mockMvc.perform(post("/auth/login")
                        .cookie(new Cookie("XSRF-TOKEN", "stale-legacy-value"),
                                new Cookie("XSRF-TOKEN", "current-root-value"))
                        .header("X-XSRF-TOKEN", "current-root-value")
                        .contentType("application/json")
                        .content("{\"email\":\"nobody@doccontrol.test\",\"password\":\"wrong\"}"))
                .andReturn();
        assertThat(mismatched.getResponse().getHeaders("Set-Cookie")).anyMatch(value ->
                value.contains("Path=/api") && value.contains("Max-Age=0"));

        // after the browser dropped the legacy cookie, CSRF passes and the
        // request proceeds to authentication (bad credentials → 401, not a
        // CSRF rejection)
        mockMvc.perform(post("/auth/login")
                        .cookie(new Cookie("XSRF-TOKEN", "current-root-value"))
                        .header("X-XSRF-TOKEN", "current-root-value")
                        .contentType("application/json")
                        .content("{\"email\":\"nobody@doccontrol.test\",\"password\":\"wrong\"}"))
                .andExpect(status().isUnauthorized());
    }
}
