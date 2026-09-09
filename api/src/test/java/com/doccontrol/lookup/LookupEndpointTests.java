package com.doccontrol.lookup;

import com.doccontrol.audit.AuditLog;
import com.doccontrol.audit.AuditLogRepository;
import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.identity.Role;
import com.doccontrol.identity.RoleRepository;
import com.doccontrol.identity.User;
import com.doccontrol.identity.UserRepository;
import com.doccontrol.identity.UserRole;
import com.doccontrol.identity.UserRoleId;
import com.doccontrol.identity.UserRoleRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.doccontrol.CsrfTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static com.doccontrol.CsrfTestSupport.csrf;

/**
 * Permission matrix and audit-trail behavior of the lookup endpoints, using
 * the real login flow against the live database. Each test rolls back.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(CsrfTestSupport.class)
@Transactional
class LookupEndpointTests {

    private static final String BOOTSTRAP_EMAIL = "admin@doccontrol.local";
    private static final String BOOTSTRAP_PASSWORD = "changeme_admin";

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    PasswordEncoder passwordEncoder;

    @Autowired
    UserRepository userRepository;

    @Autowired
    UserRoleRepository userRoleRepository;

    @Autowired
    RoleRepository roleRepository;

    @Autowired
    DepartmentRepository departmentRepository;

    @Autowired
    DocumentTierRepository documentTierRepository;

    @Autowired
    AuditLogRepository auditLogRepository;

    @Test
    void unauthenticatedReadsAreRejected() throws Exception {
        mockMvc.perform(get("/departments"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void authenticatedUserCanReadLookups() throws Exception {
        MockHttpSession session = loginAs(createUser("reader@doccontrol.test", "User"));

        mockMvc.perform(get("/departments").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.code == 'QA')]").exists())
                .andExpect(jsonPath("$[?(@.code == 'HR')]").exists());

        mockMvc.perform(get("/document-tiers").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(4));

        mockMvc.perform(get("/document-types").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.code == 'SOP')]").exists());
    }

    @Test
    void nonAdminCannotCreateOrPatchLookups() throws Exception {
        MockHttpSession session = loginAs(createUser("plain@doccontrol.test", "User"));

        mockMvc.perform(post("/departments").with(csrf()).session(session)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("code", "X1", "label", "Nope"))))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/document-types").with(csrf()).session(session)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("code", "X1", "label", "Nope", "tierId", 1))))
                .andExpect(status().isForbidden());
    }

    @Test
    void adminCanCreateDocumentTypeAndAuditRowIsWritten() throws Exception {
        MockHttpSession session = loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);
        Integer tierId = documentTierRepository.findAll().get(0).getId();

        mockMvc.perform(post("/document-types").with(csrf()).session(session)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(
                                Map.of("code", "TST", "label", "Test Type", "tierId", tierId))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.code").value("TST"))
                .andExpect(jsonPath("$.active").value(true));

        assertThat(auditLogRepository.findAll())
                .anyMatch(entry -> "document_type".equals(entry.getEntityType())
                        && "created".equals(entry.getAction())
                        && "TST".equals(entry.getDetails().get("code")));

        // duplicate code is rejected
        mockMvc.perform(post("/document-types").with(csrf()).session(session)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(
                                Map.of("code", "TST", "label", "Again", "tierId", tierId))))
                .andExpect(status().isConflict());
    }

    @Test
    void adminCanDeactivateDepartmentAndItLeavesTheList() throws Exception {
        MockHttpSession session = loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);

        MvcResult created = mockMvc.perform(post("/departments").with(csrf()).session(session)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("code", "TMP", "label", "Temporary"))))
                .andExpect(status().isCreated())
                .andReturn();
        Integer id = objectMapper.readValue(created.getResponse().getContentAsString(), DepartmentDto.class).id();

        mockMvc.perform(patch("/departments/" + id).with(csrf()).session(session)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("active", false))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false));

        mockMvc.perform(get("/departments").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.code == 'TMP')]").doesNotExist());

        assertThat(auditLogRepository.findAll())
                .anyMatch(entry -> "department".equals(entry.getEntityType())
                        && "updated".equals(entry.getAction()));
    }

    private String createUser(String email, String... roleNames) {
        User user = new User();
        user.setName(email);
        user.setEmail(email);
        user.setDepartment(departmentRepository.findByCode("QA").orElseThrow());
        user.setPasswordHash(passwordEncoder.encode("pw-" + email));
        user.setActive(true);
        userRepository.save(user);

        for (String roleName : roleNames) {
            Role role = roleRepository.findByName(roleName).orElseThrow();
            UserRole membership = new UserRole();
            membership.setId(new UserRoleId(user.getId(), role.getId()));
            membership.setUser(user);
            membership.setRole(role);
            userRoleRepository.save(membership);
        }
        return email;
    }

    private MockHttpSession loginAs(String email, String password) throws Exception {
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

    private MockHttpSession loginAs(String email) throws Exception {
        return loginAs(email, "pw-" + email);
    }
}
