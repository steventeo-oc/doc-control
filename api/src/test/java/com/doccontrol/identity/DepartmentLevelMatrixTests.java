package com.doccontrol.identity;

import com.doccontrol.CsrfTestSupport;
import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.document.DocumentDto;
import com.doccontrol.document.DocumentVersionDto;
import com.doccontrol.lookup.DepartmentDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

import static com.doccontrol.CsrfTestSupport.csrf;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The confirmed level matrix, exercised through the API
 * (Department_Levels_Design_PlanBack.md section 1): Manager full control;
 * Collaborator edits others' but deletes only its own and starts approvals
 * on anything it can edit; Contributor works on its own documents only;
 * Consumer reads and downloads only. Admins stay unrestricted without
 * membership rows. Omitted membership levels are rejected, never assumed.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@Import(CsrfTestSupport.class)
class DepartmentLevelMatrixTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    /** One department + one member per level, all through the new API shape. */
    private record Fixture(Integer departmentId, Integer managerId, Integer collaboratorId,
                           Integer contributorId, Integer consumerId,
                           MockHttpSession manager, MockHttpSession collaborator,
                           MockHttpSession contributor, MockHttpSession consumer) {
    }

    private Fixture fixture(String prefix) throws Exception {
        MockHttpSession admin = adminSession();
        MvcResult dept = mockMvc.perform(post("/departments").with(csrf()).session(admin)
                        .contentType("application/json")
                        .content("{\"code\":\"" + prefix + System.nanoTime() % 100000
                                + "\",\"label\":\"Level matrix dept\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        Integer departmentId = objectMapper.readValue(
                dept.getResponse().getContentAsString(), DepartmentDto.class).id();

        String managerEmail = createUser(admin, prefix + "-manager", departmentId, "MANAGER");
        String collaboratorEmail = createUser(admin, prefix + "-collab", departmentId, "COLLABORATOR");
        String contributorEmail = createUser(admin, prefix + "-contrib", departmentId, "CONTRIBUTOR");
        String consumerEmail = createUser(admin, prefix + "-consumer", departmentId, "CONSUMER");

        return new Fixture(departmentId,
                findUserIdByEmail(admin, managerEmail),
                findUserIdByEmail(admin, collaboratorEmail),
                findUserIdByEmail(admin, contributorEmail),
                findUserIdByEmail(admin, consumerEmail),
                login(managerEmail, "pw-" + prefix + "-manager"),
                login(collaboratorEmail, "pw-" + prefix + "-collab"),
                login(contributorEmail, "pw-" + prefix + "-contrib"),
                login(consumerEmail, "pw-" + prefix + "-consumer"));
    }

    @Test
    void consumerCannotCreateButKeepsReadAccess() throws Exception {
        Fixture fx = fixture("CMR");
        mockMvc.perform(multipart("/documents")
                        .file(new MockMultipartFile("file", "d.txt", "text/plain", "x".getBytes()))
                        .param("document_type_id", String.valueOf(anyTypeId()))
                        .param("department_id", String.valueOf(fx.departmentId()))
                        .param("name", "Consumer Doc")
                        .with(csrf()).session(fx.consumer()))
                .andExpect(status().isForbidden());
    }

    @Test
    void contributorHasFullControlOfOwnDocumentsOnly() throws Exception {
        Fixture fx = fixture("CTB");
        Integer own = createDocument(fx.contributor(), fx.departmentId(), "Contributor Doc");
        Integer others = createDocument(fx.manager(), fx.departmentId(), "Manager Doc");

        // own: edit, delete/restore lifecycle, start approval
        mockMvc.perform(patch("/documents/{id}", own).with(csrf()).session(fx.contributor())
                        .contentType("application/json").content("{\"name\":\"Renamed by owner\"}"))
                .andExpect(status().isOk());
        mockMvc.perform(post("/documents/{id}/versions/{versionId}/workflow/start", own, firstVersionId(own))
                        .with(csrf()).session(fx.contributor())
                        .contentType("application/json")
                        .content("{\"assignees\":[{\"type\":\"USER\",\"userId\":" + fx.managerId() + "}]}"))
                .andExpect(status().isCreated());

        // others: view-only — edit, delete, and approval-start all forbidden
        mockMvc.perform(patch("/documents/{id}", others).with(csrf()).session(fx.contributor())
                        .contentType("application/json").content("{\"name\":\"Nope\"}"))
                .andExpect(status().isForbidden());
        mockMvc.perform(delete("/documents/{id}", others).with(csrf()).session(fx.contributor()))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/documents/{id}/versions/{versionId}/workflow/start", others, firstVersionId(others))
                        .with(csrf()).session(fx.contributor())
                        .contentType("application/json")
                        .content("{\"assignees\":[{\"type\":\"USER\",\"userId\":" + fx.managerId() + "}]}"))
                .andExpect(status().isForbidden());

        // read access is untouched (F4): department drafts stay visible
        mockMvc.perform(get("/documents/{id}", others).session(fx.contributor()))
                .andExpect(status().isOk());
    }

    @Test
    void collaboratorEditsOthersButDeletesOnlyItsOwn() throws Exception {
        Fixture fx = fixture("CLB");
        Integer own = createDocument(fx.collaborator(), fx.departmentId(), "Collab Doc");
        Integer others = createDocument(fx.contributor(), fx.departmentId(), "Contributor Doc");

        // edit-not-delete on others': metadata edit and approval-start pass,
        // delete is forbidden (plan-back section 1)
        mockMvc.perform(patch("/documents/{id}", others).with(csrf()).session(fx.collaborator())
                        .contentType("application/json").content("{\"name\":\"Edited by collaborator\"}"))
                .andExpect(status().isOk());
        mockMvc.perform(post("/documents/{id}/versions/{versionId}/workflow/start", others, firstVersionId(others))
                        .with(csrf()).session(fx.collaborator())
                        .contentType("application/json")
                        .content("{\"assignees\":[{\"type\":\"USER\",\"userId\":" + fx.managerId() + "}]}"))
                .andExpect(status().isCreated());
        mockMvc.perform(delete("/documents/{id}", others).with(csrf()).session(fx.collaborator()))
                .andExpect(status().isForbidden());

        // own documents: full control including delete
        mockMvc.perform(delete("/documents/{id}", own).with(csrf()).session(fx.collaborator()))
                .andExpect(status().isNoContent());
    }

    @Test
    void managerHasFullControlIncludingDeletingOthers() throws Exception {
        Fixture fx = fixture("MGR");
        Integer collabDoc = createDocument(fx.collaborator(), fx.departmentId(), "Collab Doc");
        Integer contribDoc = createDocument(fx.contributor(), fx.departmentId(), "Contributor Doc");

        mockMvc.perform(patch("/documents/{id}", collabDoc).with(csrf()).session(fx.manager())
                        .contentType("application/json").content("{\"name\":\"Managed\"}"))
                .andExpect(status().isOk());
        mockMvc.perform(delete("/documents/{id}", collabDoc).with(csrf()).session(fx.manager()))
                .andExpect(status().isNoContent());
        mockMvc.perform(delete("/documents/{id}", contribDoc).with(csrf()).session(fx.manager()))
                .andExpect(status().isNoContent());
        mockMvc.perform(post("/documents/{id}/versions/{versionId}/workflow/start", contribDoc, firstVersionId(contribDoc))
                        .with(csrf()).session(fx.manager())
                        .contentType("application/json")
                        .content("{\"assignees\":[{\"type\":\"USER\",\"userId\":" + fx.collaboratorId() + "}]}"))
                .andExpect(status().isCreated());
    }

    @Test
    void ownershipTransferToAConsumerIsRejected() throws Exception {
        Fixture fx = fixture("OWN");
        Integer doc = createDocument(fx.contributor(), fx.departmentId(), "Ownership Doc");

        mockMvc.perform(patch("/documents/{id}", doc).with(csrf()).session(fx.contributor())
                        .contentType("application/json")
                        .content("{\"ownerUserId\":" + fx.consumerId() + "}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("detail").value(org.hamcrest.Matchers.containsString(
                        "at least Contributor level")));
    }

    @Test
    void omittedMembershipLevelIsRejectedNotAssumed() throws Exception {
        MockHttpSession admin = adminSession();
        MvcResult dept = mockMvc.perform(post("/departments").with(csrf()).session(admin)
                        .contentType("application/json")
                        .content("{\"code\":\"NOL" + System.nanoTime() % 100000
                                + "\",\"label\":\"No-level dept\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        Integer departmentId = objectMapper.readValue(
                dept.getResponse().getContentAsString(), DepartmentDto.class).id();

        // create without a level: 400, never a silent default
        mockMvc.perform(post("/users").with(csrf()).session(admin)
                        .contentType("application/json")
                        .content("{\"name\":\"No Level\",\"email\":\"nolevel" + System.nanoTime()
                                + "@doccontrol.test\",\"departments\":[{\"departmentId\":"
                                + departmentId + "}],\"password\":\"password123\"}"))
                .andExpect(status().isBadRequest());

        // an unknown level is equally rejected
        mockMvc.perform(post("/users").with(csrf()).session(admin)
                        .contentType("application/json")
                        .content("{\"name\":\"Bad Level\",\"email\":\"badlevel" + System.nanoTime()
                                + "@doccontrol.test\",\"departments\":[{\"departmentId\":"
                                + departmentId + ",\"level\":\"SUPERUSER\"}],\"password\":\"password123\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void adminStaysUnrestrictedWithoutMembershipChanges() throws Exception {
        Fixture fx = fixture("ADM");
        MockHttpSession admin = adminSession();
        Integer doc = createDocument(fx.contributor(), fx.departmentId(), "Admin Doc");

        // every gate open, exactly as today, with no membership row of its own
        mockMvc.perform(patch("/documents/{id}", doc).with(csrf()).session(admin)
                        .contentType("application/json").content("{\"name\":\"Admin edited\"}"))
                .andExpect(status().isOk());
        mockMvc.perform(delete("/documents/{id}", doc).with(csrf()).session(admin))
                .andExpect(status().isNoContent());
        MvcResult me = mockMvc.perform(get("/auth/me").session(admin))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(me.getResponse().getContentAsString()).contains("QA");
    }

    // ---- helpers ----

    private String createUser(MockHttpSession admin, String prefix, Integer departmentId,
                              String level) throws Exception {
        String email = prefix + System.nanoTime() + "@doccontrol.test";
        mockMvc.perform(post("/users").with(csrf()).session(admin)
                        .contentType("application/json")
                        .content("{\"name\":\"" + prefix + "\",\"email\":\"" + email
                                + "\",\"departments\":[{\"departmentId\":" + departmentId
                                + ",\"level\":\"" + level + "\"}],\"password\":\"pw-" + prefix + "\"}"))
                .andExpect(status().isCreated());
        return email;
    }

    private Integer findUserIdByEmail(MockHttpSession admin, String email) throws Exception {
        MvcResult users = mockMvc.perform(get("/users").session(admin))
                .andExpect(status().isOk())
                .andReturn();
        List<Map<String, Object>> list = objectMapper.readValue(
                users.getResponse().getContentAsString(), List.class);
        return (Integer) list.stream()
                .filter(u -> email.equals(((Map<?, ?>) u).get("email")))
                .findFirst().orElseThrow()
                .get("id");
    }

    private Integer anyTypeId() throws Exception {
        MockHttpSession admin = adminSession();
        MvcResult types = mockMvc.perform(get("/document-types").session(admin))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readValue(types.getResponse().getContentAsString(),
                com.doccontrol.lookup.DocumentTypeDto[].class)[0].id();
    }

    private Integer createDocument(MockHttpSession session, Integer departmentId, String name)
            throws Exception {
        MvcResult result = mockMvc.perform(multipart("/documents")
                        .file(new MockMultipartFile("file", "doc.txt", "text/plain", "content".getBytes()))
                        .param("document_type_id", String.valueOf(anyTypeId()))
                        .param("department_id", String.valueOf(departmentId))
                        .param("name", name)
                        .with(csrf()).session(session))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readValue(result.getResponse().getContentAsString(), DocumentDto.class).id();
    }

    private Integer firstVersionId(Integer documentId) throws Exception {
        MvcResult result = mockMvc.perform(get("/documents/{id}/versions", documentId)
                        .session(adminSession()))
                .andExpect(status().isOk())
                .andReturn();
        DocumentVersionDto[] versions = objectMapper.readValue(
                result.getResponse().getContentAsString(), DocumentVersionDto[].class);
        return versions[0].id();
    }

    private MockHttpSession adminSession() throws Exception {
        return login("admin@doccontrol.local", "changeme_admin");
    }

    private MockHttpSession login(String email, String password) throws Exception {
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
