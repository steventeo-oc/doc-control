package com.doccontrol.document;

import com.doccontrol.audit.AuditService;
import com.doccontrol.common.web.ForbiddenException;
import com.doccontrol.common.web.NotFoundException;
import com.doccontrol.security.CurrentUserProvider;
import com.doccontrol.storage.FileStorageService;
import com.doccontrol.storage.FileStorageService.StoredUpload;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.InputStream;
import java.util.List;

/**
 * Version handling. version_number is a system field auto-incremented per
 * document (CLAUDE.md convention 5) — never embedded in or derived from
 * filenames.
 */
@Service
public class DocumentVersionService {

    private final DocumentVersionRepository versionRepository;
    private final DocumentService documentService;
    private final FileStorageService fileStorageService;
    private final AuditService auditService;
    private final CurrentUserProvider currentUserProvider;

    public DocumentVersionService(DocumentVersionRepository versionRepository,
                                  DocumentService documentService,
                                  FileStorageService fileStorageService,
                                  AuditService auditService,
                                  com.doccontrol.security.CurrentUserProvider currentUserProvider) {
        this.versionRepository = versionRepository;
        this.documentService = documentService;
        this.fileStorageService = fileStorageService;
        this.auditService = auditService;
        this.currentUserProvider = currentUserProvider;
    }

    @Transactional
    public DocumentVersionDto upload(Integer documentId, String fileName, String contentType,
                                     long size, InputStream content, String changeNotes,
                                     String changeReference) {
        Document document = documentService.requireVisible(documentId);
        documentService.requireCanEdit(document);

        int versionNumber = versionRepository.findMaxVersionNumber(documentId) + 1;

        String fileReference = fileStorageService.store(new StoredUpload(
                documentId, versionNumber, fileName, contentType, size, content));

        DocumentVersion version = new DocumentVersion();
        version.setDocument(document);
        version.setVersionNumber(versionNumber);
        version.setFileReference(fileReference);
        version.setStatus(DocumentVersionStatus.DRAFT);
        version.setChangeNotes(changeNotes);
        // Phase 2c (Should priority): free-text Change/CAPA reference, recorded
        // as-is — never validated against an external system.
        version.setChangeReference(changeReference);
        version.setUploadedBy(currentUserProvider.getCurrentUser());
        versionRepository.save(version);

        // Deliberately NOT touching document.currentVersion here: an upload
        // must never move the public version pointer of a released document
        // (pilot finding). The pointer changes only on an explicit release
        // via the status override — see DocumentService.update.

        auditService.record("document_version", version.getId(), "created", java.util.Map.of(
                "document_id", documentId,
                "document_number", document.getDocumentNumber(),
                "version_number", versionNumber,
                "file_name", fileReference.substring(fileReference.lastIndexOf('/') + 1),
                "size", size), document.getDepartment());

        return DocumentVersionDto.from(version);
    }

    /**
     * Version history is owner/admin-only beyond the current version: normal
     * viewers of a released document see exactly the version the public sees
     * (pilot finding — drafts in the history leaked unapproved content).
     */
    @Transactional(readOnly = true)
    public List<DocumentVersionDto> list(Integer documentId) {
        Document document = documentService.requireVisible(documentId);
        if (documentService.canEdit(document)) {
            return versionRepository.findAllByDocumentIdOrderByVersionNumberAsc(document.getId()).stream()
                    .map(DocumentVersionDto::from)
                    .toList();
        }
        if (document.getCurrentVersion() == null) {
            return List.of();
        }
        return java.util.stream.Stream.of(document.getCurrentVersion())
                .map(DocumentVersionDto::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public DocumentVersionDto get(Integer documentId, Integer versionId) {
        DocumentVersion version = findVisibleVersion(documentId, versionId);
        return DocumentVersionDto.from(version);
    }

    /**
     * A prepared version download: everything the controller needs,
     * resolved inside the transaction (open-in-view is off — entities may
     * not be touched after this returns). The stream is consumed outside
     * the transaction — object storage, not the DB.
     */
    public record VersionDownload(DocumentVersionStatus versionStatus,
                                  FileStorageService.DownloadedFile file) {
    }

    /**
     * Prepares a version download. The visibility check, and for original
     * downloads the canEdit gate plus the audit row, happen here in the
     * service layer (Phase 2e plan-back flags F2/F7); stamping is
     * WatermarkService's job. Deliberately a read-write transaction: the
     * original-download audit row is an INSERT, and Postgres rejects
     * inserts inside a read-only transaction.
     */
    @Transactional
    public VersionDownload openForDownload(Integer documentId, Integer versionId, boolean original) {
        DocumentVersion version = findVisibleVersion(documentId, versionId);
        if (original) {
            Document document = version.getDocument();
            if (!documentService.canEdit(document)) {
                throw new ForbiddenException(
                        "Only members of the document's department (or an admin) can download the original file.");
            }
            // An unstamped original leaving the system is control-relevant
            // (plan-back flag F2); rendition downloads stay unaudited.
            auditService.record("document_version", version.getId(), "original_downloaded",
                    java.util.Map.of(
                            "document_number", document.getDocumentNumber(),
                            "version_number", version.getVersionNumber()), document.getDepartment());
        }
        return new VersionDownload(version.getStatus(),
                fileStorageService.open(version.getFileReference()));
    }

    private DocumentVersion findVisibleVersion(Integer documentId, Integer versionId) {
        Document document = documentService.requireVisible(documentId);
        DocumentVersion version = versionRepository.findById(versionId)
                .orElseThrow(() -> new NotFoundException("Version " + versionId + " not found."));
        if (!version.getDocument().getId().equals(documentId)) {
            throw new NotFoundException("Version " + versionId + " not found.");
        }
        // Non-owner/non-admin viewers only know about the version the public
        // sees — anything else 404s (existence not leaked), matching the
        // document-level visibility pattern.
        if (!documentService.canEdit(document)
                && document.getCurrentVersion() != null
                && !versionId.equals(document.getCurrentVersion().getId())) {
            throw new NotFoundException("Version " + versionId + " not found.");
        }
        return version;
    }
}
