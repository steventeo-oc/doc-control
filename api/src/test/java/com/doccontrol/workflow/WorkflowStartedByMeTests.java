package com.doccontrol.workflow;

import com.doccontrol.CsrfTestSupport;
import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.document.DocumentDto;
import com.doccontrol.document.DocumentVersionDto;
import com.doccontrol.identity.MembershipLevel;
import com.doccontrol.identity.Role;
import com.doccontrol.identity.User;
import com.doccontrol.identity.UserDepartment;
import com.doccontrol.identity.UserDepartmentId;
import com.doccontrol.identity.UserDepartmentRepository;
import com.doccontrol.identity.UserRepository;
import com.doccontrol.identity.UserRole;
import com.doccontrol.identity.UserRoleId;
import com.doccontrol.identity.UserRoleRepository;
import com.doccontrol.identity.RoleRepository;
import com.doccontrol.lookup.Department;
import com.doccontrol.lookup.DepartmentRepository;
import com.doccontrol.lookup.DocumentTypeRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

import static com.doccontrol.CsrfTestSupport.csrf;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The "Started by Me" pane (plan-back approved 2026-09-14): the caller's
 * started instances, newest first, with the per-reviewer approved/pending
 * breakdown for in-progress ones — approved names sourced from our own
 * audit trail (the performed_by of each task_approved row; the engine's
 * task history does not reliably persist assignees), pending names from
 * the active tasks, pooled tasks rendering the candidate role as the
 * pending party. Rejected instances report rejected with no reviewers
 * array.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@Import(CsrfTestSupport.class)
class WorkflowStartedByMeTests {

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
    UserDepartmentRepository userDepartmentRepository;

    @Autowired
    RoleRepository roleRepository;

    @Autowired
    DepartmentRepository departmentRepository;

    @Autowired
    DocumentTypeRepository documentTypeRepository;

    @Test
    void startedByMeListsOwnInstancesWithReviewerStates() throws Exception {
        Department dept = tempDepartment("SB");
        String owner = createUser("sbowner@doccontrol.test", dept, "User");
        String r1 = createUser("sbr1@doccontrol.test", dept, "User");
        String r2 = createUser("sbr2@doccontrol.test", dept, "User");
        MockHttpSession ownerSession = loginAs(owner);

        Integer docId = createDocumentWithFile(ownerSession, dept.getId(), "Started By Me Doc");
        startApproval(ownerSession, docId, List.of(
                Map.of("type", "USER", "userId", userId(r1)),
                Map.of("type", "USER", "userId", userId(r2))));

        // both reviewers still pending
        JsonNode before = startedByMe(ownerSession);
        assertThat(before).hasSize(1);
        assertThat(before.get(0).get("status").asText()).isEqualTo("in_progress");
        assertThat(before.get(0).get("reapproval").asBoolean()).isFalse();
        JsonNode reviewers = before.get(0).get("reviewers");
        assertThat(reviewers).hasSize(2);
        assertThat(namesInState(reviewers, "pending"))
                .containsExactlyInAnyOrder(nameOf(r1), nameOf(r2));

        // r1 approves: the finished-task history supplies the approved name
        completeOwnTask(r1, docId, true);
        JsonNode after = startedByMe(ownerSession);
        JsonNode reviewersAfter = after.get(0).get("reviewers");
        assertThat(reviewersAfter).hasSize(2);
        // approved entries come first (ordered by finish time), pending last
        assertThat(reviewersAfter.get(0).get("name").asText()).isEqualTo(nameOf(r1));
        assertThat(reviewersAfter.get(0).get("state").asText()).isEqualTo("approved");
        assertThat(reviewersAfter.get(1).get("name").asText()).isEqualTo(nameOf(r2));
        assertThat(reviewersAfter.get(1).get("state").asText()).isEqualTo("pending");

        // the starter scoping: a reviewer who started nothing sees no rows
        assertThat(startedByMe(loginAs(r2))).isEmpty();
    }

    @Test
    void rejectedInstanceReportsRejectedWithoutReviewers() throws Exception {
        Department dept = tempDepartment("SR");
        String owner = createUser("srowner@doccontrol.test", dept, "User");
        String r1 = createUser("srr1@doccontrol.test", dept, "User");
        MockHttpSession ownerSession = loginAs(owner);

        Integer first = createDocumentWithFile(ownerSession, dept.getId(), "Started Rejected 1");
        startApproval(ownerSession, first, List.of(Map.of("type", "USER", "userId", userId(r1))));
        Integer second = createDocumentWithFile(ownerSession, dept.getId(), "Started Rejected 2");
        startApproval(ownerSession, second, List.of(Map.of("type", "USER", "userId", userId(r1))));

        // reject the second instance
        completeOwnTask(r1, second, false);

        JsonNode rows = startedByMe(ownerSession);
        assertThat(rows).hasSize(2);
        // newest first: the rejected instance leads
        assertThat(rows.get(0).get("status").asText()).isEqualTo("rejected");
        assertThat(rows.get(0).get("completedAt")).isNotNull();
        assertThat(rows.get(0).get("reviewers").isEmpty()).isTrue();
        assertThat(rows.get(1).get("status").asText()).isEqualTo("in_progress");
    }

    @Test
    void pooledTaskRendersRoleAsPending() throws Exception {
        Department dept = tempDepartment("SP");
        String owner = createUser("spowner@doccontrol.test", dept, "User");
        MockHttpSession ownerSession = loginAs(owner);

        Integer docId = createDocumentWithFile(ownerSession, dept.getId(), "Started Pooled Doc");
        startApproval(ownerSession, docId, List.of(Map.of("type", "ROLE", "roleName", "User")));

        JsonNode rows = startedByMe(ownerSession);
        assertThat(rows).hasSize(1);
        JsonNode reviewers = rows.get(0).get("reviewers");
        assertThat(reviewers).hasSize(1);
        assertThat(reviewers.get(0).get("state").asText()).isEqualTo("pending");
        // nobody has committed until someone claims (plan-back F5): the
        // candidate role is the pending party, not an individual
        assertThat(reviewers.get(0).get("name").isNull()).isTrue();
        assertThat(reviewers.get(0).get("role").asText()).isEqualTo("User");
    }

    private JsonNode startedByMe(MockHttpSession session) throws Exception {
        MvcResult result = mockMvc.perform(get("/my/started-instances").session(session))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }

    private void completeOwnTask(String email, Integer documentId, boolean approved) throws Exception {
        MockHttpSession session = loginAs(email);
        MvcResult result = mockMvc.perform(get("/my/tasks").session(session))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode tasks = objectMapper.readTree(result.getResponse().getContentAsString());
        String taskId = null;
        for (JsonNode task : tasks) {
            if (task.get("documentId").asInt() == documentId) {
                taskId = task.get("id").asText();
            }
        }
        assertThat(taskId).as("no pending task for document %s", documentId).isNotNull();
        mockMvc.perform(post("/workflow-tasks/{taskId}/complete", taskId).with(csrf())
                        .session(session)
                        .contentType("application/json")
                        .content("{\"approved\":" + approved + ",\"comment\":null,\"effectiveDate\":null}"))
                .andExpect(status().isOk());
    }

    private List<String> namesInState(JsonNode reviewers, String state) {
        return java.util.stream.StreamSupport.stream(reviewers.spliterator(), false)
                .filter(r -> state.equals(r.get("state").asText()))
                .map(r -> r.get("name").asText())
                .toList();
    }

    private String nameOf(String email) {
        return userRepository.findByEmailIgnoreCase(email).orElseThrow().getName();
    }

    private Integer userId(String email) {
        return userRepository.findByEmailIgnoreCase(email).orElseThrow().getId();
    }

    private Department tempDepartment(String suffix) {
        Department department = new Department();
        department.setCode("T" + suffix + System.nanoTime() % 100000);
        department.setLabel("Temp " + suffix);
        department.setActive(true);
        return departmentRepository.save(department);
    }

    private Integer createDocumentWithFile(MockHttpSession session, Integer departmentId, String name)
            throws Exception {
        MvcResult result = mockMvc.perform(multipart("/documents")
                        .file(new MockMultipartFile("file", "doc.txt", "text/plain", "content".getBytes()))
                        .param("document_type_id", String.valueOf(sopTypeId()))
                        .param("department_id", String.valueOf(departmentId))
                        .param("name", name)
                        .with(csrf())
                        .session(session))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readValue(result.getResponse().getContentAsString(), DocumentDto.class).id();
    }

    private Integer startApproval(MockHttpSession session, Integer documentId,
                                  List<Map<String, ?>> assignees) throws Exception {
        Integer versionId = Integer.valueOf(firstVersionId(documentId, session));
        MvcResult result = mockMvc.perform(
                        post("/documents/{documentId}/versions/{versionId}/workflow/start",
                                documentId, versionId)
                                .with(csrf()).session(session)
                                .contentType("application/json")
                                .content(objectMapper.writeValueAsString(Map.of("assignees", assignees))))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readValue(result.getResponse().getContentAsString(),
                com.doccontrol.workflow.dto.WorkflowInstanceDto.class).id();
    }

    private String firstVersionId(Integer documentId, MockHttpSession session) throws Exception {
        MvcResult result = mockMvc.perform(get("/documents/{id}/versions", documentId).session(session))
                .andExpect(status().isOk())
                .andReturn();
        DocumentVersionDto[] versions = objectMapper.readValue(
                result.getResponse().getContentAsString(), DocumentVersionDto[].class);
        return versions[0].id().toString();
    }

    private Integer sopTypeId() {
        return documentTypeRepository.findAll().stream()
                .filter(type -> "SOP".equals(type.getCode()))
                .findFirst().orElseThrow()
                .getId();
    }

    private String createUser(String email, Department department, String... roleNames) {
        User user = new User();
        user.setName(email);
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode("pw-" + email));
        user.setActive(true);
        userRepository.save(user);

        UserDepartment departmentMembership = new UserDepartment();
        departmentMembership.setId(new UserDepartmentId(user.getId(), department.getId()));
        departmentMembership.setUser(user);
        departmentMembership.setDepartment(department);
        departmentMembership.setLevel(MembershipLevel.COLLABORATOR);
        userDepartmentRepository.saveAndFlush(departmentMembership);
        user.getDepartments().add(departmentMembership);

        for (String roleName : roleNames) {
            Role role = roleRepository.findByName(roleName).orElseThrow();
            UserRole membership = new UserRole();
            membership.setId(new UserRoleId(user.getId(), role.getId()));
            membership.setUser(user);
            membership.setRole(role);
            userRoleRepository.saveAndFlush(membership);
            user.getRoles().add(membership);
        }
        return email;
    }

    private MockHttpSession loginAs(String email) throws Exception {
        return loginAs(email, "pw-" + email);
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
}
