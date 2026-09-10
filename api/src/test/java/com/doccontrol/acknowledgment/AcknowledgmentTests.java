package com.doccontrol.acknowledgment;

import com.doccontrol.CsrfTestSupport;
import com.doccontrol.acknowledgment.dto.AcknowledgmentDto;
import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.document.Document;
import com.doccontrol.document.DocumentDto;
import com.doccontrol.document.DocumentRepository;
import com.doccontrol.document.DocumentVersionDto;
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
import com.doccontrol.workflow.WorkflowInstance;
import com.doccontrol.workflow.WorkflowInstanceRepository;
import com.doccontrol.workflow.dto.WorkflowInstanceDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.flowable.engine.TaskService;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Read &amp; understood acknowledgment (Phase 2d): department-scoped,
 * record-only, idempotent, no carry-forward across versions, and status
 * visibility limited to owner/admin/granted users via per-document grants.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@Import(CsrfTestSupport.class)
class AcknowledgmentTests {

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

    @Autowired
    DocumentRepository documentRepository;

    @Autowired
    TaskService taskService;

    @Autowired
    WorkflowInstanceRepository workflowInstanceRepository;

    @Autowired
    DocumentAcknowledgmentRepository acknowledgmentRepository;

    @Test
    void acknowledgeIsIdempotentDepartmentScopedAndRecordOnly() throws Exception {
        Department dept = tempDepartment("A1");
        Department otherDept = tempDepartment("A2");
        createUser("ackowner@doccontrol.test", dept, "User");
        createUser("ackmember@doccontrol.test", dept, "User");
        createUser("outsider@doccontrol.test", otherDept, "User");
        MockHttpSession owner = loginAs("ackowner@doccontrol.test");

        Integer docId = createReleasedDocument(owner, dept.getId(), "Acknowledge Doc",
                "ackowner@doccontrol.test");

        // a department member acknowledges; the second call returns the same record
        MvcResult first = mockMvc.perform(post("/documents/{id}/acknowledge", docId)
                        .with(csrf()).session(loginAs("ackmember@doccontrol.test")))
                .andExpect(status().isOk())
                .andReturn();
        MvcResult second = mockMvc.perform(post("/documents/{id}/acknowledge", docId)
                        .with(csrf()).session(loginAs("ackmember@doccontrol.test")))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(first.getResponse().getContentAsString())
                .isEqualTo(second.getResponse().getContentAsString());
        assertThat(acknowledgmentRepository.count()).isEqualTo(1);

        // a user outside the document's department is out of scope (403, not 404)
        mockMvc.perform(post("/documents/{id}/acknowledge", docId)
                        .with(csrf()).session(loginAs("outsider@doccontrol.test")))
                .andExpect(status().isForbidden());

        // admins are not exempt: the acknowledged population is the department (D7)
        mockMvc.perform(post("/documents/{id}/acknowledge", docId)
                        .with(csrf()).session(loginAs("admin@doccontrol.local", "changeme_admin")))
                .andExpect(status().isForbidden());

        // draft documents cannot be acknowledged — there is nothing in effect
        Integer draftDoc = createDocumentWithFile(owner, dept.getId(), "Draft Only Doc");
        mockMvc.perform(post("/documents/{id}/acknowledge", draftDoc)
                        .with(csrf()).session(loginAs("ackmember@doccontrol.test")))
                .andExpect(status().isConflict());
    }

    @Test
    void statusVisibilityFollowsOwnerAdminAndGrants() throws Exception {
        Department dept = tempDepartment("A3");
        createUser("ackowner2@doccontrol.test", dept, "User");
        createUser("ackmember2@doccontrol.test", dept, "User");
        createUser("ackmember3@doccontrol.test", dept, "User");
        MockHttpSession owner = loginAs("ackowner2@doccontrol.test");

        Integer docId = createReleasedDocument(owner, dept.getId(), "Status Doc",
                "ackowner2@doccontrol.test");
        mockMvc.perform(post("/documents/{id}/acknowledge", docId)
                        .with(csrf()).session(loginAs("ackmember2@doccontrol.test")))
                .andExpect(status().isOk());

        // owner sees status: one acknowledged, one outstanding, window open
        MvcResult ownerView = mockMvc.perform(get("/documents/{id}/acknowledgments", docId).session(owner))
                .andExpect(status().isOk())
                .andReturn();
        String body = ownerView.getResponse().getContentAsString();
        assertThat(body).contains("ackmember2@doccontrol.test");
        assertThat(body).contains("ackmember3@doccontrol.test");
        assertThat(body).contains("\"overdue\":false");

        // admins see status by default
        mockMvc.perform(get("/documents/{id}/acknowledgments", docId)
                        .session(loginAs("admin@doccontrol.local", "changeme_admin")))
                .andExpect(status().isOk());

        // a plain department member does not
        MockHttpSession member3 = loginAs("ackmember3@doccontrol.test");
        mockMvc.perform(get("/documents/{id}/acknowledgments", docId).session(member3))
                .andExpect(status().isForbidden());

        // owner grants status visibility to member3 — grant only, no document permissions
        mockMvc.perform(post("/documents/{id}/acknowledgments/access", docId)
                        .with(csrf()).session(owner)
                        .contentType("application/json")
                        .content("{\"userId\":" + userId("ackmember3@doccontrol.test") + "}"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/documents/{id}/acknowledgments", docId).session(member3))
                .andExpect(status().isOk());

        // revoking closes the access again; revoking again 404s
        mockMvc.perform(delete("/documents/{id}/acknowledgments/access/{userId}", docId,
                        userId("ackmember3@doccontrol.test")).with(csrf()).session(owner))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/documents/{id}/acknowledgments", docId).session(member3))
                .andExpect(status().isForbidden());
        mockMvc.perform(delete("/documents/{id}/acknowledgments/access/{userId}", docId,
                        userId("ackmember3@doccontrol.test")).with(csrf()).session(owner))
                .andExpect(status().isNotFound());
    }

    @Test
    void freshVersionReopensAcknowledgmentWithoutCarryForward() throws Exception {
        Department dept = tempDepartment("A4");
        createUser("ackowner4@doccontrol.test", dept, "User");
        createUser("ackmember4@doccontrol.test", dept, "User");
        MockHttpSession owner = loginAs("ackowner4@doccontrol.test");

        Integer docId = createReleasedDocument(owner, dept.getId(), "Carry-Forward Doc",
                "ackowner4@doccontrol.test");
        mockMvc.perform(post("/documents/{id}/acknowledge", docId)
                        .with(csrf()).session(loginAs("ackmember4@doccontrol.test")))
                .andExpect(status().isOk());

        // a new version is approved and takes effect immediately
        Integer v2Id = uploadVersion(owner, docId);
        WorkflowInstanceDto instance = startApproval(owner, docId, v2Id, "ackowner4@doccontrol.test");
        completeTask("ackowner4@doccontrol.test", taskOf(instance.id()).getId(),
                Map.of("approved", true, "comment", "rev b"));
        Document document = documentRepository.findById(docId).orElseThrow();
        assertThat(document.getCurrentVersion().getId()).isEqualTo(v2Id);

        // the department owes a fresh acknowledgment for v2 — nothing carried forward
        MvcResult statusBefore = mockMvc.perform(get("/documents/{id}/acknowledgments", docId).session(owner))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(statusBefore.getResponse().getContentAsString())
                .contains("ackmember4@doccontrol.test");   // outstanding again

        MvcResult fresh = mockMvc.perform(post("/documents/{id}/acknowledge", docId)
                        .with(csrf()).session(loginAs("ackmember4@doccontrol.test")))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(objectMapper.readValue(fresh.getResponse().getContentAsString(),
                AcknowledgmentDto.class).documentVersionId()).isEqualTo(v2Id);
        assertThat(acknowledgmentRepository.count()).isEqualTo(2);   // one per version
    }

    // ---- helpers (mirroring the other test classes) ----

    private Integer createReleasedDocument(MockHttpSession owner, Integer departmentId,
                                           String name, String userEmail) throws Exception {
        Integer docId = createDocumentWithFile(owner, departmentId, name);
        Integer v1Id = firstVersionId(docId, owner);
        WorkflowInstanceDto instance = startApproval(owner, docId, v1Id, userEmail);
        completeTask(userEmail, taskOf(instance.id()).getId(),
                Map.of("approved", true, "comment", "ok"));
        return docId;
    }

    private org.flowable.task.api.Task taskOf(Integer instanceId) {
        WorkflowInstance domainInstance = workflowInstanceRepository.findById(instanceId).orElseThrow();
        org.flowable.task.api.Task task = taskService.createTaskQuery()
                .processInstanceId(domainInstance.getProcessInstanceId())
                .singleResult();
        if (task == null) {
            throw new AssertionError("No active task for instance " + instanceId);
        }
        return task;
    }

    private void completeTask(String userEmail, String taskId, Map<String, ?> body) throws Exception {
        mockMvc.perform(post("/workflow-tasks/{taskId}/complete", taskId)
                        .with(csrf()).session(loginAs(userEmail))
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk());
    }

    private WorkflowInstanceDto startApproval(MockHttpSession session, Integer documentId,
                                              Integer versionId, String reviewerEmail) throws Exception {
        MvcResult result = mockMvc.perform(
                        post("/documents/{id}/versions/{versionId}/workflow/start", documentId, versionId)
                                .with(csrf()).session(session)
                                .contentType("application/json")
                                .content(objectMapper.writeValueAsString(Map.of("assignees", List.of(
                                        Map.of("type", "USER", "userId", userId(reviewerEmail)))))))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readValue(result.getResponse().getContentAsString(),
                WorkflowInstanceDto.class);
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

    private Integer firstVersionId(Integer documentId, MockHttpSession session) throws Exception {
        MvcResult result = mockMvc.perform(get("/documents/{id}/versions", documentId).session(session))
                .andExpect(status().isOk())
                .andReturn();
        DocumentVersionDto[] versions = objectMapper.readValue(
                result.getResponse().getContentAsString(), DocumentVersionDto[].class);
        return versions[0].id();
    }

    private Integer uploadVersion(MockHttpSession session, Integer documentId) throws Exception {
        MvcResult result = mockMvc.perform(multipart("/documents/{id}/versions", documentId)
                        .file(new MockMultipartFile("file", "rev.txt", "text/plain", "rev".getBytes()))
                        .param("change_notes", "test revision")
                        .with(csrf())
                        .session(session))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readValue(result.getResponse().getContentAsString(),
                DocumentVersionDto.class).id();
    }

    private Integer sopTypeId() {
        return documentTypeRepository.findAll().stream()
                .filter(type -> "SOP".equals(type.getCode()))
                .findFirst().orElseThrow()
                .getId();
    }

    private Integer userId(String email) {
        return userRepository.findByEmailIgnoreCase(email).orElseThrow().getId();
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
