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

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;

import org.hamcrest.Matchers;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
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

        // uploads never move the public version pointer — it stays null
        // until an explicit release
        mockMvc.perform(get("/documents/{id}", docId).session(session))
                .andExpect(jsonPath("$.currentVersionId").value(Matchers.nullValue()));

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
                // the pointer stays null until an explicit release
                .andExpect(jsonPath("$.currentVersionId").value(Matchers.nullValue()))
                .andReturn();
        DocumentDto document = objectMapper.readValue(created.getResponse().getContentAsString(), DocumentDto.class);

        mockMvc.perform(get("/documents/{id}/versions", document.id()).session(session))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].versionNumber").value(1));

        // releasing is what makes version 1 current
        mockMvc.perform(patch("/documents/{id}", document.id()).session(loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD))
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("status", "released"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentVersionId").isNotEmpty());
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

    @Test
    void releasedVersionStaysCurrentUntilExplicitReRelease() throws Exception {
        // the pilot finding: uploading a draft to a released document must
        // not drag the public version pointer to unreviewed content
        Department dept = tempDepartment("R");
        createUser("relowner@doccontrol.test", "User");
        createUser("relviewer@doccontrol.test", "User");
        MockHttpSession ownerSession = loginAs("relowner@doccontrol.test");
        MockHttpSession viewerSession = loginAs("relviewer@doccontrol.test");
        MockHttpSession adminSession = loginAs(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);

        // create with file (version 1)
        MvcResult created = mockMvc.perform(multipart("/documents")
                        .file(new MockMultipartFile("file", "doc.txt", "text/plain", "v1 body".getBytes()))
                        .param("document_type_id", String.valueOf(sopTypeId()))
                        .param("department_id", String.valueOf(dept.getId()))
                        .param("name", "Public Doc")
                        .session(ownerSession))
                .andExpect(status().isCreated())
                .andReturn();
        DocumentDto doc = objectMapper.readValue(created.getResponse().getContentAsString(), DocumentDto.class);
        DocumentVersionDto[] versions = objectMapper.readValue(
                mockMvc.perform(get("/documents/{id}/versions", doc.id()).session(ownerSession))
                        .andExpect(status().isOk())
                        .andReturn().getResponse().getContentAsString(),
                DocumentVersionDto[].class);
        Integer v1Id = versions[0].id();

        // release it — v1 becomes the current version
        mockMvc.perform(patch("/documents/" + doc.id()).session(adminSession)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("status", "released"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentVersionId").value(v1Id));
        mockMvc.perform(get("/documents/{id}/versions", doc.id()).session(ownerSession))
                .andExpect(jsonPath("$[0].status").value("current"));

        // upload v2 as a draft — the pointer must NOT move
        MvcResult v2 = mockMvc.perform(multipart("/documents/{id}/versions", doc.id())
                        .file(new MockMultipartFile("file", "doc.txt", "text/plain", "v2 body".getBytes()))
                        .param("change_notes", "draft revision")
                        .session(ownerSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.versionNumber").value(2))
                .andReturn();
        Integer v2Id = objectMapper.readValue(v2.getResponse().getContentAsString(), DocumentVersionDto.class).id();

        // the draft upload changed no statuses: v1 stays current, v2 stays draft
        mockMvc.perform(get("/documents/{id}/versions", doc.id()).session(ownerSession))
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].status").value("current"))
                .andExpect(jsonPath("$[1].status").value("draft"));

        // the normal user still sees v1 as the current version, and its content
        mockMvc.perform(get("/documents/{id}", doc.id()).session(viewerSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("released"))
                .andExpect(jsonPath("$.currentVersionId").value(v1Id));
        byte[] v1Body = mockMvc.perform(
                        get("/documents/{id}/versions/{versionId}/download", doc.id(), v1Id).session(viewerSession))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();
        assertThat(new String(v1Body)).isEqualTo("v1 body");

        // version history beyond the current version is owner/admin-only:
        // the viewer's list shows exactly the current version, and the draft
        // 404s on detail and download (existence not leaked)
        mockMvc.perform(get("/documents/{id}/versions", doc.id()).session(viewerSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(v1Id));
        mockMvc.perform(get("/documents/{id}/versions/{versionId}", doc.id(), v2Id).session(viewerSession))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        get("/documents/{id}/versions/{versionId}/download", doc.id(), v2Id).session(viewerSession))
                .andExpect(status().isNotFound());

        // owner and admin keep the full history
        mockMvc.perform(get("/documents/{id}/versions", doc.id()).session(ownerSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));
        mockMvc.perform(get("/documents/{id}/versions", doc.id()).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));

        // admin re-releases (status already released) — now the draft publishes:
        // v2 becomes current, v1 becomes superseded
        mockMvc.perform(patch("/documents/" + doc.id()).session(adminSession)
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of("status", "released"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentVersionId").value(v2Id));
        mockMvc.perform(get("/documents/{id}/versions", doc.id()).session(ownerSession))
                .andExpect(jsonPath("$[0].status").value("superseded"))
                .andExpect(jsonPath("$[1].status").value("current"));

        // the normal user now sees v2 as current, with its content
        mockMvc.perform(get("/documents/{id}", doc.id()).session(viewerSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentVersionId").value(v2Id));
        byte[] v2Body = mockMvc.perform(
                        get("/documents/{id}/versions/{versionId}/download", doc.id(), v2Id).session(viewerSession))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();
        assertThat(new String(v2Body)).isEqualTo("v2 body");

        // and their version list now shows exactly v2
        mockMvc.perform(get("/documents/{id}/versions", doc.id()).session(viewerSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(v2Id));

        // the pointer move is audited
        assertThat(auditLogRepository.findAll())
                .anyMatch(entry -> "document".equals(entry.getEntityType())
                        && "updated".equals(entry.getAction())
                        && entry.getDetails() != null
                        && Map.of("current_version_id", v1Id).equals(entry.getDetails().get("before"))
                        && Map.of("current_version_id", v2Id).equals(entry.getDetails().get("after")));
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
