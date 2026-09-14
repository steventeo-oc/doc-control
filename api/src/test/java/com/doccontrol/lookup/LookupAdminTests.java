package com.doccontrol.lookup;

import com.doccontrol.CsrfTestSupport;
import com.doccontrol.audit.AuditLog;
import com.doccontrol.audit.AuditLogRepository;
import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.document.DocumentRepository;
import com.doccontrol.identity.MembershipLevel;
import com.doccontrol.identity.User;
import com.doccontrol.identity.UserDepartment;
import com.doccontrol.identity.UserDepartmentId;
import com.doccontrol.identity.UserDepartmentRepository;
import com.doccontrol.identity.UserRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

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
 * The lookup admin surface (plan-back approved 2026-09-12): includeInactive
 * list shapes, usage counts for the deactivate confirmation, DELETE blocked
 * with precise counts while documents reference the row, clean hard delete
 * with membership/counter cascades, and the D7 audit trail — a department
 * delete lists the user ids it detached, queryable for re-adding them.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@Import(CsrfTestSupport.class)
class LookupAdminTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    PasswordEncoder passwordEncoder;

    @Autowired
    UserRepository userRepository;

    @Autowired
    UserDepartmentRepository userDepartmentRepository;

    @Autowired
    DocumentRepository documentRepository;

    @Autowired
    DocumentSequenceCounterRepository documentSequenceCounterRepository;

    @Autowired
    AuditLogRepository auditLogRepository;

    @Test
    void includeInactiveListsWhatTheDefaultHides() throws Exception {
        Integer deptId = createDepartment("INA");

        // deactivate: vanishes from the default list, present with the param
        deactivateDepartment(deptId);
        mockMvc.perform(get("/departments").session(adminSession()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == " + deptId + ")]").isEmpty());
        mockMvc.perform(get("/departments").param("includeInactive", "true").session(adminSession()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == " + deptId + ")].active").value(false));
    }

    @Test
    void usageCountsDocumentsAndUsersIncludingSoftDeleted() throws Exception {
        Integer deptId = createDepartment("USG");
        Integer typeId = createType("USG");
        Integer docA = createDocument(typeId, deptId, "Usage Doc A");
        createDocument(typeId, deptId, "Usage Doc B");
        User member = createUserInDepartment(deptId, "usageuser");

        // deactivate both: the counts must not care
        deactivateDepartment(deptId);
        deactivateType(typeId);

        mockMvc.perform(get("/departments/{id}/usage", deptId).session(adminSession()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.documents").value(2))
                .andExpect(jsonPath("$.users").value(1));
        mockMvc.perform(get("/document-types/{id}/usage", typeId).session(adminSession()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.documents").value(2));

        // soft-delete one: the FK is as live as ever, so the count holds (D3)
        mockMvc.perform(delete("/documents/{id}", docA).with(csrf()).session(adminSession()))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/document-types/{id}/usage", typeId).session(adminSession()))
                .andExpect(jsonPath("$.documents").value(2));

        // usage is the admin surface, not a public one
        mockMvc.perform(get("/departments/{id}/usage", deptId)
                        .session(loginAs(member.getEmail(), "pw-usageuser")))
                .andExpect(status().isForbidden());
    }

    @Test
    void deleteIsBlockedWithCountsWhileDocumentsReference() throws Exception {
        Integer deptId = createDepartment("BLK");
        Integer typeId = createType("BLK");
        createDocument(typeId, deptId, "Blocking Doc");
        deactivateDepartment(deptId);
        deactivateType(typeId);

        mockMvc.perform(delete("/departments/{id}", deptId).with(csrf()).session(adminSession()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("detail").value(org.hamcrest.Matchers.containsString(
                        "reference department '")))
                .andExpect(jsonPath("blocking.documents").value(1));
        mockMvc.perform(delete("/document-types/{id}", typeId).with(csrf()).session(adminSession()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("detail").value(org.hamcrest.Matchers.containsString(
                        "reference document type '")))
                .andExpect(jsonPath("blocking.documents").value(1));

        // nothing was deleted: both still reachable via includeInactive
        mockMvc.perform(get("/departments").param("includeInactive", "true").session(adminSession()))
                .andExpect(jsonPath("$[?(@.id == " + deptId + ")]").isNotEmpty());
    }

    @Test
    void cleanDeleteRemovesRowCascadesBookkeepingAndAudits() throws Exception {
        Integer deptId = createDepartment("DEL");
        Integer typeId = createType("DEL");

        // a counter row with no document behind it (a burned number) is
        // private bookkeeping and goes with the delete (plan-back F4)
        Department dept = departmentRepositoryById(deptId);
        DocumentType type = typeRepositoryById(typeId);
        DocumentSequenceCounter counter = new DocumentSequenceCounter();
        counter.setDocumentType(type);
        counter.setDepartment(dept);
        counter.setNextSequenceNumber(4);
        documentSequenceCounterRepository.save(counter);

        mockMvc.perform(delete("/departments/{id}", deptId).with(csrf()).session(adminSession()))
                .andExpect(status().isNoContent());
        mockMvc.perform(delete("/document-types/{id}", typeId).with(csrf()).session(adminSession()))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/departments").param("includeInactive", "true").session(adminSession()))
                .andExpect(jsonPath("$[?(@.id == " + deptId + ")]").isEmpty());
        assertThat(documentSequenceCounterRepository.countByDepartmentId(deptId)).isZero();
        assertThat(documentSequenceCounterRepository.countByDocumentTypeId(typeId)).isZero();
        assertThat(auditLogRepository.findAll())
                .anyMatch(entry -> "department".equals(entry.getEntityType())
                        && deptId.equals(entry.getEntityId())
                        && "deleted".equals(entry.getAction()));
    }

    /**
     * D7: the department delete's audit details list the user ids it
     * detached — the reference for re-adding them if the department is ever
     * re-created. Asserted through the same map the jsonb column round-trips.
     */
    @Test
    void departmentDeleteAuditsTheUserIdsItDetached() throws Exception {
        Integer deptId = createDepartment("D7");
        User userA = createUserInDepartment(deptId, "d7usera");
        User userB = createUserInDepartment(deptId, "d7userb");

        mockMvc.perform(delete("/departments/{id}", deptId).with(csrf()).session(adminSession()))
                .andExpect(status().isNoContent());

        assertThat(userDepartmentRepository.findAllByDepartmentId(deptId)).isEmpty();
        List<Integer> audited = auditLogRepository.findAll().stream()
                .filter(entry -> "department".equals(entry.getEntityType())
                        && deptId.equals(entry.getEntityId())
                        && "deleted".equals(entry.getAction()))
                .findFirst().orElseThrow()
                .getDetails().get("removed_user_ids") instanceof List<?> raw
                ? raw.stream().map(Object::toString).map(Integer::valueOf).toList()
                : List.of();
        assertThat(audited).containsExactlyInAnyOrder(userA.getId(), userB.getId());
    }

    @Test
    void tierCrudLifecycle() throws Exception {
        int tierNumber = 9000 + (int) (System.nanoTime() % 1000);
        MvcResult created = mockMvc.perform(post("/document-tiers")
                        .with(csrf()).session(adminSession())
                        .contentType("application/json")
                        .content("{\"tierNumber\":" + tierNumber + ",\"label\":\"Tier CRUD test\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.active").value(true))
                .andReturn();
        Integer tierId = objectMapper.readValue(created.getResponse().getContentAsString(),
                com.doccontrol.lookup.DocumentTierDto.class).id();

        // duplicate tierNumber rejected
        mockMvc.perform(post("/document-tiers")
                        .with(csrf()).session(adminSession())
                        .contentType("application/json")
                        .content("{\"tierNumber\":" + tierNumber + ",\"label\":\"Duplicate\"}"))
                .andExpect(status().isConflict());

        // default list is active-only; the new tier is active and present
        mockMvc.perform(get("/document-tiers").session(adminSession()))
                .andExpect(jsonPath("$[?(@.id == " + tierId + ")]").isNotEmpty());

        // deactivate: vanishes from the default, present with includeInactive
        mockMvc.perform(patch("/document-tiers/{id}", tierId).with(csrf()).session(adminSession())
                        .contentType("application/json").content("{\"active\": false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false));
        mockMvc.perform(get("/document-tiers").session(adminSession()))
                .andExpect(jsonPath("$[?(@.id == " + tierId + ")]").isEmpty());
        mockMvc.perform(get("/document-tiers").param("includeInactive", "true").session(adminSession()))
                .andExpect(jsonPath("$[?(@.id == " + tierId + ")].active").value(false));

        // usage with no types, then a clean delete
        mockMvc.perform(get("/document-tiers/{id}/usage", tierId).session(adminSession()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.documentTypes").value(0));
        mockMvc.perform(delete("/document-tiers/{id}", tierId).with(csrf()).session(adminSession()))
                .andExpect(status().isNoContent());
        assertThat(auditLogRepository.findAll())
                .anyMatch(entry -> "document_tier".equals(entry.getEntityType())
                        && tierId.equals(entry.getEntityId())
                        && "deleted".equals(entry.getAction()));
    }

    @Test
    void tierDeleteBlockedByReferencingTypes() throws Exception {
        Integer tierId = documentTierRepository.findAllByOrderByTierNumberAsc().get(0).getId();
        createType("TBK", tierId);

        mockMvc.perform(get("/document-tiers/{id}/usage", tierId).session(adminSession()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.documentTypes").value(org.hamcrest.Matchers.greaterThanOrEqualTo(1)));
        mockMvc.perform(delete("/document-tiers/{id}", tierId).with(csrf()).session(adminSession()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("detail").value(org.hamcrest.Matchers.containsString(
                        "reference document tier")))
                .andExpect(jsonPath("blocking.documentTypes")
                        .value(org.hamcrest.Matchers.greaterThanOrEqualTo(1)));

        // nothing cascades: the referencing type keeps working (D5)
        mockMvc.perform(get("/document-tiers/{id}/usage", tierId).session(adminSession()))
                .andExpect(jsonPath("$.documentTypes")
                        .value(org.hamcrest.Matchers.greaterThanOrEqualTo(1)));
    }

    @Test
    void tierWritesAreAdminOnly() throws Exception {
        User member = createUserInDepartment(createDepartment("TWR"), "tieruser");
        mockMvc.perform(post("/document-tiers")
                        .with(csrf()).session(loginAs(member.getEmail(), "pw-tieruser"))
                        .contentType("application/json")
                        .content("{\"tierNumber\":9500,\"label\":\"Not allowed\"}"))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/document-tiers").session(loginAs(member.getEmail(), "pw-tieruser")))
                .andExpect(status().isOk());
    }

    // ---- helpers ----

    @Autowired
    com.doccontrol.lookup.DepartmentRepository departmentRepository;
    @Autowired
    com.doccontrol.lookup.DocumentTypeRepository typeRepository;
    @Autowired
    com.doccontrol.lookup.DocumentTierRepository documentTierRepository;

    private Department departmentRepositoryById(Integer id) {
        return departmentRepository.findById(id).orElseThrow();
    }

    private DocumentType typeRepositoryById(Integer id) {
        return typeRepository.findById(id).orElseThrow();
    }

    private Integer createDepartment(String prefix) throws Exception {
        MvcResult result = mockMvc.perform(post("/departments")
                        .with(csrf()).session(adminSession())
                        .contentType("application/json")
                        .content("{\"code\":\"" + prefix + System.nanoTime() % 100000
                                + "\",\"label\":\"Lookup admin test dept\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readValue(result.getResponse().getContentAsString(),
                com.doccontrol.lookup.DepartmentDto.class).id();
    }

    private Integer createType(String prefix) throws Exception {
        return createType(prefix, documentTierRepository.findAllByOrderByTierNumberAsc().get(0).getId());
    }

    private Integer createType(String prefix, Integer tierId) throws Exception {
        MvcResult result = mockMvc.perform(post("/document-types")
                        .with(csrf()).session(adminSession())
                        .contentType("application/json")
                        .content("{\"code\":\"" + prefix + System.nanoTime() % 100000
                                + "\",\"label\":\"Lookup admin test type\",\"tierId\":" + tierId + "}"))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readValue(result.getResponse().getContentAsString(),
                com.doccontrol.lookup.DocumentTypeDto.class).id();
    }

    private void deactivateDepartment(Integer id) throws Exception {
        mockMvc.perform(patch("/departments/{id}", id).with(csrf()).session(adminSession())
                        .contentType("application/json").content("{\"active\": false}"))
                .andExpect(status().isOk());
    }

    private void deactivateType(Integer id) throws Exception {
        mockMvc.perform(patch("/document-types/{id}", id).with(csrf()).session(adminSession())
                        .contentType("application/json").content("{\"active\": false}"))
                .andExpect(status().isOk());
    }

    private Integer createDocument(Integer typeId, Integer departmentId, String name) throws Exception {
        MvcResult result = mockMvc.perform(multipart("/documents")
                        .file(new MockMultipartFile("file", "doc.txt", "text/plain", "content".getBytes()))
                        .param("document_type_id", String.valueOf(typeId))
                        .param("department_id", String.valueOf(departmentId))
                        .param("name", name)
                        .with(csrf()).session(adminSession()))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readValue(result.getResponse().getContentAsString(),
                com.doccontrol.document.DocumentDto.class).id();
    }

    /** Direct repository setup — membership without going through the users API. */
    private User createUserInDepartment(Integer departmentId, String emailPrefix) {
        User user = new User();
        user.setName(emailPrefix + System.nanoTime() + "@doccontrol.test");
        user.setEmail(user.getName());
        user.setPasswordHash(passwordEncoder.encode("pw-" + emailPrefix));
        user.setActive(true);
        userRepository.save(user);

        UserDepartment membership = new UserDepartment();
        membership.setId(new UserDepartmentId(user.getId(), departmentId));
        membership.setUser(user);
        membership.setDepartment(departmentRepositoryById(departmentId));        membership.setLevel(MembershipLevel.COLLABORATOR);
        userDepartmentRepository.saveAndFlush(membership);
        return user;
    }

    private MockHttpSession adminSession() throws Exception {
        MvcResult result = mockMvc.perform(post("/auth/login").with(csrf())
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(
                                new LoginRequest("admin@doccontrol.local", "changeme_admin"))))
                .andExpect(status().isOk())
                .andReturn();
        MockHttpSession session = (MockHttpSession) result.getRequest().getSession(false);
        if (session == null) {
            throw new AssertionError("Expected a session after login");
        }
        return session;
    }

    private MockHttpSession loginAs(String email, String password) throws Exception {
        MvcResult result = mockMvc.perform(post("/auth/login").with(csrf())
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(new LoginRequest(email, password))))
                .andExpect(status().isOk())
                .andReturn();
        return (MockHttpSession) result.getRequest().getSession(false);
    }
}
