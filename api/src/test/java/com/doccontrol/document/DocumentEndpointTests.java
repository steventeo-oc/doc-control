package com.doccontrol.document;

import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.audit.AuditLogRepository;
import com.doccontrol.identity.Role;
import com.doccontrol.identity.RoleRepository;
import com.doccontrol.identity.User;
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
    void adminStatusOverrideMakesDocumentPublicAndIsAudited() throws Exception {
        Department dept = tempDepartment("S");
        createUser("soauthor@doccontrol.test", "User");
        createUser("sooutsider@doccontrol.test", "User");
        MockHttpSession authorSession = loginAs("soauthor@doccontrol.test");
        MockHttpSession outsiderSession = loginAs("sooutsider@doccontrol.test");

        Integer documentId = createDocument(authorSession, dept.getId(), "Stopgap Release");

        // outsider cannot see the draft
        mockMvc.perform(get("/documents/" + documentId).session(outsiderSession))
                .andExpect(status().isNotFound());

        // admin overrides status — the Sprint 1 stopgap
        mockMvc.perform(patch("/documents/" + documentId).with(csrf()).session(loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD))
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("status", "released"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("released"));

        // the visibility rule now lets every authenticated user see it
        mockMvc.perform(get("/documents/" + documentId).session(outsiderSession))
                .andExpect(status().isOk());
        mockMvc.perform(get("/documents").session(outsiderSession))
                .andExpect(jsonPath("$.content[?(@.id == " + documentId + ")]").exists());

        assertThat(auditLogRepository.findAll())
                .anyMatch(entry -> {
                    if (!"document".equals(entry.getEntityType())
                            || !"status_changed".equals(entry.getAction())
                            || entry.getDetails() == null) {
                        return false;
                    }
                    Map<?, ?> before = (Map<?, ?>) entry.getDetails().get("before");
                    Map<?, ?> after = (Map<?, ?>) entry.getDetails().get("after");
                    return before != null && after != null
                            && "draft".equals(before.get("status"))
                            && "released".equals(after.get("status"))
                            && before.containsKey("current_version_id");
                });
    }

    @Test
    void onlyAdminsCanChangeStatus() throws Exception {
        Department dept = tempDepartment("N");
        createUser("ownera@doccontrol.test", "User");
        createUser("outsidern@doccontrol.test", "User");
        MockHttpSession ownerSession = loginAs("ownera@doccontrol.test");
        MockHttpSession outsiderSession = loginAs("outsidern@doccontrol.test");

        Integer documentId = createDocument(ownerSession, dept.getId(), "Owner Only");

        // even the owner is rejected when sending status — explicitly, not silently
        mockMvc.perform(patch("/documents/" + documentId).with(csrf()).session(ownerSession)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("status", "released"))))
                .andExpect(status().isForbidden());

        // the owner can still patch ordinary metadata
        mockMvc.perform(patch("/documents/" + documentId).with(csrf()).session(ownerSession)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("name", "Owner Renamed"))))
                .andExpect(status().isOk());

        // a non-admin who can merely see the document (released) is rejected too
        Document document = documentRepository.findById(documentId).orElseThrow();
        document.setStatus(DocumentStatus.RELEASED);
        entityManager.flush();

        mockMvc.perform(patch("/documents/" + documentId).with(csrf()).session(outsiderSession)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("status", "obsolete"))))
                .andExpect(status().isForbidden());
    }

    @Test
    void invalidStatusValueIsRejected() throws Exception {
        Department dept = tempDepartment("I");
        createUser("invalid@doccontrol.test", "User");
        MockHttpSession session = loginAs("invalid@doccontrol.test");
        Integer documentId = createDocument(session, dept.getId(), "Bad Status");

        mockMvc.perform(patch("/documents/" + documentId).with(csrf()).session(loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD))
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("status", "bogus"))))
                .andExpect(status().isBadRequest());
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
        userDepartmentRepository.save(departmentMembership);

        for (String roleName : roleNames) {
            Role role = roleRepository.findByName(roleName).orElseThrow();
            UserRole membership = new UserRole();
            membership.setId(new UserRoleId(user.getId(), role.getId()));
            membership.setUser(user);
            membership.setRole(role);
            userRoleRepository.save(membership);
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
