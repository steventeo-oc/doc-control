package com.doccontrol.assistant;

import com.doccontrol.CsrfTestSupport;
import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.document.DocumentRepository;
import com.doccontrol.document.DocumentService;
import com.doccontrol.document.DocumentVersionRepository;
import com.doccontrol.identity.UserRepository;
import com.doccontrol.lookup.DepartmentRepository;
import com.doccontrol.lookup.DocumentTypeRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

import static com.doccontrol.CsrfTestSupport.csrf;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The guard for plan-back F3: the assistant does no per-user filtering because everything it indexes is already
 * readable by every signed-in user. This test opens each row of {@code assistant_indexable_version} through the API
 * as a plain user of another department (not the owner, not a reviewer, not an admin). If visibility ever changes
 * (a stricter rule, a confidential flag, named-user overrides) without the assistant being revisited, it fails here.
 *
 * The view is allowed to be narrower than the API and deliberately is: the API still serves a trashed document by
 * id, and an approved document with no current version by version id; the assistant indexes neither. Those two
 * behaviours are not asserted, so tightening them later does not break this test.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@Import(CsrfTestSupport.class)
class AssistantCorpusVisibilityTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    EntityManager entityManager;

    @Autowired
    DocumentRepository documents;

    @Autowired
    DocumentVersionRepository versions;

    @Autowired
    DocumentTypeRepository types;

    @Autowired
    DepartmentRepository departments;

    @Autowired
    UserRepository users;

    @Autowired
    DocumentService documentService;

    @Test
    void everyRowOfTheViewCanBeOpenedThroughTheApiByAPlainUserOfAnotherDepartment() throws Exception {
        World world = new World();
        List<Map<String, Object>> rows = world.viewRows();
        assertThat(rows).as("the fixture must put documents in the view, or this proves nothing")
                .hasSizeGreaterThanOrEqualTo(3);

        for (Map<String, Object> row : rows) {
            Object documentId = row.get("document_id");
            mockMvc.perform(get("/documents/{id}", documentId).session(world.outsider))
                    .andExpect(status().isOk());
            mockMvc.perform(get("/documents/{id}/versions/{versionId}", documentId, row.get("version_id"))
                            .session(world.outsider))
                    .andExpect(status().isOk());
        }
    }

    @Test
    void documentsThePublicCannotSeeAreNotInTheView() throws Exception {
        World world = new World();
        for (String label : List.of("draft", "in-review", "superseded", "obsolete")) {
            Integer id = world.fixtures.cases.get(label).document().getId();
            mockMvc.perform(get("/documents/{id}", id).session(world.outsider))
                    .andExpect(status().isNotFound());
            assertThat(world.viewedDocumentIds()).as("%s must not be indexed", label).doesNotContain(id);
        }
    }

    @Test
    void trashingAndRestoringThroughTheApiMovesTheRowOutOfAndBackIntoTheView() throws Exception {
        World world = new World();
        Integer id = world.fixtures.cases.get("released").document().getId();
        assertThat(world.viewedDocumentIds()).contains(id);

        mockMvc.perform(delete("/documents/{id}", id).with(csrf()).session(world.admin))
                .andExpect(status().isNoContent());
        assertThat(world.viewedDocumentIds()).doesNotContain(id);

        mockMvc.perform(post("/documents/{id}/restore", id).with(csrf()).session(world.admin))
                .andExpect(status().isOk());
        assertThat(world.viewedDocumentIds()).contains(id);
    }

    // ---- fixture ----

    private final class World {
        final MockHttpSession admin = login("admin@doccontrol.local", "changeme_admin");
        final MockHttpSession outsider;
        final AssistantCorpusFixtures fixtures;

        World() throws Exception {
            Integer documentsDepartment = createDepartment("AVD");
            Integer outsiderDepartment = createDepartment("AVO");
            String email = createUser("avo-user", outsiderDepartment, "COLLABORATOR");
            outsider = login(email, "pw-avo-user");
            fixtures = new AssistantCorpusFixtures(documents, versions, documentService,
                    types.findAll().get(0), departments.findById(documentsDepartment).orElseThrow(),
                    users.findByEmailIgnoreCase("admin@doccontrol.local").orElseThrow());
        }

        Integer createDepartment(String prefix) throws Exception {
            MvcResult result = mockMvc.perform(post("/departments").with(csrf()).session(admin)
                            .contentType("application/json")
                            .content("{\"code\":\"" + prefix + System.nanoTime() % 100000
                                    + "\",\"label\":\"Assistant contract test\"}"))
                    .andExpect(status().isCreated())
                    .andReturn();
            return objectMapper.readTree(result.getResponse().getContentAsString()).path("id").asInt();
        }

        String createUser(String name, Integer departmentId, String level) throws Exception {
            String email = name + System.nanoTime() + "@doccontrol.test";
            mockMvc.perform(post("/users").with(csrf()).session(admin)
                            .contentType("application/json")
                            .content("{\"name\":\"" + name + "\",\"email\":\"" + email
                                    + "\",\"departments\":[{\"departmentId\":" + departmentId
                                    + ",\"level\":\"" + level + "\"}],\"password\":\"pw-" + name + "\"}"))
                    .andExpect(status().isCreated());
            return email;
        }

        /** The fixture's rows; flushes first so the view sees the pending changes. */
        List<Map<String, Object>> viewRows() {
            entityManager.flush();
            return jdbc.queryForList(
                    "SELECT document_id, version_id FROM assistant_indexable_version WHERE document_number LIKE ?",
                    fixtures.prefix + "-%");
        }

        List<Integer> viewedDocumentIds() {
            return viewRows().stream().map(row -> ((Number) row.get("document_id")).intValue()).toList();
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
