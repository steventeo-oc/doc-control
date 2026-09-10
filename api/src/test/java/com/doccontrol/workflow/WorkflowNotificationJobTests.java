package com.doccontrol.workflow;

import com.doccontrol.CsrfTestSupport;
import com.doccontrol.audit.NotificationLog;
import com.doccontrol.audit.NotificationLogRepository;
import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.document.DocumentDto;
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
import org.flowable.engine.TaskService;
import org.flowable.task.api.Task;
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
import java.time.ZoneId;
import java.util.Date;
import java.util.List;
import java.util.Map;

import static com.doccontrol.CsrfTestSupport.csrf;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Reminder/escalation sweep (Phase 2b, confirmed with QA): reminders 1
 * business day before and on the due date, escalation to owner + active
 * admins at 2+ business days overdue, dedup via notification_log, pooled
 * tasks remind current role members. Dates are driven deterministically by
 * calling {@link WorkflowNotificationJob#run(LocalDate)} directly.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@Import(CsrfTestSupport.class)
class WorkflowNotificationJobTests {

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
    NotificationLogRepository notificationLogRepository;

    @Autowired
    WorkflowInstanceRepository workflowInstanceRepository;

    @Autowired
    TaskService taskService;

    @Autowired
    WorkflowNotificationJob job;

    @Test
    void reminderWindowsDedupAndEscalationRecipients() throws Exception {
        Department dept = tempDepartment("N1");
        createUser("wfnotowner@doccontrol.test", dept, "User");
        createUser("wfnotr1@doccontrol.test", dept, "User");
        Integer r1Id = userId("wfnotr1@doccontrol.test");
        MockHttpSession owner = loginAs("wfnotowner@doccontrol.test");

        Integer docId = createDocumentWithFile(owner, dept.getId(), "Reminder Doc");
        Integer v1Id = firstVersionId(docId, owner);
        Integer instanceId = startApproval(owner, docId, v1Id,
                List.of(Map.of("type", "USER", "userId", r1Id)));
        Task task = taskOf(instanceId);
        String taskId = task.getId();
        LocalDate due = task.getDueDate().toInstant().atZone(ZoneId.systemDefault()).toLocalDate();

        // too early: no notifications
        job.run(BusinessDays.addBusinessDays(due, -2));
        assertThat(remindersFor(r1Id, taskId)).isEmpty();

        // one business day before the due date: reminder to the reviewer
        job.run(BusinessDays.addBusinessDays(due, -1));
        assertThat(remindersFor(r1Id, taskId)).hasSize(1);

        // same day again: per-day dedup, still one
        job.run(BusinessDays.addBusinessDays(due, -1));
        assertThat(remindersFor(r1Id, taskId)).hasSize(1);

        // on the due date: second reminder (new day)
        job.run(due);
        assertThat(remindersFor(r1Id, taskId)).hasSize(2);

        // one business day overdue: past the reminder window, escalation not yet due
        job.run(BusinessDays.addBusinessDays(due, 1));
        assertThat(remindersFor(r1Id, taskId)).hasSize(2);
        assertThat(escalationsFor(r1Id, taskId)).isEmpty();

        // two business days overdue: escalation to the document owner + active admins
        job.run(BusinessDays.addBusinessDays(due, 2));
        Integer ownerId = userId("wfnotowner@doccontrol.test");
        Integer adminId = userId(BOOTSTRAP_EMAIL);
        assertThat(escalationsFor(ownerId, taskId)).hasSize(1);
        assertThat(escalationsFor(adminId, taskId)).hasSize(1);
        // the overdue reviewer is not an escalation recipient
        assertThat(escalationsFor(r1Id, taskId)).isEmpty();

        // escalation dedup: once per task per recipient, ever
        job.run(BusinessDays.addBusinessDays(due, 3));
        assertThat(escalationsFor(ownerId, taskId)).hasSize(1);
        assertThat(escalationsFor(adminId, taskId)).hasSize(1);
    }

    @Test
    void pooledTasksRemindCurrentRoleMembers() throws Exception {
        Department dept = tempDepartment("N2");
        createUser("wpoolowner@doccontrol.test", dept, "User");
        MockHttpSession owner = loginAs("wpoolowner@doccontrol.test");

        Integer docId = createDocumentWithFile(owner, dept.getId(), "Pooled Reminder Doc");
        Integer v1Id = firstVersionId(docId, owner);
        Integer instanceId = startApproval(owner, docId, v1Id,
                List.of(Map.of("type", "ROLE", "roleName", "Admin")));
        String pooledTaskId = taskOf(instanceId).getId();
        LocalDate due = taskOf(instanceId).getDueDate().toInstant()
                .atZone(ZoneId.systemDefault()).toLocalDate();

        // the pooled task is unclaimed: the reminder goes to the role's members
        job.run(BusinessDays.addBusinessDays(due, -1));
        Integer adminId = userId(BOOTSTRAP_EMAIL);
        assertThat(remindersFor(adminId, pooledTaskId)).hasSize(1);
    }

    @Test
    void dailySweepEndpointIsAdminOnlyAndSafeToReRun() throws Exception {
        Department dept = tempDepartment("N3");
        createUser("wfsweep@doccontrol.test", dept, "User");

        // a non-admin is forbidden
        mockMvc.perform(post("/admin/jobs/daily-sweep").with(csrf())
                        .session(loginAs("wfsweep@doccontrol.test")))
                .andExpect(status().isForbidden());

        // an admin can run the sweep as of any business date — a past date
        // included (idempotent per date; nothing here has state due)
        mockMvc.perform(post("/admin/jobs/daily-sweep")
                        .param("date", LocalDate.now().minusDays(5).toString())
                        .with(csrf()).session(loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD)))
                .andExpect(status().isOk());
    }

    private List<NotificationLog> remindersFor(Integer recipientId, String taskId) {
        return notificationLogRepository.findAll().stream()
                .filter(entry -> "REMINDER".equals(entry.getKind()))
                .filter(entry -> taskId.equals(entry.getFlowableTaskId()))
                .filter(entry -> recipientId.equals(entry.getRecipient().getId()))
                .toList();
    }

    private List<NotificationLog> escalationsFor(Integer recipientId, String taskId) {
        return notificationLogRepository.findAll().stream()
                .filter(entry -> "ESCALATION".equals(entry.getKind()))
                .filter(entry -> taskId.equals(entry.getFlowableTaskId()))
                .filter(entry -> recipientId.equals(entry.getRecipient().getId()))
                .toList();
    }

    private Task taskOf(Integer instanceId) {
        WorkflowInstance instance = workflowInstanceRepository.findById(instanceId).orElseThrow();
        Task task = taskService.createTaskQuery()
                .processInstanceId(instance.getProcessInstanceId())
                .singleResult();
        if (task.getDueDate() == null) {
            throw new AssertionError("Task has no due date");
        }
        return task;
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
