package com.doccontrol.audit;

import com.doccontrol.CsrfTestSupport;
import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.document.DocumentDto;
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
import com.doccontrol.lookup.DocumentTierRepository;
import com.doccontrol.lookup.DocumentTypeRepository;
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

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static com.doccontrol.CsrfTestSupport.csrf;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The permission-scoped audit-log query (activity plan-back, approved
 * 2026-09-14): server-enforced scoping is the whole point. A non-admin
 * never gets company scope (403, never a silent clamp); department scope
 * shows exactly the caller's departments' rows — System-user rows
 * included, NULL-department rows and other departments' rows never; Mine
 * is strictly the caller's own actions. Rows come from real audited
 * actions (document creates in two departments, an admin lookup create
 * for the NULL-department case) plus one synthetic System-user row with a
 * department to pin the sweep-row semantics.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@Import(CsrfTestSupport.class)
class AuditLogQueryTests {

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
    DocumentTierRepository documentTierRepository;

    @Autowired
    AuditLogRepository auditLogRepository;

    @Autowired
    SystemActor systemActor;

    /** The fixture rows every test starts from: 2 department rows, 1 NULL row, 1 System row. */
    private record Fixture(Department deptA, Department deptB, String actorAEmail,
                           String actorBEmail, Integer docAId) {
    }

    private Fixture seed() throws Exception {
        Department deptA = tempDepartment("AL");
        Department deptB = tempDepartment("BL");
        Department deptC = tempDepartment("CL");
        String actorAEmail = createUser("audit-a@doccontrol.test", deptA, "User");
        addMembership("audit-a@doccontrol.test", deptC);
        String actorBEmail = createUser("audit-b@doccontrol.test", deptB, "User");

        // real audited actions: one document per department (no file →
        // exactly one audit row each), an admin lookup create (NULL dept)
        MockHttpSession sessionA = loginAs(actorAEmail);
        Integer docAId = createDocument(sessionA, deptA, "Audit Doc A");
        createDocument(loginAs(actorBEmail), deptB, "Audit Doc B");
        createType(loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD), "ALT");

        // a sweep-driven row: the System user mutating a dept-A document
        AuditLog systemRow = new AuditLog();
        systemRow.setEntityType("document");
        systemRow.setEntityId(docAId);
        systemRow.setAction("status_changed");
        systemRow.setPerformedBy(systemActor.get());
        systemRow.setDepartmentId(deptA.getId());
        systemRow.setDetails(Map.of("document_number", "SOP-A-0001"));
        auditLogRepository.save(systemRow);

        return new Fixture(deptA, deptB, actorAEmail, actorBEmail, docAId);
    }

    @Test
    void companyScopeIsForbiddenForNonAdmins() throws Exception {
        Fixture f = seed();

        mockMvc.perform(get("/audit-log?scope=company").session(loginAs(f.actorAEmail())))
                .andExpect(status().isForbidden());

        // malformed scope/category values are bad requests, not 500s
        mockMvc.perform(get("/audit-log?scope=bogus").session(loginAs(f.actorAEmail())))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/audit-log?category=bogus").session(loginAs(f.actorAEmail())))
                .andExpect(status().isBadRequest());
    }

    @Test
    void departmentsScopeShowsOwnDepartmentsOnly() throws Exception {
        Fixture f = seed();

        JsonNode page = listScope(loginAs(f.actorAEmail()), "?scope=departments");

        // exactly the two dept-A rows: the actor's document create and the
        // System row. The dept-B create and the NULL-department lookup row
        // must not appear — totalElements pins the exclusion.
        assertThat(page.get("totalElements").asLong()).isEqualTo(2);
        assertThat(deptCodesOf(page)).containsOnly(f.deptA().getCode());
        assertThat(actionsOf(page)).contains("document/created", "document/status_changed");
    }

    @Test
    void mineScopeShowsOnlyOwnRows() throws Exception {
        Fixture f = seed();

        JsonNode page = listScope(loginAs(f.actorAEmail()), "?scope=mine");

        assertThat(page.get("totalElements").asLong()).isEqualTo(1);
        assertThat(actionsOf(page)).containsExactly("document/created");
        assertThat(actorEmailsOf(page)).containsExactly(f.actorAEmail());
    }

    @Test
    void adminCompanyScopeSeesEverything() throws Exception {
        Fixture f = seed();

        JsonNode page = listScope(loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD), "?scope=company");

        assertThat(page.get("totalElements").asLong()).isEqualTo(4);
        assertThat(deptCodesOf(page)).contains(f.deptA().getCode(), f.deptB().getCode());
        assertThat(deptCodesOf(page)).containsNull();
    }

    @Test
    void categoryFilterExcludesUncategorizedRows() throws Exception {
        Fixture f = seed();
        MockHttpSession admin = loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);

        JsonNode documents = listScope(admin, "?scope=company&category=documents");
        // the two document creates plus the System status_changed row; the
        // document_type create is uncategorized and must not appear
        assertThat(documents.get("totalElements").asLong()).isEqualTo(3);
        assertThat(entityTypesOf(documents)).containsOnly("document");

        JsonNode membership = listScope(admin, "?scope=company&category=membership");
        assertThat(membership.get("totalElements").asLong()).isEqualTo(0);

        // uncategorized rows are only reachable without a category filter
        JsonNode all = listScope(admin, "?scope=company");
        assertThat(entityTypesOf(all)).contains("document_type");
    }

    @Test
    void fromToWindowFiltersByPerformedAt() throws Exception {
        Fixture f = seed();
        MockHttpSession admin = loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);

        JsonNode future = listScope(admin,
                "?scope=company&from=" + LocalDate.now().plusDays(1));
        assertThat(future.get("totalElements").asLong()).isEqualTo(0);

        JsonNode today = listScope(admin, "?scope=company&from=" + LocalDate.now().minusDays(1)
                + "&to=" + LocalDate.now());
        assertThat(today.get("totalElements").asLong()).isEqualTo(4);
    }

    @Test
    void paginationMirrorsTheDocumentsListShape() throws Exception {
        Fixture f = seed();
        MockHttpSession admin = loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);

        JsonNode page = listScope(admin, "?scope=company&page_size=1&page=1");

        assertThat(page.get("content").size()).isEqualTo(1);
        assertThat(page.get("page").asInt()).isEqualTo(1);
        assertThat(page.get("pageSize").asInt()).isEqualTo(1);
        assertThat(page.get("totalElements").asLong()).isEqualTo(4);
        assertThat(page.get("totalPages").asInt()).isEqualTo(4);
    }

    @Test
    void departmentIdFilterInCompanyAndDepartmentsScope() throws Exception {
        Fixture f = seed();
        MockHttpSession admin = loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);

        // Filter company scope by deptA id -> exactly the 2 deptA rows
        JsonNode pageDeptA = listScope(admin, "?scope=company&department_id=" + f.deptA().getId());
        assertThat(pageDeptA.get("totalElements").asLong()).isEqualTo(2);
        assertThat(deptCodesOf(pageDeptA)).containsOnly(f.deptA().getCode());

        // Filter departments scope as user A for deptA -> exactly 2 rows
        JsonNode pageUserA = listScope(loginAs(f.actorAEmail()), "?scope=departments&department_id=" + f.deptA().getId());
        assertThat(pageUserA.get("totalElements").asLong()).isEqualTo(2);

        // Filter departments scope as user A for deptB (which user A does not belong to) -> 0 rows
        JsonNode pageUserAOther = listScope(loginAs(f.actorAEmail()), "?scope=departments&department_id=" + f.deptB().getId());
        assertThat(pageUserAOther.get("totalElements").asLong()).isEqualTo(0);
    }

    @Test
    void keywordSearchFiltersByActorActionOrDetails() throws Exception {
        Fixture f = seed();
        MockHttpSession admin = loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);

        // Search for actor B email
        JsonNode byEmail = listScope(admin, "?scope=company&q=audit-b");
        assertThat(byEmail.get("totalElements").asLong()).isEqualTo(1);
        assertThat(actorEmailsOf(byEmail)).containsOnly(f.actorBEmail());

        // Search for status_changed
        JsonNode byAction = listScope(admin, "?scope=company&q=status_changed");
        assertThat(byAction.get("totalElements").asLong()).isEqualTo(1);

        // Search for document number in details ("SOP-A-0001")
        JsonNode byDocNum = listScope(admin, "?scope=company&q=SOP-A-0001");
        assertThat(byDocNum.get("totalElements").asLong()).isEqualTo(1);
    }

    private JsonNode listScope(MockHttpSession session, String query) throws Exception {
        MvcResult result = mockMvc.perform(get("/audit-log" + query).session(session))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }

    private List<String> actionsOf(JsonNode page) {
        List<String> out = new ArrayList<>();
        page.get("content").forEach(n -> out.add(n.get("entityType").asText() + "/" + n.get("action").asText()));
        return out;
    }

    private List<String> entityTypesOf(JsonNode page) {
        List<String> out = new ArrayList<>();
        page.get("content").forEach(n -> out.add(n.get("entityType").asText()));
        return out;
    }

    private List<String> deptCodesOf(JsonNode page) {
        List<String> out = new ArrayList<>();
        page.get("content").forEach(n -> out.add(n.get("departmentCode").isNull()
                ? null : n.get("departmentCode").asText()));
        return out;
    }

    private List<String> actorEmailsOf(JsonNode page) {
        List<String> out = new ArrayList<>();
        page.get("content").forEach(n -> out.add(n.get("actorEmail").asText()));
        return out;
    }

    private Department tempDepartment(String suffix) {
        Department department = new Department();
        department.setCode("T" + suffix + System.nanoTime() % 100000);
        department.setLabel("Temp " + suffix);
        department.setActive(true);
        return departmentRepository.save(department);
    }

    private Integer createDocument(MockHttpSession session, Department dept, String name)
            throws Exception {
        MvcResult result = mockMvc.perform(multipart("/documents")
                        .param("document_type_id", String.valueOf(sopTypeId()))
                        .param("department_id", String.valueOf(dept.getId()))
                        .param("name", name)
                        .with(csrf())
                        .session(session))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readValue(result.getResponse().getContentAsString(), DocumentDto.class).id();
    }

    private void createType(MockHttpSession adminSession, String prefix) throws Exception {
        Integer tierId = documentTierRepository.findAll().get(0).getId();
        mockMvc.perform(post("/document-types")
                        .with(csrf()).session(adminSession)
                        .contentType("application/json")
                        .content("{\"code\":\"" + prefix + System.nanoTime() % 100000
                                + "\",\"label\":\"Audit query test type\",\"tierId\":" + tierId + "}"))
                .andExpect(status().isCreated());
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

    private void addMembership(String email, Department department) {
        User user = userRepository.findByEmailIgnoreCase(email).orElseThrow();
        UserDepartment membership = new UserDepartment();
        membership.setId(new UserDepartmentId(user.getId(), department.getId()));
        membership.setUser(user);
        membership.setDepartment(department);
        membership.setLevel(MembershipLevel.COLLABORATOR);
        userDepartmentRepository.saveAndFlush(membership);
        user.getDepartments().add(membership);
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
