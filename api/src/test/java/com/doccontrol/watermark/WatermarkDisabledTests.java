package com.doccontrol.watermark;

import com.doccontrol.CsrfTestSupport;
import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.document.DocumentDto;
import com.doccontrol.document.DocumentVersionDto;
import com.doccontrol.identity.MembershipLevel;
import com.doccontrol.identity.Role;
import com.doccontrol.identity.User;
import com.doccontrol.identity.UserDepartment;
import com.doccontrol.identity.UserDepartmentId;
import com.doccontrol.identity.UserDepartmentRepository;
import com.doccontrol.identity.UserRepository;
import com.doccontrol.identity.UserRole;
import com.doccontrol.identity.UserRoleId;
import com.doccontrol.identity.UserRoleRepository;
import com.doccontrol.identity.RoleRepository;
import com.doccontrol.lookup.Department;
import com.doccontrol.lookup.DepartmentRepository;
import com.doccontrol.lookup.DocumentTypeRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import static com.doccontrol.CsrfTestSupport.csrf;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The explicit off-switch (plan-back flag F4): doccontrol.watermark
 * .enabled=false restores the pre-watermark pass-through exactly —
 * originals stream with their original content type, and the rendition
 * pipeline is never touched. This is an operational decision, never a
 * silent fallback for a broken sidecar (that path is a fail-closed 503).
 */
@SpringBootTest(properties = "doccontrol.watermark.enabled=false")
@AutoConfigureMockMvc
@Transactional
@Import(CsrfTestSupport.class)
class WatermarkDisabledTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    PasswordEncoder passwordEncoder;

    @Autowired
    UserRepository userRepository;

    @Autowired
    UserRoleRepository userRoleRepository;

    @Autowired
    UserDepartmentRepository userDepartmentRepository;

    @Autowired
    RoleRepository roleRepository;

    @Autowired
    DepartmentRepository departmentRepository;

    @Autowired
    DocumentTypeRepository documentTypeRepository;

    @MockitoBean
    RenditionClient renditionClient;

    @Test
    void disabledWatermarkingPassesOriginalsThrough() throws Exception {
        Department dept = tempDepartment("D1");
        createUser("wmdisabled@doccontrol.test", dept);

        MvcResult created = mockMvc.perform(multipart("/documents")
                        .file(new MockMultipartFile("file", "sop.docx", "application/msword",
                                "original docx bytes".getBytes()))
                        .param("document_type_id", String.valueOf(sopTypeId()))
                        .param("department_id", String.valueOf(dept.getId()))
                        .param("name", "Disabled Watermark Doc")
                        .with(csrf()).session(loginAs("wmdisabled@doccontrol.test")))
                .andExpect(status().isCreated())
                .andReturn();
        Integer docId = objectMapper.readValue(
                created.getResponse().getContentAsString(), DocumentDto.class).id();

        MvcResult versions = mockMvc.perform(get("/documents/{id}/versions", docId)
                        .session(loginAs("wmdisabled@doccontrol.test")))
                .andExpect(status().isOk())
                .andReturn();
        Integer versionId = objectMapper.readValue(versions.getResponse().getContentAsString(),
                DocumentVersionDto[].class)[0].id();

        byte[] body = mockMvc.perform(get("/documents/{id}/versions/{versionId}/download",
                        docId, versionId).session(loginAs("wmdisabled@doccontrol.test")))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CONTENT_TYPE, "application/msword"))
                .andReturn().getResponse().getContentAsByteArray();
        assertThat(new String(body)).isEqualTo("original docx bytes");
        verifyNoInteractions(renditionClient);
    }

    // ---- helpers ----

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

    private void createUser(String email, Department department) {
        User user = new User();
        user.setName(email);
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode("pw-" + email));
        user.setActive(true);
        userRepository.save(user);

        UserDepartment membership = new UserDepartment();
        membership.setId(new UserDepartmentId(user.getId(), department.getId()));
        membership.setUser(user);
        membership.setDepartment(department);        membership.setLevel(MembershipLevel.COLLABORATOR);
        userDepartmentRepository.saveAndFlush(membership);
        user.getDepartments().add(membership);

        Role role = roleRepository.findByName("User").orElseThrow();
        UserRole roleMembership = new UserRole();
        roleMembership.setId(new UserRoleId(user.getId(), role.getId()));
        roleMembership.setUser(user);
        roleMembership.setRole(role);
        userRoleRepository.saveAndFlush(roleMembership);
        user.getRoles().add(roleMembership);
    }

    private MockHttpSession loginAs(String email) throws Exception {
        MvcResult result = mockMvc.perform(post("/auth/login").with(csrf())
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(new LoginRequest(email, "pw-" + email))))
                .andExpect(status().isOk())
                .andReturn();
        MockHttpSession session = (MockHttpSession) result.getRequest().getSession(false);
        if (session == null) {
            throw new AssertionError("Expected a session after login");
        }
        return session;
    }
}
