package com.doccontrol.document;

import com.doccontrol.audit.AuditLogRepository;
import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.identity.Role;
import com.doccontrol.identity.RoleRepository;
import com.doccontrol.identity.User;
import com.doccontrol.identity.UserRepository;
import com.doccontrol.identity.UserRole;
import com.doccontrol.identity.UserRoleId;
import com.doccontrol.identity.UserRoleRepository;
import com.doccontrol.lookup.Department;
import com.doccontrol.lookup.DepartmentRepository;
import com.doccontrol.lookup.DocumentTypeRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Version lifecycle against live Postgres AND live MinIO (localhost:9000 —
 * see api/README.md for running it). Real files go in and come back out;
 * each DB test rolls back (uploaded MinIO objects do not — dev only).
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class DocumentVersionEndpointTests {

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
    RoleRepository roleRepository;

    @Autowired
    DepartmentRepository departmentRepository;

    @Autowired
    DocumentTypeRepository documentTypeRepository;

    @Autowired
    AuditLogRepository auditLogRepository;

    @Autowired
    DocumentRepository documentRepository;

    @Test
    void uploadTwoVersionsListAndDownloadRoundtrip() throws Exception {
        Department dept = tempDepartment("V");
        createUser("vers@doccontrol.test", "User");
        MockHttpSession session = loginAs("vers@doccontrol.test");
        Integer docId = createDocument(session, dept.getId(), "Versioned Doc");

        MvcResult v1 = mockMvc.perform(multipart("/documents/{id}/versions", docId)
                        .file(new MockMultipartFile("file", "procedure.txt", "text/plain", "hello v1".getBytes()))
                        .param("change_notes", "initial upload")
                        .session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.versionNumber").value(1))
                .andExpect(jsonPath("$.status").value("draft"))
                .andExpect(jsonPath("$.fileName").value("procedure.txt"))
                .andReturn();
        Integer v1Id = objectMapper.readValue(v1.getResponse().getContentAsString(), DocumentVersionDto.class).id();

        mockMvc.perform(multipart("/documents/{id}/versions", docId)
                        .file(new MockMultipartFile("file", "procedure.txt", "text/plain", "hello v2".getBytes()))
                        .param("change_notes", "second revision")
                        .session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.versionNumber").value(2));

        // "current" tracks the latest uploaded version
        mockMvc.perform(get("/documents/{id}", docId).session(session))
                .andExpect(jsonPath("$.currentVersionId").isNotEmpty());

        mockMvc.perform(get("/documents/{id}/versions", docId).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].versionNumber").value(1))
                .andExpect(jsonPath("$[1].changeNotes").value("second revision"));

        // download round-trip: the exact bytes of version 1 come back
        byte[] downloaded = mockMvc.perform(get("/documents/{id}/versions/{versionId}/download", docId, v1Id).session(session))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION, containsString("procedure.txt")))
                .andReturn().getResponse().getContentAsByteArray();
        assertThat(new String(downloaded)).isEqualTo("hello v1");

        assertThat(auditLogRepository.findAll())
                .anyMatch(entry -> "document_version".equals(entry.getEntityType())
                        && "created".equals(entry.getAction()));
    }

    @Test
    void createWithFileMakesVersionOneImmediately() throws Exception {
        Department dept = tempDepartment("W");
        createUser("withfile@doccontrol.test", "User");
        MockHttpSession session = loginAs("withfile@doccontrol.test");

        MvcResult created = mockMvc.perform(multipart("/documents")
                        .file(new MockMultipartFile("file", "spec.txt", "text/plain", "spec body".getBytes()))
                        .param("document_type_id", String.valueOf(sopTypeId()))
                        .param("department_id", String.valueOf(dept.getId()))
                        .param("name", "Created With File")
                        .session(session))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.currentVersionId").isNotEmpty())
                .andReturn();
        DocumentDto document = objectMapper.readValue(created.getResponse().getContentAsString(), DocumentDto.class);

        mockMvc.perform(get("/documents/{id}", document.id()).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentVersionId").isNotEmpty());

        mockMvc.perform(get("/documents/{id}/versions", document.id()).session(session))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].versionNumber").value(1));
    }

    @Test
    void hiddenDraftsVersionsAreInvisibleToOthers() throws Exception {
        Department dept = tempDepartment("X");
        createUser("hider@doccontrol.test", "User");
        createUser("peeker@doccontrol.test", "User");
        MockHttpSession hider = loginAs("hider@doccontrol.test");
        MockHttpSession peeker = loginAs("peeker@doccontrol.test");

        Integer docId = createDocument(hider, dept.getId(), "Hidden Draft");
        MvcResult v1 = mockMvc.perform(multipart("/documents/{id}/versions", docId)
                        .file(new MockMultipartFile("file", "hidden.txt", "text/plain", "secret".getBytes()))
                        .session(hider))
                .andExpect(status().isOk())
                .andReturn();
        Integer v1Id = objectMapper.readValue(v1.getResponse().getContentAsString(), DocumentVersionDto.class).id();

        mockMvc.perform(get("/documents/{id}/versions", docId).session(peeker))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/documents/{id}/versions/{versionId}/download", docId, v1Id).session(peeker))
                .andExpect(status().isNotFound());
    }

    @Test
    void visibleButNotYoursUploadIsForbidden() throws Exception {
        Department dept = tempDepartment("Y");
        createUser("relowner@doccontrol.test", "User");
        createUser("reloutsider@doccontrol.test", "User");
        MockHttpSession ownerSession = loginAs("relowner@doccontrol.test");
        MockHttpSession outsiderSession = loginAs("reloutsider@doccontrol.test");

        Integer docId = createDocument(ownerSession, dept.getId(), "Released Doc");
        Document document = documentRepository.findById(docId).orElseThrow();
        document.setStatus(DocumentStatus.RELEASED);
        entityManager.flush();

        // outsider can see the released document, but may not upload to it
        mockMvc.perform(get("/documents/{id}", docId).session(outsiderSession))
                .andExpect(status().isOk());
        mockMvc.perform(multipart("/documents/{id}/versions", docId)
                        .file(new MockMultipartFile("file", "nope.txt", "text/plain", "nope".getBytes()))
                        .session(outsiderSession))
                .andExpect(status().isForbidden());
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
                        .param("name", name))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readValue(result.getResponse().getContentAsString(), DocumentDto.class).id();
    }

    private String createUser(String email, String... roleNames) {
        User user = new User();
        user.setName(email);
        user.setEmail(email);
        user.setDepartment(departmentRepository.findByCode("QA").orElseThrow());
        user.setPasswordHash(passwordEncoder.encode("pw-" + email));
        user.setActive(true);
        userRepository.save(user);

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
        MvcResult result = mockMvc.perform(post("/auth/login")
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
