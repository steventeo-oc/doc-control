package com.doccontrol.document;

import com.doccontrol.audit.AuditService;
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
                                     long size, InputStream content, String changeNotes) {
        Document document = documentService.requireVisible(documentId);
        documentService.requireCanModify(document);

        int versionNumber = versionRepository.findMaxVersionNumber(documentId) + 1;

        String fileReference = fileStorageService.store(new StoredUpload(
                documentId, versionNumber, fileName, contentType, size, content));

        DocumentVersion version = new DocumentVersion();
        version.setDocument(document);
        version.setVersionNumber(versionNumber);
        version.setFileReference(fileReference);
        version.setStatus(DocumentVersionStatus.DRAFT);
        version.setChangeNotes(changeNotes);
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
                "size", size));

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
        if (documentService.canModify(document)) {
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
     * Opens the stored file for streaming. The visibility check happens here
     * (service layer); the returned stream is read by the controller outside
     * the transaction — object storage, not the DB.
     */
    @Transactional(readOnly = true)
    public FileStorageService.DownloadedFile openForDownload(Integer documentId, Integer versionId) {
        DocumentVersion version = findVisibleVersion(documentId, versionId);
        return fileStorageService.open(version.getFileReference());
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
        if (!documentService.canModify(document)
                && document.getCurrentVersion() != null
                && !versionId.equals(document.getCurrentVersion().getId())) {
            throw new NotFoundException("Version " + versionId + " not found.");
        }
        return version;
    }
}
