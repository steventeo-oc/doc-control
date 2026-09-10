package com.doccontrol.workflow;

import com.doccontrol.CsrfTestSupport;
import com.doccontrol.audit.AuditLog;
import com.doccontrol.audit.AuditLogRepository;
import com.doccontrol.audit.NotificationLog;
import com.doccontrol.audit.NotificationLogRepository;
import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.document.Document;
import com.doccontrol.document.DocumentDto;
import com.doccontrol.document.DocumentRepository;
import com.doccontrol.document.DocumentStatus;
import com.doccontrol.document.DocumentVersion;
import com.doccontrol.document.DocumentVersionDto;
import com.doccontrol.document.DocumentVersionRepository;
import com.doccontrol.document.DocumentVersionStatus;
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
import java.util.stream.Collectors;

import static com.doccontrol.CsrfTestSupport.csrf;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The user-visible guarantee behind the daily sweep (Phase 2c plan-back §4):
 * running {@link WorkflowNotificationJob#run(LocalDate)} twice for the same
 * business date must be safe — no double effectivity flips, no duplicate
 * notifications, no duplicate audit entries.
 *
 * One date drives every phase at once: an approval task due that day
 * (REMINDER), a document whose deferred version takes effect that day
 * (flip + clock reset), a document due for review that day (REVIEW_DUE), a
 * document 2 business days review-overdue (REVIEW_OVERDUE), and a
 * re-approval whose deferred review-clock reset lands that day.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@Import(CsrfTestSupport.class)
class WorkflowJobIdempotencyTests {

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
    AuditLogRepository auditLogRepository;

    @Autowired
    WorkflowInstanceRepository workflowInstanceRepository;

    @Autowired
    TaskService taskService;

    @Autowired
    WorkflowNotificationJob job;

    @Test
    void jobIsIdempotentForAGivenBusinessDate() throws Exception {
        Department dept = tempDepartment("I1");
        createUser("idemownerA@doccontrol.test", dept, "User");
        createUser("idemownerB@doccontrol.test", dept, "User");
        createUser("idemownerC@doccontrol.test", dept, "User");
        createUser("idemownerD@doccontrol.test", dept, "User");
        MockHttpSession sessionA = loginAs("idemownerA@doccontrol.test");
        MockHttpSession sessionB = loginAs("idemownerB@doccontrol.test");
        MockHttpSession sessionC = loginAs("idemownerC@doccontrol.test");
        MockHttpSession sessionD = loginAs("idemownerD@doccontrol.test");

        // Doc C: an approval in flight — its due date is the business date under test
        Integer docC = createDocumentWithFile(sessionC, dept.getId(), "Idempotency Approval Doc");
        Integer vC = firstVersionId(docC, sessionC);
        WorkflowInstanceDto instanceC = startApproval(sessionC, docC, vC, "idemownerC@doccontrol.test");
        LocalDate day = taskDueDate(instanceC.id());

        // Doc A: v1 released immediately; v2 approved with effect from `day` (pending flip).
        // The flip runs first in the sweep, so doc A itself produces no review
        // notification on `day` — its clock resets to day+12 months.
        Integer docA = createReleasedDocument(sessionA, dept.getId(), "Idempotency Flip Doc",
                "idemownerA@doccontrol.test");
        Integer v2A = uploadVersion(sessionA, docA);
        startAndCompleteWithDate(sessionA, docA, v2A, "idemownerA@doccontrol.test", day);

        // Doc B: released, review 2 business days overdue on `day` (REVIEW_OVERDUE)
        Integer docB = createReleasedDocument(sessionB, dept.getId(), "Idempotency Overdue Doc",
                "idemownerB@doccontrol.test");
        Document docBEntity = documentRepository.findById(docB).orElseThrow();
        docBEntity.setNextReviewDue(BusinessDays.addBusinessDays(day, -2));
        documentRepository.save(docBEntity);

        // Doc E: released, review due exactly on `day` (REVIEW_DUE window)
        MockHttpSession sessionE = loginAs("idemownerA@doccontrol.test");
        Integer docE = createReleasedDocument(sessionE, dept.getId(), "Idempotency Due Doc",
                "idemownerA@doccontrol.test");
        Document docEEntity = documentRepository.findById(docE).orElseThrow();
        docEEntity.setNextReviewDue(day);
        documentRepository.save(docEEntity);

        // Doc D: released, re-approval completed with effect from `day`
        // (deferred review-clock reset)
        Integer docD = createReleasedDocument(sessionD, dept.getId(), "Idempotency Recert Doc",
                "idemownerD@doccontrol.test");
        startAndCompleteReviewApproval(sessionD, docD, "idemownerD@doccontrol.test", day);

        // ---- first run on `day`: every phase fires once ----
        job.run(day);
        Map<String, Long> notificationsAfterRun1 = notificationsByKind();
        long statusChangesAfterRun1 = auditCount("document", "status_changed");
        long clockResetsAfterRun1 = auditCount("document", "review_clock_reset");

        // the flip landed exactly once
        DocumentVersion v2 = documentVersionRepository.findById(v2A).orElseThrow();
        assertThat(v2.getStatus()).isEqualTo(DocumentVersionStatus.CURRENT);
        Document afterFlip = documentRepository.findById(docA).orElseThrow();
        assertThat(afterFlip.getStatus()).isEqualTo(DocumentStatus.RELEASED);
        assertThat(afterFlip.getCurrentVersion().getId()).isEqualTo(v2A);
        assertThat(afterFlip.getLastReviewedAt()).isEqualTo(day);
        assertThat(afterFlip.getNextReviewDue()).isEqualTo(day.plusMonths(12));
        // the deferred re-approval reset landed exactly once
        Document afterReset = documentRepository.findById(docD).orElseThrow();
        assertThat(afterReset.getLastReviewedAt()).isEqualTo(day);
        assertThat(afterReset.getPendingReviewEffectiveAt()).isNull();
        // the day's notifications exist
        assertThat(notificationsAfterRun1).containsKeys("REMINDER", "REVIEW_DUE", "REVIEW_OVERDUE");

        // ---- second run, same business date: nothing may change ----
        job.run(day);
        assertThat(notificationsByKind()).as("no duplicate notifications")
                .isEqualTo(notificationsAfterRun1);
        assertThat(auditCount("document", "status_changed")).as("no duplicate flips")
                .isEqualTo(statusChangesAfterRun1);
        assertThat(auditCount("document", "review_clock_reset")).as("no duplicate clock resets")
                .isEqualTo(clockResetsAfterRun1);

        // ---- third run for good measure: still nothing ----
        job.run(day);
        assertThat(notificationsByKind()).isEqualTo(notificationsAfterRun1);
        assertThat(auditCount("document", "status_changed")).isEqualTo(statusChangesAfterRun1);
        assertThat(auditCount("document", "review_clock_reset")).isEqualTo(clockResetsAfterRun1);
    }

    // ---- helpers (mirroring the other workflow test classes) ----

    private Map<String, Long> notificationsByKind() {
        return notificationLogRepository.findAll().stream()
                .collect(Collectors.groupingBy(NotificationLog::getKind, Collectors.counting()));
    }

    private long auditCount(String entityType, String action) {
        return auditLogRepository.findAll().stream()
                .filter(entry -> entityType.equals(entry.getEntityType()))
                .filter(entry -> action.equals(entry.getAction()))
                .count();
    }

    private LocalDate taskDueDate(Integer instanceId) {
        WorkflowInstance instance = workflowInstanceRepository.findById(instanceId).orElseThrow();
        org.flowable.task.api.Task task = taskService.createTaskQuery()
                .processInstanceId(instance.getProcessInstanceId())
                .singleResult();
        if (task == null || task.getDueDate() == null) {
            throw new AssertionError("Expected an active task with a due date");
        }
        return task.getDueDate().toInstant().atZone(java.time.ZoneId.systemDefault()).toLocalDate();
    }

    /** Creates a document and releases version 1 through an immediate approval. */
    private Integer createReleasedDocument(MockHttpSession owner, Integer departmentId,
                                           String name, String userEmail) throws Exception {
        Integer docId = createDocumentWithFile(owner, departmentId, name);
        Integer v1Id = firstVersionId(docId, owner);
        WorkflowInstanceDto instance = startApproval(owner, docId, v1Id, userEmail);
        completeTask(userEmail, taskOf(instance.id()).getId(),
                Map.of("approved", true, "comment", "ok"));
        return docId;
    }

    /** Starts a normal approval on a draft version and completes it with an effective date. */
    private void startAndCompleteWithDate(MockHttpSession owner, Integer documentId, Integer versionId,
                                          String userEmail, LocalDate effectiveDate) throws Exception {
        WorkflowInstanceDto instance = startApproval(owner, documentId, versionId, userEmail);
        completeTask(userEmail, taskOf(instance.id()).getId(),
                Map.of("approved", true, "comment", "deferred", "effectiveDate", effectiveDate.toString()));
    }

    /** Starts a review re-approval and completes it with a future effective date. */
    private void startAndCompleteReviewApproval(MockHttpSession owner, Integer documentId,
                                                String userEmail, LocalDate effectiveDate) throws Exception {
        MvcResult result = mockMvc.perform(post("/documents/{id}/review-approval", documentId)
                        .with(csrf()).session(owner)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("assignees", List.of(
                                Map.of("type", "USER", "userId", userId(userEmail)))))))
                .andExpect(status().isCreated())
                .andReturn();
        WorkflowInstanceDto instance = objectMapper.readValue(
                result.getResponse().getContentAsString(), WorkflowInstanceDto.class);
        completeTask(userEmail, taskOf(instance.id()).getId(),
                Map.of("approved", true, "comment", "recertified", "effectiveDate", effectiveDate.toString()));
    }

    private org.flowable.task.api.Task taskOf(Integer instanceId) {
        WorkflowInstance instance = workflowInstanceRepository.findById(instanceId).orElseThrow();
        org.flowable.task.api.Task task = taskService.createTaskQuery()
                .processInstanceId(instance.getProcessInstanceId())
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
