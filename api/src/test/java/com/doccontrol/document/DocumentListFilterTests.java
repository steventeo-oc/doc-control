package com.doccontrol.document;

import com.doccontrol.CsrfTestSupport;
import com.doccontrol.auth.dto.LoginRequest;
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

import static com.doccontrol.CsrfTestSupport.csrf;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The documents-list additions for the navigation restructure (plan-back
 * F2): `trashed=true` lists soft-deleted documents the caller can manage
 * (Manager: the department's; Collaborator/Contributor: their own; admin:
 * all) — every row restorable via the existing restore endpoint — and
 * `owner=me` filters to the caller's own documents.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@Import(CsrfTestSupport.class)
class DocumentListFilterTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Test
    void trashedListsWhatTheCallerCanManageAndRestoreWorks() throws Exception {
        Fixture fx = new Fixture("TRS");

        Integer collabDoc = fx.createDocument("collaborator", "Collab Trashed");
        Integer managerDoc = fx.createDocument("manager", "Manager Trashed");
        fx.softDelete(collabDoc, "collaborator");
        fx.softDelete(managerDoc, "manager");

        // default list: nothing trashed
        assertThat(fx.listNumbers(null, fx.collaborator)).noneMatch(n -> n.contains("TRS"));

        // the Collaborator sees only their own trashed document
        List<String> collabTrash = fx.listNumbers(true, fx.collaborator);
        assertThat(collabTrash).anyMatch(n -> n.endsWith("Collab Trashed"));
        assertThat(collabTrash).noneMatch(n -> n.contains("Manager Trashed"));

        // the Manager sees both (MANAGER in the department)
        List<String> managerTrash = fx.listNumbers(true, fx.manager);
        assertThat(managerTrash).anyMatch(n -> n.contains("Collab Trashed"));
        assertThat(managerTrash).anyMatch(n -> n.contains("Manager Trashed"));

        // the admin sees all trashed
        assertThat(fx.listNumbers(true, fx.admin)).hasSize(2);

        // restore round-trip via the existing endpoint
        mockMvc.perform(post("/documents/{id}/restore", collabDoc).with(csrf()).session(fx.collaborator))
                .andExpect(status().isOk());
        assertThat(fx.listNumbers(true, fx.manager)).noneMatch(n -> n.contains("Collab Trashed"));
        assertThat(fx.listNumbers(null, fx.collaborator)).anyMatch(n -> n.contains("Collab Trashed"));
    }

    @Test
    void ownerMeFiltersToTheCallersOwnDocuments() throws Exception {
        Fixture fx = new Fixture("OWN");

        fx.createDocument("collaborator", "Collab Live");
        fx.createDocument("manager", "Manager Live");

        List<String> mine = fx.listNumbers(null, fx.collaborator, "me");
        assertThat(mine).anyMatch(n -> n.contains("Collab Live"));
        assertThat(mine).noneMatch(n -> n.contains("Manager Live"));

        // the manager's own view
        assertThat(fx.listNumbers(null, fx.manager, "me")).anyMatch(n -> n.contains("Manager Live"));
    }

    @Test
    void qSearchesBothNameAndDocumentNumber() throws Exception {
        Fixture fx = new Fixture("SRC");

        Integer docId = fx.createDocument("collaborator", "Unique Title Calibration Guide");
        MvcResult docRes = mockMvc.perform(get("/documents/{id}", docId).session(fx.admin))
                .andExpect(status().isOk())
                .andReturn();
        String docNumber = objectMapper.readTree(docRes.getResponse().getContentAsString())
                .path("documentNumber").asText();

        // 1. Search by unique title keyword
        MvcResult titleMatch = mockMvc.perform(get("/documents")
                        .queryParam("q", "Calibration")
                        .session(fx.admin))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(titleMatch.getResponse().getContentAsString()).contains(docNumber);

        // 2. Search by document number (e.g. SOP-SRC... or exact number)
        MvcResult numberMatch = mockMvc.perform(get("/documents")
                        .queryParam("q", docNumber)
                        .session(fx.admin))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(numberMatch.getResponse().getContentAsString()).contains(docNumber);

        // 3. Search by partial document number prefix
        String prefix = docNumber.substring(0, Math.min(docNumber.length(), 6));
        MvcResult prefixMatch = mockMvc.perform(get("/documents")
                        .queryParam("q", prefix)
                        .session(fx.admin))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(prefixMatch.getResponse().getContentAsString()).contains(docNumber);
    }

    @Test
    void sortingByColumnSupportsAscAndDesc() throws Exception {
        Fixture fx = new Fixture("SRT");
        fx.createDocument("collaborator", "Alpha Doc");
        fx.createDocument("collaborator", "Zulu Doc");

        MvcResult ascResult = mockMvc.perform(get("/documents")
                        .queryParam("sort", "name,asc")
                        .queryParam("page_size", "50")
                        .session(fx.admin))
                .andExpect(status().isOk())
                .andReturn();
        List<String> ascNames = new java.util.ArrayList<>();
        for (var node : objectMapper.readTree(ascResult.getResponse().getContentAsString()).path("content")) {
            ascNames.add(node.path("name").asText());
        }
        int alphaIdx = ascNames.indexOf("Alpha Doc");
        int zuluIdx = ascNames.indexOf("Zulu Doc");
        assertThat(alphaIdx).isLessThan(zuluIdx);

        MvcResult descResult = mockMvc.perform(get("/documents")
                        .queryParam("sort", "name,desc")
                        .queryParam("page_size", "50")
                        .session(fx.admin))
                .andExpect(status().isOk())
                .andReturn();
        List<String> descNames = new java.util.ArrayList<>();
        for (var node : objectMapper.readTree(descResult.getResponse().getContentAsString()).path("content")) {
            descNames.add(node.path("name").asText());
        }
        alphaIdx = descNames.indexOf("Alpha Doc");
        zuluIdx = descNames.indexOf("Zulu Doc");
        assertThat(zuluIdx).isLessThan(alphaIdx);
    }

    // ---- fixture ----

    private class Fixture {
        final String prefix;
        final Integer departmentId;
        final MockHttpSession admin = login("admin@doccontrol.local", "changeme_admin");
        final MockHttpSession manager;
        final MockHttpSession collaborator;

        Fixture(String prefix) throws Exception {
            this.prefix = prefix;
            MvcResult dept = mockMvc.perform(post("/departments").with(csrf()).session(admin)
                            .contentType("application/json")
                            .content("{\"code\":\"" + prefix + System.nanoTime() % 100000
                                    + "\",\"label\":\"Filter test dept\"}"))
                    .andExpect(status().isCreated())
                    .andReturn();
            departmentId = objectMapper.readTree(dept.getResponse().getContentAsString())
                    .path("id").asInt();
            String managerEmail = createUser(prefix + "-manager", "MANAGER");
            String collabEmail = createUser(prefix + "-collab", "COLLABORATOR");
            manager = login(managerEmail, "pw-" + prefix + "-manager");
            collaborator = login(collabEmail, "pw-" + prefix + "-collab");
        }

        String createUser(String name, String level) throws Exception {
            String email = name + System.nanoTime() + "@doccontrol.test";
            mockMvc.perform(post("/users").with(csrf()).session(admin)
                            .contentType("application/json")
                            .content("{\"name\":\"" + name + "\",\"email\":\"" + email
                                    + "\",\"departments\":[{\"departmentId\":" + departmentId
                                    + ",\"level\":\"" + level + "\"}],\"password\":\"pw-" + name + "\"}"))
                    .andExpect(status().isCreated());
            return email;
        }

        Integer createDocument(String owner, String name) throws Exception {
            MockHttpSession session = owner.equals("manager") ? manager : collaborator;
            MvcResult types = mockMvc.perform(get("/document-types").session(admin))
                    .andExpect(status().isOk())
                    .andReturn();
            Integer typeId = objectMapper.readTree(types.getResponse().getContentAsString())
                    .get(0).path("id").asInt();
            MvcResult result = mockMvc.perform(multipart("/documents")
                            .file(new MockMultipartFile("file", "doc.txt", "text/plain", "content".getBytes()))
                            .param("document_type_id", String.valueOf(typeId))
                            .param("department_id", String.valueOf(departmentId))
                            .param("name", prefix + " " + name)
                            .with(csrf()).session(session))
                    .andExpect(status().isCreated())
                    .andReturn();
            return objectMapper.readTree(result.getResponse().getContentAsString()).path("id").asInt();
        }

        void softDelete(Integer documentId, String owner) throws Exception {
            MockHttpSession session = owner.equals("manager") ? manager : collaborator;
            mockMvc.perform(delete("/documents/{id}", documentId).with(csrf()).session(session))
                    .andExpect(status().isNoContent());
        }

        List<String> listNumbers(Boolean trashed, MockHttpSession session) throws Exception {
            return listNumbers(trashed, session, null);
        }

        List<String> listNumbers(Boolean trashed, MockHttpSession session, String owner) throws Exception {
            MvcResult result = mockMvc.perform(get("/documents")
                            .param("page_size", "100")
                            .queryParam("trashed", trashed == null ? "" : trashed.toString())
                            .queryParam("owner", owner == null ? "" : owner)
                            .session(session))
                    .andExpect(status().isOk())
                    .andReturn();
            List<String> names = new java.util.ArrayList<>();
            for (var node : objectMapper.readTree(result.getResponse().getContentAsString()).path("content")) {
                names.add(node.path("name").asText());
            }
            return names;
        }
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
