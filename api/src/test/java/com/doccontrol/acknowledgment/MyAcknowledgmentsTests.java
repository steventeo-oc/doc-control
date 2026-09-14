package com.doccontrol.acknowledgment;

import com.doccontrol.CsrfTestSupport;
import com.doccontrol.auth.dto.LoginRequest;
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

import java.util.ArrayList;
import java.util.List;

import static com.doccontrol.CsrfTestSupport.csrf;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The "Pending My Acknowledgment" reverse query (nav restructure plan-back
 * F2): released documents in the caller's departments whose current version
 * the caller has not acknowledged — the inverse of the per-document
 * outstandingUsers query. Level-blind (every membership level owes
 * acknowledgment), member-scoped (non-members get nothing), and it shrinks
 * as the caller acknowledges.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@Import(CsrfTestSupport.class)
class MyAcknowledgmentsTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Test
    void pendingAcknowledgmentsShrinkAsTheCallerAcknowledges() throws Exception {
        Fixture fx = new Fixture(mockMvc, objectMapper, "PMA");

        Integer docA = fx.createReleasedDocument("Pending Doc A");
        Integer docB = fx.createReleasedDocument("Pending Doc B");
        String numberA = fx.documentNumber(docA);
        String numberB = fx.documentNumber(docB);

        // both department members see both documents as pending
        assertThat(fx.pendingNumbers(fx.contributorSession)).containsExactlyInAnyOrder(numberA, numberB);
        assertThat(fx.pendingNumbers(fx.managerSession)).containsExactlyInAnyOrder(numberA, numberB);

        // window fields present, not overdue (the window just opened)
        MvcResult pending = mockMvc.perform(get("/my/acknowledgments").session(fx.contributorSession))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode first = objectMapper.readTree(pending.getResponse().getContentAsString()).get(0);
        assertThat(first.path("effectiveAt").isNull()).isFalse();
        assertThat(first.path("windowClosesAt").isNull()).isFalse();
        assertThat(first.path("overdue").asBoolean()).isFalse();

        // the contributor acknowledges one: it leaves THEIR list, the
        // manager's list is untouched
        fx.acknowledge(docA, fx.contributorSession);
        assertThat(fx.pendingNumbers(fx.contributorSession)).containsExactly(numberB);
        assertThat(fx.pendingNumbers(fx.managerSession)).containsExactlyInAnyOrder(numberA, numberB);

        // a user outside the department gets nothing
        Fixture other = new Fixture(mockMvc, objectMapper, "PMO");
        assertThat(other.pendingNumbers(other.contributorSession)).doesNotContain(numberA, numberB);
    }

    /** A department plus a MANAGER and a CONTRIBUTOR, all through the API. */
    private static class Fixture {
        final String prefix;
        final Integer departmentId;
        final Integer managerId;
        final Integer contributorId;
        final MockHttpSession managerSession;
        final MockHttpSession contributorSession;
        private final MockMvc mockMvc;
        private final ObjectMapper objectMapper;
        private final MockHttpSession admin;

        Fixture(MockMvc mockMvc, ObjectMapper objectMapper, String prefix) throws Exception {
            this.mockMvc = mockMvc;
            this.objectMapper = objectMapper;
            this.prefix = prefix;
            this.admin = login("admin@doccontrol.local", "changeme_admin");

            MvcResult dept = mockMvc.perform(post("/departments").with(csrf()).session(admin)
                            .contentType("application/json")
                            .content("{\"code\":\"" + prefix + System.nanoTime() % 100000
                                    + "\",\"label\":\"Pending ack dept\"}"))
                    .andExpect(status().isCreated())
                    .andReturn();
            departmentId = objectMapper.readTree(dept.getResponse().getContentAsString())
                    .path("id").asInt();

            UserRef manager = createUser(prefix + "-manager", departmentId, "MANAGER");
            UserRef contributor = createUser(prefix + "-contrib", departmentId, "CONTRIBUTOR");
            managerId = manager.id();
            contributorId = contributor.id();
            managerSession = login(manager.email(), manager.password());
            contributorSession = login(contributor.email(), contributor.password());
        }

        Integer createReleasedDocument(String name) throws Exception {
            Integer docId = createDocument(name);
            Integer versionId = firstVersionId(docId);
            // the contributor starts, the manager approves — released v1
            MvcResult started = mockMvc.perform(
                            post("/documents/{id}/versions/{versionId}/workflow/start", docId, versionId)
                                    .with(csrf()).session(contributorSession)
                                    .contentType("application/json")
                                    .content("{\"assignees\":[{\"type\":\"USER\",\"userId\":"
                                            + managerId + "}]}"))
                            .andExpect(status().isCreated())
                            .andReturn();
            Integer instanceId = objectMapper.readTree(started.getResponse().getContentAsString())
                    .path("id").asInt();
            MvcResult tasks = mockMvc.perform(
                            get("/workflow-instances/{id}/tasks", instanceId).session(managerSession))
                    .andExpect(status().isOk())
                    .andReturn();
            String taskId = objectMapper.readTree(tasks.getResponse().getContentAsString())
                    .get(0).path("id").asText();
            mockMvc.perform(post("/workflow-tasks/{taskId}/complete", taskId).with(csrf())
                            .session(managerSession)
                            .contentType("application/json")
                            .content("{\"approved\":true,\"comment\":\"released\"}"))
                    .andExpect(status().isOk());
            return docId;
        }

        void acknowledge(Integer docId, MockHttpSession session) throws Exception {
            mockMvc.perform(post("/documents/{id}/acknowledge", docId).with(csrf()).session(session))
                    .andExpect(status().isOk());
        }

        List<String> pendingNumbers(MockHttpSession session) throws Exception {
            MvcResult result = mockMvc.perform(get("/my/acknowledgments").session(session))
                    .andExpect(status().isOk())
                    .andReturn();
            List<String> numbers = new ArrayList<>();
            for (JsonNode node : objectMapper.readTree(result.getResponse().getContentAsString())) {
                numbers.add(node.path("documentNumber").asText());
            }
            return numbers;
        }

        String documentNumber(Integer docId) throws Exception {
            MvcResult result = mockMvc.perform(get("/documents/{id}", docId).session(managerSession))
                    .andExpect(status().isOk())
                    .andReturn();
            return objectMapper.readTree(result.getResponse().getContentAsString())
                    .path("documentNumber").asText();
        }

        private UserRef createUser(String name, Integer departmentId, String level) throws Exception {
            String email = name + System.nanoTime() + "@doccontrol.test";
            String password = "pw-" + name;
            mockMvc.perform(post("/users").with(csrf()).session(admin)
                            .contentType("application/json")
                            .content("{\"name\":\"" + name + "\",\"email\":\"" + email
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

        Integer createDocument(String name) throws Exception {
            MvcResult types = mockMvc.perform(get("/document-types").session(managerSession))
                    .andExpect(status().isOk())
                    .andReturn();
            Integer typeId = objectMapper.readTree(types.getResponse().getContentAsString())
                    .get(0).path("id").asInt();
            MvcResult result = mockMvc.perform(multipart("/documents")
                            .file(new MockMultipartFile("file", "doc.txt", "text/plain", "content".getBytes()))
                            .param("document_type_id", String.valueOf(typeId))
                            .param("department_id", String.valueOf(departmentId))
                            .param("name", prefix + " " + name)
                            .with(csrf()).session(contributorSession))
                    .andExpect(status().isCreated())
                    .andReturn();
            return objectMapper.readTree(result.getResponse().getContentAsString()).path("id").asInt();
        }

        Integer firstVersionId(Integer docId) throws Exception {
            MvcResult result = mockMvc.perform(get("/documents/{id}/versions", docId).session(managerSession))
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
    }

    private record UserRef(Integer id, String email, String password) {
    }
}
