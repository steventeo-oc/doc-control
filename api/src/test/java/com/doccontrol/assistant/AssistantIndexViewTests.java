package com.doccontrol.assistant;

import com.doccontrol.document.Document;
import com.doccontrol.document.DocumentRepository;
import com.doccontrol.document.DocumentService;
import com.doccontrol.document.DocumentStatus;
import com.doccontrol.document.DocumentVersion;
import com.doccontrol.document.DocumentVersionRepository;
import com.doccontrol.document.DocumentVersionStatus;
import com.doccontrol.identity.UserRepository;
import com.doccontrol.lookup.DepartmentRepository;
import com.doccontrol.lookup.DocumentTypeRepository;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The assistant's window onto document-control (AI_Assistant_Design_PlanBack.md F3/F4, section 2.6): the view
 * {@code assistant_indexable_version} must list the current version of every document that is not trashed and is
 * approved or released, and nothing else. The lifecycle matrix lives in {@link AssistantCorpusFixtures}.
 */
@SpringBootTest
@Transactional
class AssistantIndexViewTests {

    /** The columns assistant/app/sources.py selects; renaming one here without the other breaks the sync. */
    private static final List<String> COLUMNS = List.of(
            "document_id", "document_number", "document_name", "type_code", "department_code",
            "version_id", "version_number", "file_reference", "effective_at", "uploaded_at", "document_updated_at");

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
    void theViewListsTheCurrentVersionOfEveryApprovedOrReleasedUntrashedDocumentAndNothingElse() {
        AssistantCorpusFixtures fx = fixtures();
        Map<String, Map<String, Object>> rows = view(fx);

        fx.cases.forEach((label, c) -> {
            Map<String, Object> row = rows.get(c.document().getDocumentNumber());
            if (c.shown() == null) {
                assertThat(row).as("%s must not be in the view", label).isNull();
            } else {
                assertThat(row).as("%s must be in the view", label).isNotNull();
                assertThat(((Number) row.get("version_id")).intValue())
                        .as("%s: the version the view shows", label).isEqualTo(c.shown().getId());
            }
        });
        long expected = fx.cases.values().stream().filter(c -> c.shown() != null).count();
        assertThat(rows).as("no rows beyond the expected ones").hasSize((int) expected);
    }

    @Test
    void theViewCarriesExactlyTheColumnsTheSidecarReads() {
        List<String> columns = jdbc.queryForList(
                "SELECT column_name FROM information_schema.columns "
                        + "WHERE table_name = 'assistant_indexable_version' AND table_schema = current_schema() "
                        + "ORDER BY ordinal_position", String.class);
        assertThat(columns).containsExactlyElementsOf(COLUMNS);
    }

    @Test
    void aRowDescribesTheDocumentAndItsCurrentVersion() {
        AssistantCorpusFixtures fx = fixtures();
        AssistantCorpusFixtures.Case released = fx.cases.get("released");
        Map<String, Object> row = view(fx).get(released.document().getDocumentNumber());

        assertThat(((Number) row.get("document_id")).intValue()).isEqualTo(released.document().getId());
        assertThat(row.get("document_name")).isEqualTo("Assistant view test released");
        assertThat(row.get("type_code")).isEqualTo(fx.type().getCode());
        assertThat(row.get("department_code")).isEqualTo(fx.department().getCode());
        assertThat(((Number) row.get("version_number")).intValue()).isEqualTo(1);
        assertThat(row.get("file_reference")).isEqualTo(released.shown().getFileReference());
        assertThat(((java.sql.Date) row.get("effective_at")).toLocalDate()).isEqualTo(fx.today);
        assertThat(row.get("uploaded_at")).isNotNull();
        assertThat(row.get("document_updated_at")).isNotNull();
    }

    @Test
    void afterAPromotionOnlyTheNewCurrentVersionAppears() {
        AssistantCorpusFixtures fx = fixtures();
        Document document = fx.document("promotion", DocumentStatus.DRAFT);
        DocumentVersion v1 = fx.version(document, 1, DocumentVersionStatus.DRAFT);
        fx.promote(v1);
        assertThat(versionsShown(document)).containsExactly(v1.getId());

        DocumentVersion v2 = fx.version(document, 2, DocumentVersionStatus.DRAFT);
        assertThat(versionsShown(document)).as("an uploaded draft changes nothing").containsExactly(v1.getId());

        fx.promote(v2);
        assertThat(versionsShown(document)).as("the promotion moves the row, it does not add one")
                .containsExactly(v2.getId());
    }

    @Test
    void aTrashedDocumentLeavesTheViewAndComesBackWhenRestored() {
        AssistantCorpusFixtures fx = fixtures();
        Document document = fx.cases.get("released").document();
        assertThat(versionsShown(document)).hasSize(1);

        document.setDeletedAt(LocalDateTime.now());
        assertThat(versionsShown(document)).isEmpty();

        document.setDeletedAt(null);
        assertThat(versionsShown(document)).hasSize(1);
    }

    private AssistantCorpusFixtures fixtures() {
        return new AssistantCorpusFixtures(documents, versions, documentService,
                types.findAll().get(0), departments.findAll().get(0),
                users.findByEmailIgnoreCase("admin@doccontrol.local").orElseThrow());
    }

    /** The fixture's rows keyed by document number; flushes first so the view sees the pending changes. */
    private Map<String, Map<String, Object>> view(AssistantCorpusFixtures fx) {
        entityManager.flush();
        Map<String, Map<String, Object>> rows = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList(
                "SELECT * FROM assistant_indexable_version WHERE document_number LIKE ?", fx.prefix + "-%")) {
            rows.put((String) row.get("document_number"), row);
        }
        return rows;
    }

    private List<Integer> versionsShown(Document document) {
        entityManager.flush();
        return jdbc.queryForList("SELECT version_id FROM assistant_indexable_version WHERE document_id = ?",
                Integer.class, document.getId());
    }
}
