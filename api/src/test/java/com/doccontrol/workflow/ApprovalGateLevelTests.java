package com.doccontrol.workflow;

import com.doccontrol.CsrfTestSupport;
import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.document.DocumentDto;
import com.doccontrol.lookup.DepartmentDto;
import com.fasterxml.jackson.databind.JsonNode;
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

import static com.doccontrol.CsrfTestSupport.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The approval gates under membership levels (plan-back F3/F3b): starting
 * an approval is the canEdit gate (Manager/Collaborator on anything in the
 * department, Contributor on its own, Consumer never), and the reviewer
 * pool refuses CONSUMER members of the document's department — a Consumer
 * being assigned to approve would contradict "no approval rights at all".
 * Non-members and ROLE slots stay outside the level system.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@Import(CsrfTestSupport.class)
class ApprovalGateLevelTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Test
    void consumerCannotBeAssignedAsAReviewer() throws Exception {
        Fixture fx = new Fixture(mockMvc, objectMapper, "AGC");
        Integer doc = fx.createDocument(fx.contributor);

        mockMvc.perform(post("/documents/{id}/versions/{versionId}/workflow/start", doc, fx.firstVersionId(doc))
                        .with(csrf()).session(fx.contributor)
                        .contentType("application/json")
                        .content("{\"assignees\":[{\"type\":\"USER\",\"userId\":" + fx.consumerId + "}]}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("detail").value(org.hamcrest.Matchers.containsString(
                        "is a Consumer in department")));

        // the same start with an eligible assignee goes through
        mockMvc.perform(post("/documents/{id}/versions/{versionId}/workflow/start", doc, fx.firstVersionId(doc))
                        .with(csrf()).session(fx.contributor)
                        .contentType("application/json")
                        .content("{\"assignees\":[{\"type\":\"USER\",\"userId\":" + fx.managerId + "}]}"))
                .andExpect(status().isCreated());
    }

    @Test
    void reviewerCandidatesAreEditGated() throws Exception {
        Fixture fx = new Fixture(mockMvc, objectMapper, "AGR");
        Integer contributorsDoc = fx.createDocument(fx.contributor);
        Integer managersDoc = fx.createDocument(fx.manager);

        // the picklist rides the canEdit gate: Contributor on its own document
        mockMvc.perform(get("/documents/{id}/reviewer-candidates", contributorsDoc)
                        .session(fx.contributor))
                .andExpect(status().isOk());
        // ...but read-only on someone else's
        mockMvc.perform(get("/documents/{id}/reviewer-candidates", managersDoc)
                        .session(fx.contributor))
                .andExpect(status().isForbidden());
    }

    /** A department plus one member per level, all through the API. */
    private static class Fixture {
        final Integer departmentId;
        final Integer managerId;
        final Integer contributorId;
        final Integer consumerId;
        final MockHttpSession manager;
        final MockHttpSession contributor;
        private final MockMvc mockMvc;
        private final ObjectMapper objectMapper;
        private final MockHttpSession admin;

        Fixture(MockMvc mockMvc, ObjectMapper objectMapper, String prefix) throws Exception {
            this.mockMvc = mockMvc;
            this.objectMapper = objectMapper;
            this.admin = login("admin@doccontrol.local", "changeme_admin");

            MvcResult dept = mockMvc.perform(post("/departments").with(csrf()).session(admin)
                            .contentType("application/json")
                            .content("{\"code\":\"" + prefix + System.nanoTime() % 100000
                                    + "\",\"label\":\"Approval gate dept\"}"))
                    .andExpect(status().isCreated())
                    .andReturn();
            departmentId = objectMapper.readTree(dept.getResponse().getContentAsString())
                    .path("id").asInt();

            UserRef managerRef = createUser(prefix + "-manager", departmentId, "MANAGER");
            UserRef contributorRef = createUser(prefix + "-contrib", departmentId, "CONTRIBUTOR");
            UserRef consumerRef = createUser(prefix + "-consumer", departmentId, "CONSUMER");

            managerId = managerRef.id();
            contributorId = contributorRef.id();
            consumerId = consumerRef.id();
            manager = login(managerRef.email(), managerRef.password());
            contributor = login(contributorRef.email(), contributorRef.password());
        }

        Integer createDocument(MockHttpSession session) throws Exception {
            MvcResult types = mockMvc.perform(get("/document-types").session(admin))
                    .andExpect(status().isOk())
                    .andReturn();
            Integer typeId = objectMapper.readTree(types.getResponse().getContentAsString())
                    .get(0).path("id").asInt();
            MvcResult result = mockMvc.perform(multipart("/documents")
                            .file(new MockMultipartFile("file", "doc.txt", "text/plain", "content".getBytes()))
                            .param("document_type_id", String.valueOf(typeId))
                            .param("department_id", String.valueOf(departmentId))
                            .param("name", "Approval gate doc " + System.nanoTime())
                            .with(csrf()).session(session))
                    .andExpect(status().isCreated())
                    .andReturn();
            return objectMapper.readTree(result.getResponse().getContentAsString())
                    .path("id").asInt();
        }

        Integer firstVersionId(Integer documentId) throws Exception {
            MvcResult result = mockMvc.perform(get("/documents/{id}/versions", documentId).session(admin))
                    .andExpect(status().isOk())
                    .andReturn();
            return objectMapper.readTree(result.getResponse().getContentAsString())
                    .get(0).path("id").asInt();
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

        private UserRef createUser(String prefix, Integer departmentId, String level) throws Exception {
            String email = prefix + System.nanoTime() + "@doccontrol.test";
            String password = "pw-" + prefix;
            mockMvc.perform(post("/users").with(csrf()).session(admin)
                            .contentType("application/json")
                            .content("{\"name\":\"" + prefix + "\",\"email\":\"" + email
                                    + "\",\"departments\":[{\"departmentId\":" + departmentId
                                    + ",\"level\":\"" + level + "\"}],\"password\":\"" + password + "\"}"))
                    .andExpect(status().isCreated());
            MvcResult users = mockMvc.perform(get("/users").session(admin))
                    .andExpect(status().isOk())
                    .andReturn();
            for (JsonNode node : objectMapper.readTree(users.getResponse().getContentAsString())) {
                if (email.equals(node.path("email").asText())) {
                    return new UserRef(node.path("id").asInt(), email, password);
                }
            }
            throw new AssertionError("created user not found in /users: " + email);
        }
    }

    private record UserRef(Integer id, String email, String password) {
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
