package com.doccontrol.watermark;

import com.doccontrol.CsrfTestSupport;
import com.doccontrol.audit.AuditLogRepository;
import com.doccontrol.auth.dto.LoginRequest;
import com.doccontrol.common.web.RenditionUnavailableException;
import com.doccontrol.document.Document;
import com.doccontrol.document.DocumentDto;
import com.doccontrol.document.DocumentRepository;
import com.doccontrol.document.DocumentStatus;
import com.doccontrol.document.DocumentVersion;
import com.doccontrol.document.DocumentVersionDto;
import com.doccontrol.document.DocumentVersionRepository;
import com.doccontrol.document.DocumentVersionStatus;
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
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.text.PDFTextStripper;
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

import java.io.ByteArrayOutputStream;

import static com.doccontrol.CsrfTestSupport.csrf;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Download-path behavior of Phase 2e watermarking (plan-back §6): released
 * documents download as stamped PDF renditions (mark text by version
 * status — flag F1), PDFs stamp directly without the rendition client,
 * office types convert through the sidecar, non-renditionable types pass
 * through unstamped (F3), failures fail closed as 503 (F4), and
 * original=true is the audited canModify-only escape hatch (F2).
 * Documents are driven into their states directly (repositories) — the
 * workflow paths have their own coverage.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@Import(CsrfTestSupport.class)
class WatermarkEndpointTests {

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

    @Autowired
    DocumentRepository documentRepository;

    @Autowired
    DocumentVersionRepository documentVersionRepository;

    @Autowired
    AuditLogRepository auditLogRepository;

    @PersistenceContext
    EntityManager entityManager;

    @MockitoBean
    RenditionClient renditionClient;

    @Test
    void releasedDocumentDownloadsAsAStampedPdfRendition() throws Exception {
        Department dept = tempDepartment("M1");
        createUser("wmowner1@doccontrol.test", dept);
        createUser("wmoutsider@doccontrol.test", tempDepartment("M1x"));
        Integer docId = createDocumentWithFile("wmowner1@doccontrol.test", dept.getId(),
                "Released SOP",
                new MockMultipartFile("file", "sop.pdf", "application/pdf",
                        onePagePdf("Released content")));
        makeCurrentVersion(docId);

        byte[] body = mockMvc.perform(get("/documents/{id}/versions/{versionId}/download",
                        docId, firstVersionId(docId)).session(loginAs("wmoutsider@doccontrol.test")))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CONTENT_TYPE, "application/pdf"))
                .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION, containsString(".pdf")))
                .andReturn().getResponse().getContentAsByteArray();
        assertThat(new String(body, 0, 5)).isEqualTo("%PDF-");
        assertThat(pdfText(body))
                .contains("UNCONTROLLED IF PRINTED")
                .contains("Released content");
        // PDF originals stamp directly — the rendition sidecar is not involved
        verifyNoInteractions(renditionClient);
    }

    @Test
    void officeDocumentConvertsThroughTheSidecarThenStamps() throws Exception {
        Department dept = tempDepartment("M2");
        createUser("wmowner2@doccontrol.test", dept);
        Integer docId = createDocumentWithFile("wmowner2@doccontrol.test", dept.getId(),
                "Office SOP",
                new MockMultipartFile("file", "sop.docx", "application/msword",
                        "original docx bytes".getBytes()));
        makeCurrentVersion(docId);
        when(renditionClient.convertToPdf(eq("sop.docx"), eq("application/msword"), any()))
                .thenReturn(onePagePdf("converted body"));

        byte[] body = mockMvc.perform(get("/documents/{id}/versions/{versionId}/download",
                        docId, firstVersionId(docId)).session(loginAs("wmowner2@doccontrol.test")))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CONTENT_TYPE, "application/pdf"))
                .andReturn().getResponse().getContentAsByteArray();
        assertThat(pdfText(body))
                .contains("UNCONTROLLED IF PRINTED")
                .contains("converted body");
        verify(renditionClient).convertToPdf(eq("sop.docx"), eq("application/msword"), any());
    }

    @Test
    void originalDownloadIsAllowedForDepartmentMembersAndAudited() throws Exception {
        Department dept = tempDepartment("M3");
        createUser("wmowner3@doccontrol.test", dept);
        Integer docId = createDocumentWithFile("wmowner3@doccontrol.test", dept.getId(),
                "Original Escape Hatch",
                new MockMultipartFile("file", "sop.docx", "application/msword",
                        "exact original bytes".getBytes()));
        makeCurrentVersion(docId);

        byte[] body = mockMvc.perform(get("/documents/{id}/versions/{versionId}/download",
                        docId, firstVersionId(docId)).param("original", "true")
                        .session(loginAs("wmowner3@doccontrol.test")))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CONTENT_TYPE, "application/msword"))
                .andReturn().getResponse().getContentAsByteArray();
        assertThat(new String(body)).isEqualTo("exact original bytes");
        assertThat(auditLogRepository.findAll())
                .anyMatch(entry -> "document_version".equals(entry.getEntityType())
                        && "original_downloaded".equals(entry.getAction()));
        verifyNoInteractions(renditionClient);
    }

    @Test
    void originalDownloadIsForbiddenOutsideTheDepartment() throws Exception {
        Department dept = tempDepartment("M4");
        createUser("wmowner4@doccontrol.test", dept);
        createUser("wmoutsider4@doccontrol.test", tempDepartment("M4x"));
        Integer docId = createDocumentWithFile("wmowner4@doccontrol.test", dept.getId(),
                "Outsider Original",
                new MockMultipartFile("file", "sop.pdf", "application/pdf",
                        onePagePdf("content")));
        makeCurrentVersion(docId);

        mockMvc.perform(get("/documents/{id}/versions/{versionId}/download",
                        docId, firstVersionId(docId)).param("original", "true")
                        .session(loginAs("wmoutsider4@doccontrol.test")))
                .andExpect(status().isForbidden());
    }

    @Test
    void draftVersionDownloadsStampedAsDraft() throws Exception {
        Department dept = tempDepartment("M5");
        createUser("wmowner5@doccontrol.test", dept);
        Integer docId = createDocumentWithFile("wmowner5@doccontrol.test", dept.getId(),
                "Draft SOP",
                new MockMultipartFile("file", "draft.pdf", "application/pdf",
                        onePagePdf("draft content")));

        byte[] body = mockMvc.perform(get("/documents/{id}/versions/{versionId}/download",
                        docId, firstVersionId(docId)).session(loginAs("wmowner5@doccontrol.test")))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CONTENT_TYPE, "application/pdf"))
                .andReturn().getResponse().getContentAsByteArray();
        assertThat(pdfText(body)).contains("DRAFT — UNCONTROLLED");
        verifyNoInteractions(renditionClient);
    }

    @Test
    void supersededVersionDownloadsStampedAsSuperseded() throws Exception {
        Department dept = tempDepartment("M6");
        createUser("wmowner6@doccontrol.test", dept);
        Integer docId = createDocumentWithFile("wmowner6@doccontrol.test", dept.getId(),
                "Superseded SOP",
                new MockMultipartFile("file", "v1.pdf", "application/pdf",
                        onePagePdf("version one")));
        Integer v1Id = firstVersionId(docId);
        makeCurrentVersion(docId);

        // v2 uploaded and approved immediately: v1 becomes superseded
        MvcResult upload = mockMvc.perform(multipart("/documents/{id}/versions", docId)
                        .file(new MockMultipartFile("file", "v2.pdf", "application/pdf",
                                onePagePdf("version two")))
                        .param("change_notes", "revision two")
                        .with(csrf()).session(loginAs("wmowner6@doccontrol.test")))
                .andExpect(status().isOk())
                .andReturn();
        Integer v2Id = objectMapper.readValue(upload.getResponse().getContentAsString(),
                DocumentVersionDto.class).id();
        Document document = documentRepository.findById(docId).orElseThrow();
        documentVersionRepository.findById(v1Id).orElseThrow().setStatus(DocumentVersionStatus.SUPERSEDED);
        DocumentVersion v2 = documentVersionRepository.findById(v2Id).orElseThrow();
        v2.setStatus(DocumentVersionStatus.CURRENT);
        document.setCurrentVersion(v2);
        entityManager.flush();

        byte[] body = mockMvc.perform(get("/documents/{id}/versions/{versionId}/download",
                        docId, v1Id).session(loginAs("wmowner6@doccontrol.test")))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CONTENT_TYPE, "application/pdf"))
                .andReturn().getResponse().getContentAsByteArray();
        assertThat(pdfText(body)).contains("SUPERSEDED — DO NOT USE");
        verifyNoInteractions(renditionClient);
    }

    @Test
    void nonRenditionableTypesPassThroughUnstamped() throws Exception {
        Department dept = tempDepartment("M7");
        createUser("wmowner7@doccontrol.test", dept);
        Integer docId = createDocumentWithFile("wmowner7@doccontrol.test", dept.getId(),
                "CAD Drawing",
                new MockMultipartFile("file", "part.dwg", "application/octet-stream",
                        "dwg bytes".getBytes()));

        byte[] body = mockMvc.perform(get("/documents/{id}/versions/{versionId}/download",
                        docId, firstVersionId(docId)).session(loginAs("wmowner7@doccontrol.test")))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CONTENT_TYPE, "application/octet-stream"))
                .andReturn().getResponse().getContentAsByteArray();
        assertThat(new String(body)).isEqualTo("dwg bytes");
        verifyNoInteractions(renditionClient);
    }

    @Test
    void renditionFailureFailsClosedAs503() throws Exception {
        Department dept = tempDepartment("M8");
        createUser("wmowner8@doccontrol.test", dept);
        Integer docId = createDocumentWithFile("wmowner8@doccontrol.test", dept.getId(),
                "Failing Rendition",
                new MockMultipartFile("file", "sop.docx", "application/msword",
                        "docx".getBytes()));
        makeCurrentVersion(docId);
        when(renditionClient.convertToPdf(any(), any(), any()))
                .thenThrow(new RenditionUnavailableException("sidecar down"));

        mockMvc.perform(get("/documents/{id}/versions/{versionId}/download",
                        docId, firstVersionId(docId)).session(loginAs("wmowner8@doccontrol.test")))
                .andExpect(status().isServiceUnavailable());
    }

    // ---- helpers ----

    /** Promotes the document's first version to the released/current state. */
    private void makeCurrentVersion(Integer docId) {
        Document document = documentRepository.findById(docId).orElseThrow();
        DocumentVersion version =
                documentVersionRepository.findAllByDocumentIdOrderByVersionNumberAsc(docId).get(0);
        document.setStatus(DocumentStatus.RELEASED);
        version.setStatus(DocumentVersionStatus.CURRENT);
        document.setCurrentVersion(version);
        documentRepository.save(document);
        documentVersionRepository.save(version);
        entityManager.flush();
    }

    private Integer firstVersionId(Integer docId) {
        return documentVersionRepository
                .findAllByDocumentIdOrderByVersionNumberAsc(docId).get(0).getId();
    }

    private Integer createDocumentWithFile(String userEmail, Integer departmentId, String name,
                                           MockMultipartFile file) throws Exception {
        MvcResult result = mockMvc.perform(multipart("/documents")
                        .file(file)
                        .param("document_type_id", String.valueOf(sopTypeId()))
                        .param("department_id", String.valueOf(departmentId))
                        .param("name", name)
                        .with(csrf())
                        .session(loginAs(userEmail)))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readValue(result.getResponse().getContentAsString(), DocumentDto.class).id();
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

    private byte[] onePagePdf(String line) throws Exception {
        try (PDDocument doc = new PDDocument()) {
            PDPage page = new PDPage(PDRectangle.LETTER);
            doc.addPage(page);
            try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                cs.beginText();
                cs.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 11);
                cs.newLineAtOffset(60, 700);
                cs.showText(line);
                cs.endText();
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            doc.save(out);
            return out.toByteArray();
        }
    }

    /** Extracted text with whitespace normalized — the rotated mark extracts with line breaks. */
    private String pdfText(byte[] pdf) throws Exception {
        try (PDDocument doc = Loader.loadPDF(pdf)) {
            return new PDFTextStripper().getText(doc).replaceAll("\\s+", " ");
        }
    }
}
