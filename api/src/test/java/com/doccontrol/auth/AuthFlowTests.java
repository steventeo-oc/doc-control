package com.doccontrol.auth;

import com.doccontrol.auth.dto.LoginRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.doccontrol.CsrfTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static com.doccontrol.CsrfTestSupport.csrf;

/**
 * Exercises the real login flow (including the startup-created bootstrap
 * admin) against the live database.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(CsrfTestSupport.class)
class AuthFlowTests {

    private static final String BOOTSTRAP_EMAIL = "admin@doccontrol.local";
    private static final String BOOTSTRAP_PASSWORD = "changeme_admin";

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Test
    void bootstrapAdminCanLoginAndReadProfile() throws Exception {
        MockHttpSession session = login(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);

        mockMvc.perform(get("/auth/me").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(BOOTSTRAP_EMAIL))
                .andExpect(jsonPath("$.roles[0]").value("Admin"))
                .andExpect(jsonPath("$.department.code").value("QA"));
    }

    @Test
    void wrongPasswordIsUnauthorized() throws Exception {
        mockMvc.perform(post("/auth/login").with(csrf())
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(new LoginRequest(BOOTSTRAP_EMAIL, "wrong"))))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void unknownUserIsUnauthorized() throws Exception {
        mockMvc.perform(post("/auth/login").with(csrf())
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(new LoginRequest("nobody@doccontrol.local", "x"))))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void meWithoutSessionIsUnauthorized() throws Exception {
        mockMvc.perform(get("/auth/me"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void logoutInvalidatesTheSession() throws Exception {
        MockHttpSession session = login(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);

        mockMvc.perform(post("/auth/logout").with(csrf()).session(session))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/auth/me").session(session))
                .andExpect(status().isUnauthorized());
    }

    private MockHttpSession login(String email, String password) throws Exception {
        MvcResult result = mockMvc.perform(post("/auth/login").with(csrf())
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(new LoginRequest(email, password))))
                .andExpect(status().isOk())
                .andReturn();
        MockHttpSession session = (MockHttpSession) result.getRequest().getSession(false);
        if (session == null) {
            throw new AssertionError("Expected a session after login");
        }
        return session;
    }
}
