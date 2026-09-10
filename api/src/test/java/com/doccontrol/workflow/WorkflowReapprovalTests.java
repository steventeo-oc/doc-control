package com.doccontrol.workflow;

import com.doccontrol.CsrfTestSupport;
import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.document.Document;
import com.doccontrol.document.DocumentDto;
import com.doccontrol.document.DocumentRepository;
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

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static com.doccontrol.CsrfTestSupport.csrf;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Periodic-review re-approval (Phase 2c, plan-back flags F1/F6/F8): runs on
 * the released current version, is visibly a re-approval, never moves the
 * version pointer, resets the review clock on completion, and only one
 * approval may be in flight per document.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@Import(CsrfTestSupport.class)
class WorkflowReapprovalTests {

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

    @Test
    void reapprovalCompletesWithoutPointerMoveAndResetsReviewClock() throws Exception {
        Department dept = tempDepartment("R1");
        createUser("reaowner@doccontrol.test", dept, "User");
        createUser("rearev@doccontrol.test", dept, "User");
        MockHttpSession owner = loginAs("reaowner@doccontrol.test");

        Integer docId = createReleasedDocument(owner, dept.getId(), "Reapproval Doc", "rearev@doccontrol.test");
        Document before = documentRepository.findById(docId).orElseThrow();
        Integer v1Id = before.getCurrentVersion().getId();

        MvcResult startResult = mockMvc.perform(post("/documents/{id}/review-approval", docId)
                        .with(csrf()).session(owner)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of(
                                "assignees", List.of(Map.of("type", "USER",
                                        "userId", userId("rearev@doccontrol.test")))))))
                .andExpect(status().isCreated())
                .andReturn();
        WorkflowInstanceDto instance = objectMapper.readValue(
                startResult.getResponse().getContentAsString(), WorkflowInstanceDto.class);
        assertThat(instance.reapproval()).isTrue();

        org.flowable.task.api.Task task = taskOf(instance.id());
        assertThat(task.getName()).isEqualTo("Periodic review re-approval");

        mockMvc.perform(post("/workflow-tasks/{taskId}/complete", task.getId())
                        .with(csrf()).session(loginAs("rearev@doccontrol.test"))
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("approved", true, "comment", "still valid"))))
                .andExpect(status().isOk());

        Document after = documentRepository.findById(docId).orElseThrow();
        assertThat(after.getStatus()).isEqualTo(DocumentStatus.RELEASED);
        assertThat(after.getCurrentVersion().getId()).isEqualTo(v1Id);      // pointer never moved
        assertThat(after.getLastReviewedAt()).isEqualTo(LocalDate.now());
        assertThat(after.getNextReviewDue()).isEqualTo(LocalDate.now().plusMonths(12));
    }

    @Test
    void rejectedReapprovalLeavesDocumentReleasedAndStillOverdue() throws Exception {
        Department dept = tempDepartment("R2");
        createUser("reaowner2@doccontrol.test", dept, "User");
        createUser("rearev2@doccontrol.test", dept, "User");
        MockHttpSession owner = loginAs("reaowner2@doccontrol.test");

        Integer docId = createReleasedDocument(owner, dept.getId(), "Rejected Reapproval Doc",
                "rearev2@doccontrol.test");

        // the document is review-overdue before the re-approval starts
        Document document = documentRepository.findById(docId).orElseThrow();
        document.setNextReviewDue(LocalDate.now().minusDays(5));
        documentRepository.save(document);

        MvcResult startResult = mockMvc.perform(post("/documents/{id}/review-approval", docId)
                        .with(csrf()).session(owner)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of(
                                "assignees", List.of(Map.of("type", "USER",
                                        "userId", userId("rearev2@doccontrol.test")))))))
                .andExpect(status().isCreated())
                .andReturn();
        WorkflowInstanceDto instance = objectMapper.readValue(
                startResult.getResponse().getContentAsString(), WorkflowInstanceDto.class);

        mockMvc.perform(post("/workflow-tasks/{taskId}/complete", taskOf(instance.id()).getId())
                        .with(csrf()).session(loginAs("rearev2@doccontrol.test"))
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("approved", false, "comment", "needs rework"))))
                .andExpect(status().isOk());

        Document after = documentRepository.findById(docId).orElseThrow();
        assertThat(after.getStatus()).isEqualTo(DocumentStatus.RELEASED);            // content unchanged
        assertThat(after.getNextReviewDue()).isEqualTo(LocalDate.now().minusDays(5)); // still overdue (F8)
    }

    @Test
    void reapprovalRequiresReleasedDocument() throws Exception {
        Department dept = tempDepartment("R3");
        createUser("reaowner3@doccontrol.test", dept, "User");
        MockHttpSession owner = loginAs("reaowner3@doccontrol.test");

        Integer docId = createDocumentWithFile(owner, dept.getId(), "Draft Only Doc");
        mockMvc.perform(post("/documents/{id}/review-approval", docId)
                        .with(csrf()).session(owner)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of(
                                "assignees", List.of(Map.of("type", "USER",
                                        "userId", userId("reaowner3@doccontrol.test")))))))
                .andExpect(status().isConflict());
    }

    @Test
    void onlyOneApprovalInFlightPerDocument() throws Exception {
        Department dept = tempDepartment("R4");
        createUser("reaowner4@doccontrol.test", dept, "User");
        createUser("rearev4@doccontrol.test", dept, "User");
        MockHttpSession owner = loginAs("reaowner4@doccontrol.test");

        Integer docId = createReleasedDocument(owner, dept.getId(), "In-Flight Doc", "rearev4@doccontrol.test");

        // re-approval is in flight; a draft-version approval on a new upload
        // must be rejected at the document level (plan-back flag F6)
        Integer v2Id = uploadVersion(owner, docId);
        mockMvc.perform(post("/documents/{id}/review-approval", docId)
                        .with(csrf()).session(owner)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of(
                                "assignees", List.of(Map.of("type", "USER",
                                        "userId", userId("rearev4@doccontrol.test")))))))
                .andExpect(status().isCreated());
        mockMvc.perform(post("/documents/{id}/versions/{versionId}/workflow/start", docId, v2Id)
                        .with(csrf()).session(owner)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of(
                                "assignees", List.of(Map.of("type", "USER",
                                        "userId", userId("rearev4@doccontrol.test")))))))
                .andExpect(status().isConflict());
    }

    @Test
    void reviewerCandidatesAreGatedByCanModifyNotAdmin() throws Exception {
        Department dept = tempDepartment("R5");
        Department otherDept = tempDepartment("R6");
        createUser("reaowner5@doccontrol.test", dept, "User");   // non-admin owner
        createUser("reamember5@doccontrol.test", dept, "User");  // non-admin member
        createUser("outsider5@doccontrol.test", otherDept, "User");
        MockHttpSession owner = loginAs("reaowner5@doccontrol.test");

        Integer docId = createReleasedDocument(owner, dept.getId(), "Candidates Doc",
                "reaowner5@doccontrol.test");

        // a non-admin department member (not the owner) can list candidates
        MvcResult memberView = mockMvc.perform(
                        get("/documents/{id}/reviewer-candidates", docId)
                                .session(loginAs("reamember5@doccontrol.test")))
                .andExpect(status().isOk())
                .andReturn();
        String body = memberView.getResponse().getContentAsString();
        assertThat(body).contains("reaowner5@doccontrol.test");
        assertThat(body).contains("reamember5@doccontrol.test");

        // the non-admin owner themselves
        MvcResult ownerView = mockMvc.perform(
                        get("/documents/{id}/reviewer-candidates", docId).session(owner))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(ownerView.getResponse().getContentAsString())
                .contains("reamember5@doccontrol.test");

        // a user outside the department: the released document is visible but
        // they cannot modify it, so the picklist is forbidden
        mockMvc.perform(get("/documents/{id}/reviewer-candidates", docId)
                        .session(loginAs("outsider5@doccontrol.test")))
                .andExpect(status().isForbidden());
    }

    // ---- helpers (mirroring the other workflow test classes) ----

    /** Creates a document and releases version 1 through an immediate approval. */
    private Integer createReleasedDocument(MockHttpSession owner, Integer departmentId,
                                           String name, String reviewerEmail) throws Exception {
        Integer docId = createDocumentWithFile(owner, departmentId, name);
        Integer v1Id = firstVersionId(docId, owner);
        MvcResult result = mockMvc.perform(
                        post("/documents/{id}/versions/{versionId}/workflow/start", docId, v1Id)
                                .with(csrf()).session(owner)
                                .contentType("application/json")
                                .content(objectMapper.writeValueAsString(Map.of("assignees", List.of(
                                        Map.of("type", "USER", "userId", userId(reviewerEmail)))))))
                .andExpect(status().isCreated())
                .andReturn();
        WorkflowInstanceDto instance = objectMapper.readValue(
                result.getResponse().getContentAsString(), WorkflowInstanceDto.class);
        mockMvc.perform(post("/workflow-tasks/{taskId}/complete", taskOf(instance.id()).getId())
                        .with(csrf()).session(loginAs(reviewerEmail))
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("approved", true, "comment", "ok"))))
                .andExpect(status().isOk());
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

    @Autowired
    WorkflowInstanceRepository workflowInstanceRepository;

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
