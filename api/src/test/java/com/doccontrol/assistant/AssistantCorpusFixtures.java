package com.doccontrol.assistant;

import com.doccontrol.document.Document;
import com.doccontrol.document.DocumentRepository;
import com.doccontrol.document.DocumentService;
import com.doccontrol.document.DocumentStatus;
import com.doccontrol.document.DocumentVersion;
import com.doccontrol.document.DocumentVersionRepository;
import com.doccontrol.document.DocumentVersionStatus;
import com.doccontrol.identity.User;
import com.doccontrol.lookup.Department;
import com.doccontrol.lookup.DocumentType;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * One document per lifecycle state, shared by the two assistant contract tests. Promotions and deferred
 * approvals go through the same {@link DocumentService} calls the approval engine and the daily job use, so the
 * fixtures follow the pointer rules the application really applies; the states with no service entry point
 * (draft, in review, obsolete, trashed) are set directly on the entity.
 *
 * Every document number starts with {@link #prefix}, so a test can ignore rows it did not create.
 */
final class AssistantCorpusFixtures {

    /** {@code shown} is the version the view must list for the document; null means it must not appear at all. */
    record Case(Document document, DocumentVersion shown) {
    }

    final String prefix = "AV" + System.nanoTime() % 1_000_000;
    final Map<String, Case> cases = new LinkedHashMap<>();
    final LocalDate today = LocalDate.now();

    private final DocumentRepository documents;
    private final DocumentVersionRepository versions;
    private final DocumentService documentService;
    private final DocumentType type;
    private final Department department;
    private final User actor;

    AssistantCorpusFixtures(DocumentRepository documents, DocumentVersionRepository versions,
                            DocumentService documentService, DocumentType type, Department department, User actor) {
        this.documents = documents;
        this.versions = versions;
        this.documentService = documentService;
        this.type = type;
        this.department = department;
        this.actor = actor;
        build();
    }

    DocumentType type() {
        return type;
    }

    Department department() {
        return department;
    }

    private void build() {
        // released: the plain case
        Document released = document("released", DocumentStatus.DRAFT);
        DocumentVersion releasedV1 = version(released, 1, DocumentVersionStatus.DRAFT);
        promote(releasedV1);
        cases.put("released", new Case(released, releasedV1));

        // two promotions and a later draft: only the newest promoted version is the current one
        Document twice = document("two-versions", DocumentStatus.DRAFT);
        promote(version(twice, 1, DocumentVersionStatus.DRAFT));
        DocumentVersion twiceV2 = version(twice, 2, DocumentVersionStatus.DRAFT);
        promote(twiceV2);
        version(twice, 3, DocumentVersionStatus.DRAFT);
        cases.put("two-versions", new Case(twice, twiceV2));

        // approved with a pointer: a re-approval waiting for its effective date; the in-effect version stays
        Document pending = document("approved-with-pointer", DocumentStatus.DRAFT);
        DocumentVersion pendingV1 = version(pending, 1, DocumentVersionStatus.DRAFT);
        promote(pendingV1);
        DocumentVersion pendingV2 = version(pending, 2, DocumentVersionStatus.DRAFT);
        documentService.approveVersionPendingEffectivity(pendingV2, today.plusDays(10), actor);
        cases.put("approved-with-pointer", new Case(pending, pendingV1));

        // approved without a pointer: a first release that has not taken effect yet
        Document firstPending = document("approved-no-pointer", DocumentStatus.DRAFT);
        documentService.approveVersionPendingEffectivity(
                version(firstPending, 1, DocumentVersionStatus.DRAFT), today.plusDays(10), actor);
        cases.put("approved-no-pointer", new Case(firstPending, null));

        // never released
        Document draft = document("draft", DocumentStatus.DRAFT);
        version(draft, 1, DocumentVersionStatus.DRAFT);
        cases.put("draft", new Case(draft, null));

        Document inReview = document("in-review", DocumentStatus.IN_REVIEW);
        version(inReview, 1, DocumentVersionStatus.DRAFT);
        cases.put("in-review", new Case(inReview, null));

        // retired: this keeps a pointer, so it is the status that has to exclude it
        cases.put("obsolete", retired("obsolete", DocumentStatus.OBSOLETE));

        // trashed while released
        Document trashed = document("trashed", DocumentStatus.DRAFT);
        promote(version(trashed, 1, DocumentVersionStatus.DRAFT));
        trashed.setDeletedAt(LocalDateTime.now());
        cases.put("trashed", new Case(trashed, null));
    }

    private Case retired(String label, DocumentStatus status) {
        Document document = document(label, DocumentStatus.DRAFT);
        promote(version(document, 1, DocumentVersionStatus.DRAFT));
        document.setStatus(status);
        return new Case(document, null);
    }

    Document document(String label, DocumentStatus status) {
        Document document = new Document();
        document.setDocumentNumber(prefix + "-" + label);
        document.setDocumentType(type);
        document.setDepartment(department);
        document.setSequenceNumber(9000 + cases.size());
        document.setName("Assistant view test " + label);
        document.setStatus(status);
        document.setOwner(actor);
        return documents.save(document);
    }

    DocumentVersion version(Document document, int number, DocumentVersionStatus status) {
        DocumentVersion version = new DocumentVersion();
        version.setDocument(document);
        version.setVersionNumber(number);
        version.setFileReference("documents/" + document.getId() + "/" + number + "/" + prefix + "-v" + number + ".docx");
        version.setStatus(status);
        version.setUploadedBy(actor);
        return versions.save(version);
    }

    /** The engine's own promotion: moves the pointer, marks the old version obsolete, releases the document. */
    void promote(DocumentVersion version) {
        documentService.promoteVersion(version, today, actor);
    }
}
