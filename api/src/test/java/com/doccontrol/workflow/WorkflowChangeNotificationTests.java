package com.doccontrol.workflow;

import com.doccontrol.CsrfTestSupport;
import com.doccontrol.audit.NotificationLog;
import com.doccontrol.audit.NotificationLogRepository;
import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.document.DocumentDto;
import com.doccontrol.document.DocumentRepository;
import com.doccontrol.document.DocumentStatus;
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
import com.doccontrol.notification.NotificationSender;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.flowable.engine.TaskService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static com.doccontrol.CsrfTestSupport.csrf;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.lenient;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Phase 2e change notifications (plan-back approved 2026-09-11): every
 * active member of the document's department gets one DOCUMENT_CHANGED
 * notice per version, when the version becomes effective — on immediate
 * approval completion (first release included) or on the daily job's
 * effective-date flip; never for re-approvals or deferred outcomes at
 * completion time. Membership is the rule: no role carve-out, nothing
 * outside the department. Phase 5 of the sweep is an exact catch-up, and
 * a send failure must never block or roll back the approval (flag F1).
 *
 * The sender is a mock so bodies and failures can be asserted; the
 * notification_log rows are written by the service regardless.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@Import(CsrfTestSupport.class)
class WorkflowChangeNotificationTests {

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
    NotificationLogRepository notificationLogRepository;

    @Autowired
    WorkflowInstanceRepository workflowInstanceRepository;

    @Autowired
    TaskService taskService;

    @Autowired
    WorkflowNotificationJob job;

    @MockitoBean
    NotificationSender notificationSender;

    /** Bodies of successful sends, captured for content assertions. */
    private final List<String> sentBodies = new ArrayList<>();

    /** When true, sends to the blocking user's address throw (a Graph outage). */
    private volatile boolean blockRecipientSends;

    @BeforeEach
    void stubSender() {
        lenient().doReturn("log").when(notificationSender).channel();
        doAnswer(invocation -> {
            User recipient = invocation.getArgument(0);
            if (blockRecipientSends && recipient.getEmail().startsWith("chgblock")) {
                throw new IllegalStateException("simulated Graph outage");
            }
            sentBodies.add(invocation.getArgument(2));
            return null;
        }).when(notificationSender).send(any(), any(), any());
        doAnswer(invocation -> {
            User recipient = invocation.getArgument(0);
            if (blockRecipientSends && recipient.getEmail().startsWith("chgblock")) {
                throw new IllegalStateException("simulated Graph outage");
            }
            sentBodies.add(invocation.getArgument(2));
            return null;
        }).when(notificationSender).sendHtml(any(), any(), any(), any());
    }

    @Test
    void immediateApprovalNotifiesEveryDepartmentMemberExactlyOnce() throws Exception {
        Department dept = tempDepartment("C1");
        Department other = tempDepartment("C2");
        createUser("chgowner1@doccontrol.test", dept, "User");
        createUser("chgreviewer1@doccontrol.test", dept, "User");
        createUser("chgmember1@doccontrol.test", dept, "User");
        createUser("chgoutsider@doccontrol.test", other, "User");
        MockHttpSession owner = loginAs("chgowner1@doccontrol.test");

        Integer docId = createDocumentWithFile(owner, dept.getId(), "Change Notice Doc");
        Integer v1Id = firstVersionId(docId, owner);
        Integer instanceId = startApproval(owner, docId, v1Id, "chgreviewer1@doccontrol.test");
        completeTask("chgreviewer1@doccontrol.test", taskOf(instanceId).getId(),
                Map.of("approved", true, "comment", "ok"));

        // First release counts as a change: every active member, no
        // exclusions — owner and approving reviewer included.
        Integer ownerId = userId("chgowner1@doccontrol.test");
        Integer reviewerId = userId("chgreviewer1@doccontrol.test");
        Integer memberId = userId("chgmember1@doccontrol.test");
        Integer outsiderId = userId("chgoutsider@doccontrol.test");
        Integer adminId = userId(BOOTSTRAP_EMAIL);
        assertThat(changeNoticesFor(ownerId, v1Id)).hasSize(1);
        assertThat(changeNoticesFor(reviewerId, v1Id)).hasSize(1);
        assertThat(changeNoticesFor(memberId, v1Id)).hasSize(1);
        // membership is the definition: nothing outside the department,
        // admins included only via membership (flag F3)
        assertThat(changeNoticesFor(outsiderId, v1Id)).isEmpty();
        assertThat(changeNoticesFor(adminId, v1Id)).isEmpty();

        // phase 5 catch-up for a version that became effective today: the
        // live path already served everyone, dedup keeps it exactly once
        job.run(LocalDate.now());
        assertThat(changeNoticesFor(ownerId, v1Id)).hasSize(1);
        assertThat(changeNoticesFor(reviewerId, v1Id)).hasSize(1);
        assertThat(changeNoticesFor(memberId, v1Id)).hasSize(1);
    }

    @Test
    void reapprovalNeverNotifiesButTheEffectiveDateFlipDoes() throws Exception {
        Department dept = tempDepartment("C3");
        createUser("chgowner3@doccontrol.test", dept, "User");
        createUser("chgreviewer3@doccontrol.test", dept, "User");
        MockHttpSession owner = loginAs("chgowner3@doccontrol.test");

        Integer docId = createReleasedDocument(owner, dept.getId(), "Reapproval Notice Doc",
                "chgreviewer3@doccontrol.test");
        Integer v1Id = firstVersionId(docId, owner);
        Integer ownerId = userId("chgowner3@doccontrol.test");
        Integer reviewerId = userId("chgreviewer3@doccontrol.test");
        assertThat(changeNoticesFor(ownerId, v1Id)).hasSize(1);

        // immediate re-approval: content unchanged, pointer never moves —
        // no new notice (flag F2)
        MvcResult reapproval = mockMvc.perform(post("/documents/{id}/review-approval", docId)
                        .with(csrf()).session(owner)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("assignees", List.of(
                                Map.of("type", "USER", "userId", reviewerId))))))
                .andExpect(status().isCreated())
                .andReturn();
        completeTask("chgreviewer3@doccontrol.test",
                taskOf(instanceIdOf(reapproval)).getId(), Map.of("approved", true));
        assertThat(changeNoticesFor(ownerId, v1Id)).hasSize(1);
        assertThat(changeNoticesFor(reviewerId, v1Id)).hasSize(1);

        // v2 approved with a future effective date: no notice at completion
        Integer v2Id = uploadVersion(owner, docId);
        Integer instanceId = startApproval(owner, docId, v2Id, "chgreviewer3@doccontrol.test");
        LocalDate day = BusinessDays.addBusinessDays(LocalDate.now(), 3);
        completeTask("chgreviewer3@doccontrol.test", taskOf(instanceId).getId(),
                Map.of("approved", true, "comment", "deferred",
                        "effectiveDate", day.toString()));
        assertThat(changeNoticesFor(ownerId, v2Id)).isEmpty();
        assertThat(changeNoticesFor(reviewerId, v2Id)).isEmpty();

        // the flip on the effective date notifies once per member — phase 1
        // sends inline and phase 5 of the same run re-checks; three runs on
        // the date stay at exactly one (flag F4)
        job.run(day);
        job.run(day);
        job.run(day);
        assertThat(changeNoticesFor(ownerId, v2Id)).hasSize(1);
        assertThat(changeNoticesFor(reviewerId, v2Id)).hasSize(1);
        // the old version is not re-announced by later sweeps
        assertThat(changeNoticesFor(ownerId, v1Id)).hasSize(1);
    }

    @Test
    void bodyCarriesChangeReferenceAndFailedSendsNeverBlockTheApproval() throws Exception {
        Department dept = tempDepartment("C4");
        createUser("chgowner4@doccontrol.test", dept, "User");
        createUser("chgreviewer4@doccontrol.test", dept, "User");
        createUser("chgblock4@doccontrol.test", dept, "User");
        MockHttpSession owner = loginAs("chgowner4@doccontrol.test");

        Integer docId = createDocumentWithFile(owner, dept.getId(), "Change Reference Doc");
        Integer v1Id = firstVersionId(docId, owner);
        Integer instance1 = startApproval(owner, docId, v1Id, "chgreviewer4@doccontrol.test");
        completeTask("chgreviewer4@doccontrol.test", taskOf(instance1).getId(),
                Map.of("approved", true, "comment", "ok"));

        // v2 carries the 2c change reference; the notice must show it
        Integer v2Id = uploadVersionWithChangeReference(owner, docId, "CR-042");
        Integer instance2 = startApproval(owner, docId, v2Id, "chgreviewer4@doccontrol.test");

        // a Graph outage for one member: the approval must still complete
        blockRecipientSends = true;
        completeTask("chgreviewer4@doccontrol.test", taskOf(instance2).getId(),
                Map.of("approved", true, "comment", "ok"));
        blockRecipientSends = false;
        assertThat(documentRepository.findById(docId).orElseThrow().getStatus())
                .isEqualTo(DocumentStatus.RELEASED);

        Integer ownerId = userId("chgowner4@doccontrol.test");
        Integer reviewerId = userId("chgreviewer4@doccontrol.test");
        Integer blockedId = userId("chgblock4@doccontrol.test");
        assertThat(changeNoticesFor(ownerId, v2Id)).hasSize(1);
        assertThat(changeNoticesFor(reviewerId, v2Id)).hasSize(1);
        assertThat(changeNoticesFor(blockedId, v2Id)).isEmpty();

        // the captured v2 body carries the change reference (§2 content)
        String v2Subject = "Document changed: "
                + documentRepository.findById(docId).orElseThrow().getDocumentNumber()
                + " Rev 1 now in effect";
        List<NotificationLog> v2Rows = changeNoticesFor(ownerId, v2Id);
        assertThat(v2Rows.get(0).getSubject()).isEqualTo(v2Subject);
        assertThat(sentBodies).anyMatch(body -> body.contains("Change reference: CR-042"));

        // the sweep's catch-up redelivers to the one member whose send failed
        job.run(LocalDate.now());
        assertThat(changeNoticesFor(blockedId, v2Id)).hasSize(1);
        assertThat(changeNoticesFor(ownerId, v2Id)).hasSize(1);
    }

    // ---- assertions helper ----

    private List<NotificationLog> changeNoticesFor(Integer recipientId, Integer versionId) {
        return notificationLogRepository.findAll().stream()
                .filter(entry -> "DOCUMENT_CHANGED".equals(entry.getKind()))
                .filter(entry -> entry.getDocumentVersion() != null
                        && versionId.equals(entry.getDocumentVersion().getId()))
                .filter(entry -> recipientId.equals(entry.getRecipient().getId()))
                .toList();
    }

    // ---- helpers (mirroring the other workflow test classes) ----

    private Integer instanceIdOf(MvcResult result) throws Exception {
        return objectMapper.readValue(result.getResponse().getContentAsString(),
                com.doccontrol.workflow.dto.WorkflowInstanceDto.class).id();
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

    /** Creates a document and releases version 1 through an immediate approval. */
    private Integer createReleasedDocument(MockHttpSession owner, Integer departmentId,
                                           String name, String reviewerEmail) throws Exception {
        Integer docId = createDocumentWithFile(owner, departmentId, name);
        Integer v1Id = firstVersionId(docId, owner);
        Integer instanceId = startApproval(owner, docId, v1Id, reviewerEmail);
        completeTask(reviewerEmail, taskOf(instanceId).getId(),
                Map.of("approved", true, "comment", "ok"));
        return docId;
    }

    private Integer startApproval(MockHttpSession session, Integer documentId,
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
                com.doccontrol.workflow.dto.WorkflowInstanceDto.class).id();
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

    private Integer uploadVersionWithChangeReference(MockHttpSession session, Integer documentId,
                                                     String changeReference) throws Exception {
        MvcResult result = mockMvc.perform(multipart("/documents/{id}/versions", documentId)
                        .file(new MockMultipartFile("file", "rev.txt", "text/plain", "rev".getBytes()))
                        .param("change_notes", "test revision")
                        .param("change_reference", changeReference)
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
        departmentMembership.setDepartment(department);        departmentMembership.setLevel(MembershipLevel.COLLABORATOR);
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
