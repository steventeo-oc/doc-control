package com.doccontrol.document;

import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.audit.AuditLogRepository;
import com.doccontrol.identity.Role;
import com.doccontrol.identity.RoleRepository;
import com.doccontrol.identity.User;
import com.doccontrol.identity.UserDepartment;
import com.doccontrol.identity.UserDepartmentId;
import com.doccontrol.identity.UserDepartment;
import com.doccontrol.identity.UserDepartmentId;
import com.doccontrol.identity.UserDepartmentRepository;
import com.doccontrol.identity.UserRepository;
import com.doccontrol.identity.UserRole;
import com.doccontrol.identity.UserRoleId;
import com.doccontrol.identity.UserRoleRepository;
import com.doccontrol.lookup.Department;
import com.doccontrol.lookup.DepartmentRepository;
import com.doccontrol.lookup.DocumentTypeRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import com.doccontrol.CsrfTestSupport;
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

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static com.doccontrol.CsrfTestSupport.csrf;

/**
 * Document CRUD against the live database: server-generated numbers, the
 * provisional visibility rule, soft delete/restore, filters. Uses the real
 * login flow; each test rolls back.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(CsrfTestSupport.class)
@Transactional
class DocumentEndpointTests {

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
    UserDepartmentRepository userDepartmentRepository;

    @Autowired
    UserRoleRepository userRoleRepository;

    @Autowired
    RoleRepository roleRepository;

    @Autowired
    DepartmentRepository departmentRepository;

    @Autowired
    DocumentTypeRepository documentTypeRepository;

    @Autowired
    DocumentRepository documentRepository;

    @Autowired
    AuditLogRepository auditLogRepository;

    @Test
    void createGeneratesDocumentNumberFromCounter() throws Exception {
        Department dept = tempDepartment("D1");
        MockHttpSession session = loginAs(createUser("creator@doccontrol.test", "User"));
        addMembership("creator@doccontrol.test", dept);

        mockMvc.perform(multipart("/documents").session(session)
                        .param("document_type_id", String.valueOf(sopTypeId()))
                        .param("department_id", String.valueOf(dept.getId()))
                        .param("name", "Incoming Inspection Procedure").with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.documentNumber").value("SOP-" + dept.getCode() + "-0001"))
                .andExpect(jsonPath("$.status").value("draft"))
                .andExpect(jsonPath("$.sequenceNumber").value(1))
                .andExpect(jsonPath("$.currentVersionId").doesNotExist());

        mockMvc.perform(multipart("/documents").session(session)
                        .param("document_type_id", String.valueOf(sopTypeId()))
                        .param("department_id", String.valueOf(dept.getId()))
                        .param("name", "Second Document").with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.documentNumber").value("SOP-" + dept.getCode() + "-0002"));
    }

    @Test
    void draftIsHiddenFromOtherUsersUntilReleased() throws Exception {
        Department dept = tempDepartment("D2");
        createUser("author@doccontrol.test", "User");
        addMembership("author@doccontrol.test", dept);
        createUser("outsider@doccontrol.test", "User");
        MockHttpSession authorSession = loginAs("author@doccontrol.test");
        MockHttpSession outsiderSession = loginAs("outsider@doccontrol.test");

        MvcResult created = mockMvc.perform(multipart("/documents").session(authorSession)
                        .param("document_type_id", String.valueOf(sopTypeId()))
                        .param("department_id", String.valueOf(dept.getId()))
                        .param("name", "Secret Draft").with(csrf()))
                .andExpect(status().isCreated())
                .andReturn();
        Integer documentId = objectMapper.readValue(created.getResponse().getContentAsString(), DocumentDto.class).id();

        // other users cannot see the draft — 404, not 403, so existence isn't leaked
        mockMvc.perform(get("/documents/" + documentId).session(outsiderSession))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/documents").session(outsiderSession))
                .andExpect(jsonPath("$.content[?(@.id == " + documentId + ")]").doesNotExist());

        // the author and an admin can see it
        mockMvc.perform(get("/documents/" + documentId).session(authorSession))
                .andExpect(status().isOk());
        mockMvc.perform(get("/documents").session(loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD)))
                .andExpect(jsonPath("$.content[?(@.id == " + documentId + ")]").exists());

        // once released it becomes public to all authenticated users
        Document document = documentRepository.findById(documentId).orElseThrow();
        document.setStatus(DocumentStatus.RELEASED);
        entityManager.flush();

        mockMvc.perform(get("/documents/" + documentId).session(outsiderSession))
                .andExpect(status().isOk());
        mockMvc.perform(get("/documents").session(outsiderSession))
                .andExpect(jsonPath("$.content[?(@.id == " + documentId + ")]").exists());
    }

    @Test
    void onlyOwnerOrAdminCanModify() throws Exception {
        Department dept = tempDepartment("D3");
        createUser("modauthor@doccontrol.test", "User");
        addMembership("modauthor@doccontrol.test", dept);
        createUser("modoutsider@doccontrol.test", "User");
        MockHttpSession authorSession = loginAs("modauthor@doccontrol.test");
        MockHttpSession outsiderSession = loginAs("modoutsider@doccontrol.test");

        Integer documentId = createDocument(authorSession, dept.getId(), "Editable Doc");

        // outsider cannot even see the draft → 404 on patch
        mockMvc.perform(patch("/documents/" + documentId).with(csrf()).session(outsiderSession)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("name", "Hacked"))))
                .andExpect(status().isNotFound());

        // admin can patch
        mockMvc.perform(patch("/documents/" + documentId).with(csrf()).session(loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD))
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("name", "Renamed By Admin"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Renamed By Admin"));

        // released documents are visible to everyone but still only
        // owner/admin-editable → visible outsider gets 403, not 404
        Document document = documentRepository.findById(documentId).orElseThrow();
        document.setStatus(DocumentStatus.RELEASED);
        entityManager.flush();

        mockMvc.perform(patch("/documents/" + documentId).with(csrf()).session(outsiderSession)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("name", "Still Nope"))))
                .andExpect(status().isForbidden());
    }

    @Test
    void softDeleteHidesAndRestoreBringsBack() throws Exception {
        Department dept = tempDepartment("D4");
        createUser("deleter@doccontrol.test", "User");
        addMembership("deleter@doccontrol.test", dept);
        MockHttpSession session = loginAs("deleter@doccontrol.test");

        Integer documentId = createDocument(session, dept.getId(), "Trash Me");

        mockMvc.perform(delete("/documents/" + documentId).with(csrf()).session(session))
                .andExpect(status().isNoContent());

        // excluded from the default list, but still addressable in detail (trash)
        mockMvc.perform(get("/documents").session(session))
                .andExpect(jsonPath("$.content[?(@.id == " + documentId + ")]").doesNotExist());
        mockMvc.perform(get("/documents/" + documentId).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deletedAt").isNotEmpty());

        mockMvc.perform(post("/documents/" + documentId + "/restore").with(csrf()).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deletedAt").doesNotExist());

        mockMvc.perform(get("/documents").session(session))
                .andExpect(jsonPath("$.content[?(@.id == " + documentId + ")]").exists());
    }

    @Test
    void listFiltersWork() throws Exception {
        Department deptA = tempDepartment("A");
        Department deptB = tempDepartment("B");
        createUser("filter@doccontrol.test", "User");
        addMembership("filter@doccontrol.test", deptA);
        addMembership("filter@doccontrol.test", deptB);
        MockHttpSession session = loginAs("filter@doccontrol.test");

        Integer inSop = createDocument(session, deptA.getId(), "Quarterly Review Checklist");
        Integer inWi = createDocument(session, deptB.getId(), "Assembly Walkthrough");

        // department filter
        mockMvc.perform(get("/documents").session(session).param("department", deptA.getCode()))
                .andExpect(jsonPath("$.content[0].id").value(inSop))
                .andExpect(jsonPath("$.totalElements").value(1));

        // q filter matches on name (case-insensitive)
        mockMvc.perform(get("/documents").session(session).param("q", "walkthrough"))
                .andExpect(jsonPath("$.content[0].id").value(inWi))
                .andExpect(jsonPath("$.totalElements").value(1));

        // status filter on a released document
        Document released = documentRepository.findById(inSop).orElseThrow();
        released.setStatus(DocumentStatus.RELEASED);
        entityManager.flush();

        mockMvc.perform(get("/documents").session(session)
                        .param("status", "released").param("department", deptA.getCode()))
                .andExpect(jsonPath("$.content[0].id").value(inSop))
                .andExpect(jsonPath("$.totalElements").value(1));

        // invalid status value → 400
        mockMvc.perform(get("/documents").session(session).param("status", "bogus"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void nonMembersCannotCreateInADepartmentAndAdminsRemainUnrestricted() throws Exception {
        Department dept = tempDepartment("P");
        createUser("pmember@doccontrol.test", "User");
        createUser("poutsider@doccontrol.test", "User");
        addMembership("pmember@doccontrol.test", dept);
        MockHttpSession member = loginAs("pmember@doccontrol.test");
        MockHttpSession outsider = loginAs("poutsider@doccontrol.test");

        // non-member cannot create in the department
        mockMvc.perform(multipart("/documents").session(outsider)
                        .param("document_type_id", String.valueOf(sopTypeId()))
                        .param("department_id", String.valueOf(dept.getId()))
                        .param("name", "Not Allowed"))
                .andExpect(status().isForbidden());

        // member can
        Integer documentId = createDocument(member, dept.getId(), "Member Doc");

        // a released document is visible to the non-member, but still not editable
        Document document = documentRepository.findById(documentId).orElseThrow();
        document.setStatus(DocumentStatus.RELEASED);
        entityManager.flush();
        mockMvc.perform(get("/documents/" + documentId).session(outsider))
                .andExpect(status().isOk());
        mockMvc.perform(patch("/documents/" + documentId).with(csrf()).session(outsider)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("name", "Nope"))))
                .andExpect(status().isForbidden());

        // admins remain unrestricted
        mockMvc.perform(multipart("/documents").with(csrf()).session(loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD))
                        .param("document_type_id", String.valueOf(sopTypeId()))
                        .param("department_id", String.valueOf(dept.getId()))
                        .param("name", "Admin Created"))
                .andExpect(status().isCreated());
    }

    @Test
    void multiDepartmentMemberCanEditInBothAndOwnershipTransferIsDepartmentScoped() throws Exception {
        Department deptA = tempDepartment("MA");
        Department deptB = tempDepartment("MB");
        createUser("dual@doccontrol.test", "User");
        createUser("memberb@doccontrol.test", "User");
        createUser("membera@doccontrol.test", "User");
        addMembership("dual@doccontrol.test", deptA);
        addMembership("dual@doccontrol.test", deptB);
        addMembership("memberb@doccontrol.test", deptB);
        addMembership("membera@doccontrol.test", deptA);
        MockHttpSession dual = loginAs("dual@doccontrol.test");

        Integer docA = createDocument(dual, deptA.getId(), "In A");
        Integer docB = createDocument(dual, deptB.getId(), "In B");

        // a member of both departments can edit in both
        mockMvc.perform(patch("/documents/" + docA).with(csrf()).session(dual)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("name", "A Renamed"))))
                .andExpect(status().isOk());
        mockMvc.perform(patch("/documents/" + docB).with(csrf()).session(dual)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("name", "B Renamed"))))
                .andExpect(status().isOk());

        // ownership transfer to a non-member of the document's department is rejected
        Integer memberBId = userRepository.findByEmailIgnoreCase("memberb@doccontrol.test").orElseThrow().getId();
        mockMvc.perform(patch("/documents/" + docA).with(csrf()).session(dual)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("ownerUserId", memberBId))))
                .andExpect(status().isForbidden());

        // transfer to a department member succeeds
        Integer memberAId = userRepository.findByEmailIgnoreCase("membera@doccontrol.test").orElseThrow().getId();
        mockMvc.perform(patch("/documents/" + docA).with(csrf()).session(dual)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("ownerUserId", memberAId))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ownerUserId").value(memberAId));
    }

    private void addMembership(String email, Department department) {
        User user = userRepository.findByEmailIgnoreCase(email).orElseThrow();
        UserDepartment membership = new UserDepartment();
        membership.setId(new UserDepartmentId(user.getId(), department.getId()));
        membership.setUser(user);
        membership.setDepartment(department);
        userDepartmentRepository.saveAndFlush(membership);
    }

    private Integer sopTypeId() {
        return documentTypeRepository.findAll().stream()
                .filter(type -> "SOP".equals(type.getCode()))
                .findFirst().orElseThrow()
                .getId();
    }

    private Department tempDepartment(String suffix) {
        Department department = new Department();
        department.setCode("T" + suffix + System.nanoTime() % 100000);
        department.setLabel("Temp " + suffix);
        department.setActive(true);
        return departmentRepository.save(department);
    }

    private Integer createDocument(MockHttpSession session, Integer departmentId, String name) throws Exception {
        MvcResult result = mockMvc.perform(multipart("/documents").session(session)
                        .param("document_type_id", String.valueOf(sopTypeId()))
                        .param("department_id", String.valueOf(departmentId))
                        .param("name", name).with(csrf()))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readValue(result.getResponse().getContentAsString(), DocumentDto.class).id();
    }

    private String createUser(String email, String... roleNames) {
        User user = new User();
        user.setName(email);
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode("pw-" + email));
        user.setActive(true);
        userRepository.save(user);

        com.doccontrol.lookup.Department qa = departmentRepository.findByCode("QA").orElseThrow();
        UserDepartment departmentMembership = new UserDepartment();
        departmentMembership.setId(new UserDepartmentId(user.getId(), qa.getId()));
        departmentMembership.setUser(user);
        departmentMembership.setDepartment(qa);
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
