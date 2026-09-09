package com.doccontrol.identity;

import com.doccontrol.audit.AuditLogRepository;
import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.lookup.DepartmentRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Users/roles admin CRUD plus the password-change endpoint (the tracked
 * go-live item), against the live database. Each test rolls back.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class UserEndpointTests {

    private static final String BOOTSTRAP_EMAIL = "admin@doccontrol.local";
    private static final String BOOTSTRAP_PASSWORD = "changeme_admin";

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    AuditLogRepository auditLogRepository;

    @Autowired
    DepartmentRepository departmentRepository;

    @Test
    void nonAdminCannotAccessUserAdminEndpoints() throws Exception {
        MockHttpSession admin = loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);
        Integer userId = createUserViaApi(admin, "plainreader@doccontrol.test", "plain-pass-123");
        MockHttpSession userSession = loginAs("plainreader@doccontrol.test", "plain-pass-123");

        mockMvc.perform(get("/users").session(userSession))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/roles").session(userSession))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/users").session(userSession)
                        .contentType("application/json").content("{}"))
                .andExpect(status().isForbidden());
        assertThat(userId).isNotNull();
    }

    @Test
    void adminListsUsersAndRoles() throws Exception {
        MockHttpSession admin = loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);

        mockMvc.perform(get("/users").session(admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.email == '" + BOOTSTRAP_EMAIL + "')]").exists());

        mockMvc.perform(get("/roles").session(admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.name == 'Admin')]").exists())
                .andExpect(jsonPath("$[?(@.name == 'User')]").exists());
    }

    @Test
    void adminCreatesUserWhoCanThenLogIn() throws Exception {
        MockHttpSession admin = loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);
        Integer deptId = departmentRepository.findByCode("ENG").orElseThrow().getId();

        MvcResult created = mockMvc.perform(post("/users").session(admin)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of(
                                "name", "Dana Newuser",
                                "email", "dana@doccontrol.test",
                                "departmentId", deptId,
                                "password", "initial-pass-123"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.roles[0]").value("User"))
                .andExpect(jsonPath("$.password").doesNotExist())
                .andReturn();
        Integer userId = objectMapper.readValue(created.getResponse().getContentAsString(), UserDto.class).id();

        // duplicate email rejected
        mockMvc.perform(post("/users").session(admin)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of(
                                "name", "Dana Again",
                                "email", "dana@doccontrol.test",
                                "departmentId", deptId,
                                "password", "initial-pass-123"))))
                .andExpect(status().isConflict());

        // short password rejected
        mockMvc.perform(post("/users").session(admin)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of(
                                "name", "Weak", "email", "weak@doccontrol.test",
                                "departmentId", deptId, "password", "short"))))
                .andExpect(status().isBadRequest());

        // the new user can log in with the initial password
        loginAs("dana@doccontrol.test", "initial-pass-123");

        assertThat(auditLogRepository.findAll())
                .anyMatch(entry -> "user".equals(entry.getEntityType())
                        && "created".equals(entry.getAction())
                        && "dana@doccontrol.test".equals(entry.getDetails().get("email")));

        // keep the id referenced for the compiler
        assertThat(userId).isNotNull();
    }

    @Test
    void adminPatchesDepartmentAndActiveStatus() throws Exception {
        MockHttpSession admin = loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);
        Integer userId = createUserViaApi(admin, "patchme@doccontrol.test", "first-pass-123");

        Integer deptId = departmentRepository.findByCode("PROD").orElseThrow().getId();
        mockMvc.perform(patch("/users/" + userId).session(admin)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("departmentId", deptId, "active", true))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.department.code").value("PROD"));

        // deactivate, then the account can no longer log in
        mockMvc.perform(patch("/users/" + userId).session(admin)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("active", false))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false));

        mockMvc.perform(post("/auth/login")
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(
                                new LoginRequest("patchme@doccontrol.test", "first-pass-123"))))
                .andExpect(status().isUnauthorized());

        // an admin cannot deactivate their own account
        Integer adminId = findUserIdByEmail(admin, BOOTSTRAP_EMAIL);
        mockMvc.perform(patch("/users/" + adminId).session(admin)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("active", false))))
                .andExpect(status().isConflict());
    }

    @Test
    void passwordChangeSelfServiceRequiresCurrentPassword() throws Exception {
        MockHttpSession admin = loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);
        Integer userId = createUserViaApi(admin, "selfpw@doccontrol.test", "old-pass-123");
        MockHttpSession self = loginAs("selfpw@doccontrol.test", "old-pass-123");

        // wrong current password
        mockMvc.perform(post("/users/" + userId + "/password").session(self)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of(
                                "currentPassword", "wrong-pass-123", "newPassword", "new-pass-456"))))
                .andExpect(status().isBadRequest());

        // correct current password
        mockMvc.perform(post("/users/" + userId + "/password").session(self)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of(
                                "currentPassword", "old-pass-123", "newPassword", "new-pass-456"))))
                .andExpect(status().isNoContent());

        // old password no longer works, new one does
        mockMvc.perform(post("/auth/login")
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(
                                new LoginRequest("selfpw@doccontrol.test", "old-pass-123"))))
                .andExpect(status().isUnauthorized());
        loginAs("selfpw@doccontrol.test", "new-pass-456");

        assertThat(auditLogRepository.findAll())
                .anyMatch(entry -> "user".equals(entry.getEntityType())
                        && "password_changed".equals(entry.getAction())
                        && Boolean.TRUE.equals(entry.getDetails().get("self_service")));
    }

    @Test
    void adminCanResetAnotherUsersPasswordWithoutCurrentPassword() throws Exception {
        MockHttpSession admin = loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);
        Integer userId = createUserViaApi(admin, "resetme@doccontrol.test", "old-pass-123");

        mockMvc.perform(post("/users/" + userId + "/password").session(admin)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("newPassword", "reset-pass-789"))))
                .andExpect(status().isNoContent());

        // non-admin cannot reset someone else's password
        MockHttpSession other = loginAs("resetme@doccontrol.test", "reset-pass-789");
        Integer adminId = findUserIdByEmail(admin, BOOTSTRAP_EMAIL);
        mockMvc.perform(post("/users/" + adminId + "/password").session(other)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("newPassword", "hijack-pass-1"))))
                .andExpect(status().isForbidden());

        loginAs("resetme@doccontrol.test", "reset-pass-789");
    }

    @Test
    void adminCanPromoteAndDemoteViaRolesPatch() throws Exception {
        MockHttpSession admin = loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);
        Integer userId = createUserViaApi(admin, "promotable@doccontrol.test", "promote-pass-123");

        // promote to Admin
        mockMvc.perform(patch("/users/" + userId).session(admin)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("roles", List.of("Admin")))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.roles[0]").value("Admin"));

        // authorities are minted at login, so the promotion takes effect on
        // the next session
        MockHttpSession promoted = loginAs("promotable@doccontrol.test", "promote-pass-123");
        mockMvc.perform(get("/users").session(promoted))
                .andExpect(status().isOk());

        // demote to no roles at all
        mockMvc.perform(patch("/users/" + userId).session(admin)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("roles", List.of()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.roles").isEmpty());

        MockHttpSession demoted = loginAs("promotable@doccontrol.test", "promote-pass-123");
        mockMvc.perform(get("/users").session(demoted))
                .andExpect(status().isForbidden());

        assertThat(auditLogRepository.findAll())
                .anyMatch(entry -> "user".equals(entry.getEntityType())
                        && "updated".equals(entry.getAction())
                        && Map.of("roles", List.of("User")).equals(entry.getDetails().get("before"))
                        && Map.of("roles", List.of("Admin")).equals(entry.getDetails().get("after")));
    }

    @Test
    void adminCannotChangeOwnRoles() throws Exception {
        MockHttpSession admin = loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);
        Integer adminId = findUserIdByEmail(admin, BOOTSTRAP_EMAIL);

        // the guard must fire — 409, not a silent no-op
        mockMvc.perform(patch("/users/" + adminId).session(admin)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("roles", List.of("User")))))
                .andExpect(status().isConflict());

        // and the admin's authority is untouched: they can still administer
        mockMvc.perform(get("/users").session(admin))
                .andExpect(status().isOk());

        // no roles audit entry was written for the blocked attempt
        assertThat(auditLogRepository.findAll())
                .noneMatch(entry -> "user".equals(entry.getEntityType())
                        && entry.getDetails() != null
                        && entry.getDetails().containsKey("roles")
                        && Integer.valueOf(1).equals(entry.getEntityId()));
    }

    private Integer findUserIdByEmail(MockHttpSession session, String email) throws Exception {
        MvcResult result = mockMvc.perform(get("/users").session(session))
                .andExpect(status().isOk())
                .andReturn();
        UserDto[] users = objectMapper.readValue(result.getResponse().getContentAsString(), UserDto[].class);
        for (UserDto user : users) {
            if (email.equals(user.email())) {
                return user.id();
            }
        }
        throw new AssertionError("User not found: " + email);
    }

    private Integer createUserViaApi(MockHttpSession adminSession, String email, String password) throws Exception {
        Integer deptId = departmentRepository.findByCode("QA").orElseThrow().getId();
        MvcResult result = mockMvc.perform(post("/users").session(adminSession)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of(
                                "name", email, "email", email,
                                "departmentId", deptId, "password", password))))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readValue(result.getResponse().getContentAsString(), UserDto.class).id();
    }

    private MockHttpSession loginAs(String email, String password) throws Exception {
        MvcResult result = mockMvc.perform(post("/auth/login")
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
