package com.doccontrol.workflow;

import com.doccontrol.CsrfTestSupport;
import com.doccontrol.audit.AuditLogRepository;
import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.workflow.dto.WorkflowInstanceDto;
import com.doccontrol.document.DocumentDto;
import com.doccontrol.document.DocumentStatus;
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
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Phase 2b core approval flow against live Postgres + Flowable: ad-hoc
 * parallel start, 100% completion with promotion, rejection, delegation,
 * pooled role tasks, and the permission/visibility rules.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@Import(CsrfTestSupport.class)
class WorkflowEndpointTests {

    private static final String BOOTSTRAP_EMAIL = "admin@doccontrol.local";
    private static final String BOOTSTRAP_PASSWORD = "changeme_admin";

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    PasswordEncoder passwordEncoder;

    @Autowired
    EntityManager entityManager;

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
    com.doccontrol.document.DocumentRepository documentRepository;

    @Autowired
    AuditLogRepository auditLogRepository;

    @Test
    void parallelApprovalPromotesAndReleases() throws Exception {
        Department dept = tempDepartment("W1");
        createUser("wfowner@doccontrol.test", dept, "User");
        createUser("wfr1@doccontrol.test", dept, "User");
        createUser("wfr2@doccontrol.test", dept, "User");
        Integer r1Id = userId("wfr1@doccontrol.test");
        Integer r2Id = userId("wfr2@doccontrol.test");
        MockHttpSession owner = loginAs("wfowner@doccontrol.test");
        MockHttpSession r1 = loginAs("wfr1@doccontrol.test");
        MockHttpSession r2 = loginAs("wfr2@doccontrol.test");

        Integer docId = createDocumentWithFile(owner, dept.getId(), "Parallel Approval Doc");
        Integer v1Id = firstVersionId(docId, owner);

        // ad-hoc start: two named reviewers, chosen per instance
        MvcResult started = mockMvc.perform(post("/documents/{id}/versions/{versionId}/workflow/start",
                        docId, v1Id).with(csrf()).session(owner)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("assignees", List.of(
                                Map.of("type", "USER", "userId", r1Id),
                                Map.of("type", "USER", "userId", r2Id))))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("in_progress"))
                .andExpect(jsonPath("$.tasks.length()").value(2))
                .andExpect(jsonPath("$.tasks[0].dueDate").isNotEmpty())
                .andReturn();
        WorkflowInstanceDto instance = objectMapper.readValue(
                started.getResponse().getContentAsString(), WorkflowInstanceDto.class);

        // reviewers can see the draft they are reviewing (detail + list + my/tasks)
        mockMvc.perform(get("/documents/{id}", docId).session(r1))
                .andExpect(status().isOk());
        mockMvc.perform(get("/documents").session(r1))
                .andExpect(jsonPath("$.content[?(@.id == " + docId + ")]").exists());
        mockMvc.perform(get("/my/tasks").session(r1))
                .andExpect(jsonPath("$[?(@.assigneeUserId == '" + r1Id + "')]").exists());

        // first approval: still in progress, document still draft
        mockMvc.perform(post("/workflow-tasks/{taskId}/complete", taskIdFor(instance.id(), r1, r1Id))
                        .with(csrf()).session(r1)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("approved", true, "comment", "fine"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("in_progress"));

        // second approval: 100% reached — promotion and release
        mockMvc.perform(post("/workflow-tasks/{taskId}/complete", taskIdFor(instance.id(), r2, r2Id))
                        .with(csrf()).session(r2)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("approved", true))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("completed"));

        mockMvc.perform(get("/documents/{id}", docId).session(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("released"))
                .andExpect(jsonPath("$.currentVersionId").value(v1Id));
        mockMvc.perform(get("/documents/{id}/versions", docId).session(owner))
                .andExpect(jsonPath("$[0].status").value("current"));

        assertThat(auditLogRepository.findAll())
                .anyMatch(entry -> "workflow_instance".equals(entry.getEntityType())
                        && "completed".equals(entry.getAction()));
    }

    @Test
    void rejectionRejectsInstanceAndKeepsDraft() throws Exception {
        Department dept = tempDepartment("W2");
        createUser("wrejowner@doccontrol.test", dept, "User");
        createUser("wrejr1@doccontrol.test", dept, "User");
        Integer r1Id = userId("wrejr1@doccontrol.test");
        MockHttpSession owner = loginAs("wrejowner@doccontrol.test");
        MockHttpSession r1 = loginAs("wrejr1@doccontrol.test");

        Integer docId = createDocumentWithFile(owner, dept.getId(), "Reject Doc");
        Integer v1Id = firstVersionId(docId, owner);
        Integer instanceId = startApproval(owner, docId, v1Id,
                List.of(Map.of("type", "USER", "userId", userId("wrejr1@doccontrol.test"))));

        mockMvc.perform(post("/workflow-tasks/{taskId}/complete", taskIdFor(instanceId, r1, r1Id))
                        .with(csrf()).session(r1)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("approved", false))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("rejected"));

        mockMvc.perform(get("/documents/{id}", docId).session(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("draft"))
                .andExpect(jsonPath("$.currentVersionId").doesNotExist());

        // a rejected approval leaves the version free to start again
        mockMvc.perform(post("/documents/{id}/versions/{versionId}/workflow/start",
                        docId, v1Id).with(csrf()).session(owner)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("assignees", List.of(
                                Map.of("type", "USER", "userId", userId("wrejr1@doccontrol.test")))))))
                .andExpect(status().isCreated());
    }

    @Test
    void delegationIsUnrestrictedButCompletionIsNot() throws Exception {
        Department dept = tempDepartment("W3");
        createUser("wdelowner@doccontrol.test", dept, "User");
        createUser("wdelr1@doccontrol.test", dept, "User");
        createUser("wdelr2@doccontrol.test", dept, "User");
        Integer r1Id = userId("wdelr1@doccontrol.test");
        Integer r2Id = userId("wdelr2@doccontrol.test");
        MockHttpSession owner = loginAs("wdelowner@doccontrol.test");
        MockHttpSession r1 = loginAs("wdelr1@doccontrol.test");
        MockHttpSession r2 = loginAs("wdelr2@doccontrol.test");

        Integer docId = createDocumentWithFile(owner, dept.getId(), "Delegation Doc");
        Integer v1Id = firstVersionId(docId, owner);
        Integer instanceId = startApproval(owner, docId, v1Id,
                List.of(Map.of("type", "USER", "userId", r1Id)));
        String taskId = taskIdFor(instanceId, r1, r1Id);

        // a non-assignee cannot complete someone else's task
        MvcResult debug = mockMvc.perform(get("/auth/me").session(r2)).andReturn();
        mockMvc.perform(post("/workflow-tasks/{taskId}/complete", taskId).with(csrf()).session(r2)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("approved", true))))
                .andExpect(status().isForbidden());

        // the assignee delegates to anyone, and the delegate completes
        mockMvc.perform(post("/workflow-tasks/{taskId}/delegate", taskId).with(csrf()).session(r1)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("toUserId", r2Id))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tasks[?(@.assigneeUserId == '" + r2Id + "')]").exists());

        mockMvc.perform(post("/workflow-tasks/{taskId}/complete", taskId).with(csrf()).session(r2)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("approved", true))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("completed"));
    }

    @Test
    void rolePooledTaskIsClaimableByRoleMembersOnly() throws Exception {
        Department dept = tempDepartment("W4");
        createUser("wpoolowner@doccontrol.test", dept, "User");
        createUser("wpoolr@doccontrol.test", dept, "User");
        MockHttpSession owner = loginAs("wpoolowner@doccontrol.test");
        MockHttpSession poolUser = loginAs("wpoolr@doccontrol.test");
        MockHttpSession admin = loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);

        Integer docId = createDocumentWithFile(owner, dept.getId(), "Pooled Doc");
        Integer v1Id = firstVersionId(docId, owner);
        Integer instanceId = startApproval(owner, docId, v1Id,
                List.of(Map.of("type", "ROLE", "roleName", "Admin")));

        // pooled task: unassigned, candidate group is the role name
        MvcResult tasks = mockMvc.perform(get("/workflow-instances/{id}/tasks", instanceId).session(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].assigneeUserId").doesNotExist())
                .andExpect(jsonPath("$[0].candidateGroups[0]").value("Admin"))
                .andReturn();
        String taskId = firstTaskId(instanceId, owner);

        // visible in my/tasks for role holders, not for others
        mockMvc.perform(get("/my/tasks").session(admin))
                .andExpect(jsonPath("$[?(@.id == '" + taskId + "')]").exists());
        mockMvc.perform(get("/my/tasks").session(poolUser))
                .andExpect(jsonPath("$[?(@.id == '" + taskId + "')]").doesNotExist());

        // a non-member cannot complete a pooled task
        mockMvc.perform(post("/workflow-tasks/{taskId}/complete", taskId).with(csrf()).session(poolUser)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("approved", true))))
                .andExpect(status().isForbidden());

        // an Admin-role member claims and completes in one call — promotion
        mockMvc.perform(post("/workflow-tasks/{taskId}/complete", taskId).with(csrf()).session(admin)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("approved", true))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("completed"));
        mockMvc.perform(get("/documents/{id}", docId).session(owner))
                .andExpect(jsonPath("$.status").value("released"));
    }

    @Test
    void startVisibilityAndDuplicateGuards() throws Exception {
        Department dept = tempDepartment("W5");
        createUser("wvisowner@doccontrol.test", dept, "User");
        createUser("wvisout@doccontrol.test", departmentRepository.findByCode("QA").orElseThrow(), "User");
        createUser("wvisr1@doccontrol.test", dept, "User");
        MockHttpSession owner = loginAs("wvisowner@doccontrol.test");
        MockHttpSession outsider = loginAs("wvisout@doccontrol.test");

        Integer docId = createDocumentWithFile(owner, dept.getId(), "Guard Doc");
        Integer v1Id = firstVersionId(docId, owner);

        // a non-member cannot even see someone else's draft, so their start
        // attempt 404s (existence not leaked) rather than 403
        mockMvc.perform(post("/documents/{id}/versions/{versionId}/workflow/start",
                        docId, v1Id).with(csrf()).session(outsider)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("assignees", List.of(
                                Map.of("type", "USER", "userId", userId("wvisr1@doccontrol.test")))))))
                .andExpect(status().isNotFound());

        Integer instanceId = startApproval(owner, docId, v1Id,
                List.of(Map.of("type", "USER", "userId", userId("wvisr1@doccontrol.test"))));

        // a non-reviewer cannot even see the approval of a draft document
        mockMvc.perform(get("/workflow-instances/{id}", instanceId).session(outsider))
                .andExpect(status().isNotFound());

        // duplicate start on the same version is rejected
        mockMvc.perform(post("/documents/{id}/versions/{versionId}/workflow/start",
                        docId, v1Id).with(csrf()).session(owner)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("assignees", List.of(
                                Map.of("type", "USER", "userId", userId("wvisr1@doccontrol.test")))))))
                .andExpect(status().isConflict());
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

    private Integer firstVersionId(Integer documentId, MockHttpSession session) throws Exception {
        MvcResult result = mockMvc.perform(get("/documents/{id}/versions", documentId).session(session))
                .andExpect(status().isOk())
                .andReturn();
        DocumentVersionDto[] versions = objectMapper.readValue(
                result.getResponse().getContentAsString(), DocumentVersionDto[].class);
        return versions[0].id();
    }

    private Integer startApproval(MockHttpSession session, Integer documentId, Integer versionId,
                                  List<Map<String, ?>> assignees) throws Exception {
        MvcResult result = mockMvc.perform(
                        post("/documents/{id}/versions/{versionId}/workflow/start", documentId, versionId)
                                .with(csrf()).session(session)
                                .contentType("application/json")
                                .content(objectMapper.writeValueAsString(Map.of("assignees", assignees))))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readValue(result.getResponse().getContentAsString(),
                com.doccontrol.workflow.dto.WorkflowInstanceDto.class).id();
    }

    private String taskIdFor(Integer instanceId, MockHttpSession session, Integer assigneeUserId) throws Exception {
        MvcResult result = mockMvc.perform(get("/workflow-instances/{id}/tasks", instanceId).session(session))
                .andExpect(status().isOk())
                .andReturn();
        com.doccontrol.workflow.dto.WorkflowTaskDto[] tasks = objectMapper.readValue(
                result.getResponse().getContentAsString(),
                com.doccontrol.workflow.dto.WorkflowTaskDto[].class);
        for (com.doccontrol.workflow.dto.WorkflowTaskDto task : tasks) {
            if (String.valueOf(assigneeUserId).equals(task.assigneeUserId())) {
                return task.id();
            }
        }
        throw new AssertionError("No task assigned to " + assigneeUserId);
    }

    private String firstTaskId(Integer instanceId, MockHttpSession session) throws Exception {
        MvcResult result = mockMvc.perform(get("/workflow-instances/{id}/tasks", instanceId).session(session))
                .andExpect(status().isOk())
                .andReturn();
        com.doccontrol.workflow.dto.WorkflowTaskDto[] tasks = objectMapper.readValue(
                result.getResponse().getContentAsString(),
                com.doccontrol.workflow.dto.WorkflowTaskDto[].class);
        return tasks[0].id();
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
        userDepartmentRepository.saveAndFlush(departmentMembership);

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
