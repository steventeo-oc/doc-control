package com.doccontrol.workflow;

import com.doccontrol.CsrfTestSupport;
import com.doccontrol.audit.NotificationLog;
import com.doccontrol.audit.NotificationLogRepository;
import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.document.Document;
import com.doccontrol.document.DocumentDto;
import com.doccontrol.document.DocumentRepository;
import com.doccontrol.document.DocumentVersion;
import com.doccontrol.document.DocumentVersionDto;
import com.doccontrol.document.DocumentVersionRepository;
import com.doccontrol.document.DocumentVersionStatus;
import com.doccontrol.document.DocumentStatus;
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
 * Effective-date semantics (Phase 2c, plan-back flags F2/F3, decision D2):
 * a deferred approval leaves the document "approved" with the public
 * pointer untouched until the daily job flips it; at most one
 * pending-effective version exists per document; past dates are rejected.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@Import(CsrfTestSupport.class)
class WorkflowEffectivityTests {

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
    DocumentVersionRepository documentVersionRepository;

    @Autowired
    NotificationLogRepository notificationLogRepository;

    @Autowired
    WorkflowInstanceRepository workflowInstanceRepository;

    @Autowired
    org.flowable.engine.TaskService taskService;

    @Test
    void deferredApprovalLeavesDocumentApprovedWithPointerUntouched() throws Exception {
        Department dept = tempDepartment("E1");
        createUser("effowner@doccontrol.test", dept, "User");
        createUser("effrev@doccontrol.test", dept, "User");
        MockHttpSession owner = loginAs("effowner@doccontrol.test");

        Integer docId = createDocumentWithFile(owner, dept.getId(), "Deferred Doc");
        Integer v1Id = firstVersionId(docId, owner);
        Integer instanceId = startApproval(owner, docId, v1Id, reviewer("effrev@doccontrol.test"));

        LocalDate effective = LocalDate.now().plusDays(10);
        completeTask("effrev@doccontrol.test", taskIdOf(instanceId), true, effective);

        Document document = documentRepository.findById(docId).orElseThrow();
        assertThat(document.getStatus()).isEqualTo(DocumentStatus.APPROVED);
        assertThat(document.getCurrentVersion()).isNull();          // pointer untouched
        DocumentVersion version = documentVersionRepository.findById(v1Id).orElseThrow();
        assertThat(version.getStatus()).isEqualTo(DocumentVersionStatus.APPROVED);
        assertThat(version.getEffectiveAt()).isEqualTo(effective);
    }

    @Test
    void pastEffectiveDateIsRejected() throws Exception {
        Department dept = tempDepartment("E2");
        createUser("effowner2@doccontrol.test", dept, "User");
        createUser("effrev2@doccontrol.test", dept, "User");
        MockHttpSession owner = loginAs("effowner2@doccontrol.test");

        Integer docId = createDocumentWithFile(owner, dept.getId(), "Past Date Doc");
        Integer v1Id = firstVersionId(docId, owner);
        Integer instanceId = startApproval(owner, docId, v1Id, reviewer("effrev2@doccontrol.test"));

        MockHttpSession reviewer = loginAs("effrev2@doccontrol.test");
        mockMvc.perform(post("/workflow-tasks/{taskId}/complete", taskIdOf(instanceId))
                        .with(csrf()).session(reviewer)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of(
                                "approved", true,
                                "effectiveDate", LocalDate.now().minusDays(1).toString()))))
                .andExpect(status().isConflict());

        Document document = documentRepository.findById(docId).orElseThrow();
        assertThat(document.getStatus()).isEqualTo(DocumentStatus.DRAFT);   // nothing moved
    }

    @Test
    void secondPendingOutcomeRetiresTheFirstWithOwnerNotification() throws Exception {
        Department dept = tempDepartment("E3");
        createUser("effowner3@doccontrol.test", dept, "User");
        createUser("effrev3@doccontrol.test", dept, "User");
        MockHttpSession owner = loginAs("effowner3@doccontrol.test");

        // release v1 immediately, then park v2 as pending-effective
        Integer docId = createDocumentWithFile(owner, dept.getId(), "Supersede Doc");
        Integer v1Id = firstVersionId(docId, owner);
        Integer firstInstance = startApproval(owner, docId, v1Id, reviewer("effrev3@doccontrol.test"));
        completeTask("effrev3@doccontrol.test", taskIdOf(firstInstance), true, null);
        assertThat(documentRepository.findById(docId).orElseThrow().getStatus())
                .isEqualTo(DocumentStatus.RELEASED);

        Integer v2Id = uploadVersion(owner, docId);
        Integer secondInstance = startApproval(owner, docId, v2Id, reviewer("effrev3@doccontrol.test"));
        completeTask("effrev3@doccontrol.test", taskIdOf(secondInstance), true, LocalDate.now().plusDays(10));

        Integer v3Id = uploadVersion(owner, docId);
        Integer thirdInstance = startApproval(owner, docId, v3Id, reviewer("effrev3@doccontrol.test"));
        completeTask("effrev3@doccontrol.test", taskIdOf(thirdInstance), true, LocalDate.now().plusDays(20));

        Document document = documentRepository.findById(docId).orElseThrow();
        assertThat(document.getStatus()).isEqualTo(DocumentStatus.APPROVED);
        assertThat(document.getCurrentVersion().getId()).isEqualTo(v1Id);   // still the released v1
        assertThat(documentVersionRepository.findById(v2Id).orElseThrow().getStatus())
                .isEqualTo(DocumentVersionStatus.SUPERSEDED);                // retired, never took effect
        DocumentVersion v3 = documentVersionRepository.findById(v3Id).orElseThrow();
        assertThat(v3.getStatus()).isEqualTo(DocumentVersionStatus.APPROVED); // the only pending one
        assertThat(v3.getEffectiveAt()).isEqualTo(LocalDate.now().plusDays(20));

        Integer ownerId = userId("effowner3@doccontrol.test");
        List<NotificationLog> notices = notificationLogRepository.findAll().stream()
                .filter(entry -> "PENDING_SUPERSEDED".equals(entry.getKind()))
                .filter(entry -> ownerId.equals(entry.getRecipient().getId()))
                .toList();
        assertThat(notices).hasSize(1);
        assertThat(notices.get(0).getDocumentVersion().getId()).isEqualTo(v2Id);
    }

    // ---- helpers (mirroring the other workflow test classes) ----

    private Map<String, ?> reviewer(String email) {
        return Map.of("type", "USER", "userId", userId(email));
    }

    private String taskIdOf(Integer instanceId) {
        WorkflowInstance instance = workflowInstanceRepository.findById(instanceId).orElseThrow();
        org.flowable.task.api.Task task = taskService.createTaskQuery()
                .processInstanceId(instance.getProcessInstanceId())
                .singleResult();
        if (task == null) {
            throw new AssertionError("No active task for instance " + instanceId);
        }
        return task.getId();
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

    private Integer startApproval(MockHttpSession session, Integer documentId, Integer versionId,
                                  Map<String, ?> assignee) throws Exception {
        MvcResult result = mockMvc.perform(
                        post("/documents/{id}/versions/{versionId}/workflow/start", documentId, versionId)
                                .with(csrf()).session(session)
                                .contentType("application/json")
                                .content(objectMapper.writeValueAsString(Map.of("assignees", List.of(assignee)))))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readValue(result.getResponse().getContentAsString(),
                com.doccontrol.workflow.dto.WorkflowInstanceDto.class).id();
    }

    private void completeTask(String reviewerEmail, String taskId, boolean approved,
                              LocalDate effectiveDate) throws Exception {
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("approved", approved);
        body.put("comment", "test");
        if (effectiveDate != null) {
            body.put("effectiveDate", effectiveDate.toString());
        }
        mockMvc.perform(post("/workflow-tasks/{taskId}/complete", taskId)
                        .with(csrf()).session(loginAs(reviewerEmail))
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk());
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
