package com.doccontrol.identity;

import com.doccontrol.CsrfTestSupport;
import com.doccontrol.audit.AuditLogRepository;
import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.lookup.DepartmentDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

import static com.doccontrol.CsrfTestSupport.csrf;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Manager self-service over department members (plan-back F5): a Manager
 * sees and changes levels within their own department — including their
 * own (D2), after which the admin is the fallback (D1); non-Managers are
 * 403 on both endpoints; target-not-a-member is 404; an omitted level is
 * 400, never an assumption; every change is audited with before/after.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@Import(CsrfTestSupport.class)
class DepartmentMemberTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    PasswordEncoder passwordEncoder;

    @Autowired
    AuditLogRepository auditLogRepository;

    /** One department plus a MANAGER and a COLLABORATOR, all through the API. */
    private static class Fixture {
        final String prefix;
        final Integer departmentId;
        final UserRef manager;
        final UserRef collaborator;
        final MockHttpSession managerSession;
        final MockHttpSession adminSession;
        final MockMvc mockMvc;
        final ObjectMapper objectMapper;

        Fixture(MockMvc mockMvc, ObjectMapper objectMapper, String prefix) throws Exception {
            this.mockMvc = mockMvc;
            this.objectMapper = objectMapper;
            this.prefix = prefix;
            this.adminSession = login("admin@doccontrol.local", "changeme_admin");

            MvcResult dept = mockMvc.perform(post("/departments").with(csrf()).session(adminSession)
                            .contentType("application/json")
                            .content("{\"code\":\"" + prefix + System.nanoTime() % 100000
                                    + "\",\"label\":\"Member test dept\"}"))
                    .andExpect(status().isCreated())
                    .andReturn();
            departmentId = objectMapper.readTree(dept.getResponse().getContentAsString())
                    .path("id").asInt();

            manager = createUser(prefix + "-manager", departmentId, "MANAGER");
            collaborator = createUser(prefix + "-collab", departmentId, "COLLABORATOR");
            managerSession = login(manager.email(), manager.password());
        }

        UserRef createUser(String prefix, Integer departmentId, String level) throws Exception {
            String email = prefix + System.nanoTime() + "@doccontrol.test";
            String password = "pw-" + prefix;
            mockMvc.perform(post("/users").with(csrf()).session(adminSession)
                            .contentType("application/json")
                            .content("{\"name\":\"" + prefix + "\",\"email\":\"" + email
                                    + "\",\"departments\":[{\"departmentId\":" + departmentId
                                    + ",\"level\":\"" + level + "\"}],\"password\":\"" + password + "\"}"))
                    .andExpect(status().isCreated());
            return new UserRef(findIdByEmail(email), email, password);
        }

        private Integer findIdByEmail(String email) throws Exception {
            MvcResult users = mockMvc.perform(get("/users").session(adminSession))
                    .andExpect(status().isOk())
                    .andReturn();
            for (JsonNode node : objectMapper.readTree(users.getResponse().getContentAsString())) {
                if (email.equals(node.path("email").asText())) {
                    return node.path("id").asInt();
                }
            }
            throw new AssertionError("created user not found in /users: " + email);
        }

        MockHttpSession login(String email, String password) throws Exception {
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

    private record UserRef(Integer id, String email, String password) {
    }

    @Test
    void managerListsAndChangesLevelsInOwnDepartment() throws Exception {
        Fixture fx = new Fixture(mockMvc, objectMapper, "MBR");

        // the Manager sees the members and their levels
        mockMvc.perform(get("/departments/{id}/members", fx.departmentId).session(fx.managerSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.level == 'MANAGER')]").isNotEmpty())
                .andExpect(jsonPath("$[?(@.level == 'COLLABORATOR')]").isNotEmpty());

        // the Manager promotes the Collaborator — audited with before/after
        mockMvc.perform(patch("/departments/{id}/members/{userId}", fx.departmentId, fx.collaborator.id())
                        .with(csrf()).session(fx.managerSession)
                        .contentType("application/json").content("{\"level\": \"CONTRIBUTOR\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.level").value("CONTRIBUTOR"))
                .andExpect(jsonPath("$.userId").value(fx.collaborator.id()));
        assertThat(auditLogRepository.findAll())
                .anyMatch(entry -> "department".equals(entry.getEntityType())
                        && fx.departmentId.equals(entry.getEntityId())
                        && "member_level_changed".equals(entry.getAction())
                        && String.valueOf(fx.collaborator.id())
                                .equals(String.valueOf(entry.getDetails().get("user_id"))));

        // the demoted member (now CONTRIBUTOR) is 403 on both endpoints
        MockHttpSession collaboratorSession = fx.login(fx.collaborator.email(), fx.collaborator.password());
        mockMvc.perform(get("/departments/{id}/members", fx.departmentId).session(collaboratorSession))
                .andExpect(status().isForbidden());
        mockMvc.perform(patch("/departments/{id}/members/{userId}", fx.departmentId, fx.collaborator.id())
                        .with(csrf()).session(collaboratorSession)
                        .contentType("application/json").content("{\"level\": \"MANAGER\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void managerCanChangeOwnLevelAndThenFallsBackToAdmin() throws Exception {
        Fixture fx = new Fixture(mockMvc, objectMapper, "SLF");
        Integer managerUserId = fx.manager.id();

        // self-change is allowed (D2) — the Manager demotes themselves
        mockMvc.perform(patch("/departments/{id}/members/{userId}", fx.departmentId, managerUserId)
                        .with(csrf()).session(fx.managerSession)
                        .contentType("application/json").content("{\"level\": \"CONTRIBUTOR\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.level").value("CONTRIBUTOR"));

        // the (former) Manager loses the surface immediately...
        mockMvc.perform(get("/departments/{id}/members", fx.departmentId).session(fx.managerSession))
                .andExpect(status().isForbidden());

        // ...and the admin remains the fallback (D1)
        mockMvc.perform(get("/departments/{id}/members", fx.departmentId).session(fx.adminSession))
                .andExpect(status().isOk());
        mockMvc.perform(patch("/departments/{id}/members/{userId}", fx.departmentId, managerUserId)
                        .with(csrf()).session(fx.adminSession)
                        .contentType("application/json").content("{\"level\": \"MANAGER\"}"))
                .andExpect(status().isOk());
    }

    @Test
    void memberManagementGuards() throws Exception {
        Fixture fx = new Fixture(mockMvc, objectMapper, "GD");

        // an admin manages members even without a membership row
        mockMvc.perform(get("/departments/{id}/members", fx.departmentId).session(fx.adminSession))
                .andExpect(status().isOk());

        // a non-member (of a different department) is 403
        MvcResult otherDept = mockMvc.perform(post("/departments").with(csrf()).session(fx.adminSession)
                        .contentType("application/json")
                        .content("{\"code\":\"OUT" + System.nanoTime() % 100000
                                + "\",\"label\":\"Outsider dept\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        Integer otherDepartmentId = objectMapper.readTree(
                otherDept.getResponse().getContentAsString()).path("id").asInt();
        UserRef outsider = fx.createUser("gd-outsider", otherDepartmentId, "CONSUMER");
        mockMvc.perform(get("/departments/{id}/members", fx.departmentId)
                        .session(fx.login(outsider.email(), outsider.password())))
                .andExpect(status().isForbidden());

        // changing a user who is not a member of the department: 404
        mockMvc.perform(patch("/departments/{id}/members/{userId}", fx.departmentId, outsider.id())
                        .with(csrf()).session(fx.managerSession)
                        .contentType("application/json").content("{\"level\": \"MANAGER\"}"))
                .andExpect(status().isNotFound());

        // an omitted level: 400, never an assumption
        mockMvc.perform(patch("/departments/{id}/members/{userId}", fx.departmentId, fx.manager.id())
                        .with(csrf()).session(fx.managerSession)
                        .contentType("application/json").content("{}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void getDepartmentReturnsDetailsForMembersAndAdmins() throws Exception {
        Fixture fx = new Fixture(mockMvc, objectMapper, "DET");

        mockMvc.perform(get("/departments/{id}", fx.departmentId).session(fx.managerSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(fx.departmentId))
                .andExpect(jsonPath("$.label").value("Member test dept"));

        mockMvc.perform(get("/departments/{id}", fx.departmentId).session(fx.adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(fx.departmentId));
    }

    @Test
    void managerCanListAvailableUsersAddMemberAndRemoveMember() throws Exception {
        Fixture fx = new Fixture(mockMvc, objectMapper, "SVC");

        // Create an outsider user not in fx.departmentId
        UserRef candidate = fx.createUser("svc-candidate", fx.departmentId, "CONSUMER");
        // Create another department and move candidate there so they are not in fx.departmentId
        MvcResult otherDept = mockMvc.perform(post("/departments").with(csrf()).session(fx.adminSession)
                        .contentType("application/json")
                        .content("{\"code\":\"OTH" + System.nanoTime() % 100000 + "\",\"label\":\"Other dept\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        Integer otherDeptId = objectMapper.readTree(otherDept.getResponse().getContentAsString()).path("id").asInt();
        UserRef outsider = fx.createUser("svc-outsider", otherDeptId, "CONTRIBUTOR");

        // Available users endpoint lists outsider but not existing members
        mockMvc.perform(get("/departments/{id}/available-users", fx.departmentId).session(fx.managerSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == " + outsider.id() + ")]").isNotEmpty())
                .andExpect(jsonPath("$[?(@.id == " + fx.manager.id() + ")]").isEmpty());

        // Collaborator (non-manager) is 403 on available-users, add member, and remove member
        MockHttpSession collabSession = fx.login(fx.collaborator.email(), fx.collaborator.password());
        mockMvc.perform(get("/departments/{id}/available-users", fx.departmentId).session(collabSession))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/departments/{id}/members", fx.departmentId)
                        .with(csrf()).session(collabSession)
                        .contentType("application/json")
                        .content("{\"userId\":" + outsider.id() + ",\"level\":\"CONTRIBUTOR\"}"))
                .andExpect(status().isForbidden());
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete(
                        "/departments/{id}/members/{userId}", fx.departmentId, outsider.id())
                        .with(csrf()).session(collabSession))
                .andExpect(status().isForbidden());

        // Manager adds outsider as CONTRIBUTOR
        mockMvc.perform(post("/departments/{id}/members", fx.departmentId)
                        .with(csrf()).session(fx.managerSession)
                        .contentType("application/json")
                        .content("{\"userId\":" + outsider.id() + ",\"level\":\"CONTRIBUTOR\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.userId").value(outsider.id()))
                .andExpect(jsonPath("$.level").value("CONTRIBUTOR"));

        // Verified in audit log
        assertThat(auditLogRepository.findAll())
                .anyMatch(entry -> "department".equals(entry.getEntityType())
                        && fx.departmentId.equals(entry.getEntityId())
                        && "member_added".equals(entry.getAction())
                        && String.valueOf(outsider.id()).equals(String.valueOf(entry.getDetails().get("user_id"))));

        // Duplicate add is 409 Conflict
        mockMvc.perform(post("/departments/{id}/members", fx.departmentId)
                        .with(csrf()).session(fx.managerSession)
                        .contentType("application/json")
                        .content("{\"userId\":" + outsider.id() + ",\"level\":\"CONTRIBUTOR\"}"))
                .andExpect(status().isConflict());

        // Now member appears in members list
        mockMvc.perform(get("/departments/{id}/members", fx.departmentId).session(fx.managerSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.userId == " + outsider.id() + ")]").isNotEmpty());

        // Manager removes the newly added member
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete(
                        "/departments/{id}/members/{userId}", fx.departmentId, outsider.id())
                        .with(csrf()).session(fx.managerSession))
                .andExpect(status().isNoContent());

        // Verified in audit log
        assertThat(auditLogRepository.findAll())
                .anyMatch(entry -> "department".equals(entry.getEntityType())
                        && fx.departmentId.equals(entry.getEntityId())
                        && "member_removed".equals(entry.getAction())
                        && String.valueOf(outsider.id()).equals(String.valueOf(entry.getDetails().get("user_id"))));

        // Member is no longer in members list
        mockMvc.perform(get("/departments/{id}/members", fx.departmentId).session(fx.managerSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.userId == " + outsider.id() + ")]").isEmpty());

        // Removing non-member returns 404
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete(
                        "/departments/{id}/members/{userId}", fx.departmentId, outsider.id())
                        .with(csrf()).session(fx.managerSession))
                .andExpect(status().isNotFound());
    }
}
