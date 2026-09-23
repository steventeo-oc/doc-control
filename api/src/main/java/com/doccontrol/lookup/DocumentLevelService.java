package com.doccontrol.lookup;

import com.doccontrol.audit.AuditService;
import com.doccontrol.common.web.ConflictException;
import com.doccontrol.common.web.DeletionBlockedException;
import com.doccontrol.common.web.NotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Levels get the same admin CRUD pattern as types and departments (lookup
 * admin plan-back F5). levelNumber is display ordering only — it prefixes
 * nothing — but it is still the levels' stable sort, so it is set at
 * creation and never patched. Deactivating a level cascades to nothing:
 * types referencing it keep working (D5/D6).
 */
@Service
public class DocumentLevelService {

    private final DocumentLevelRepository documentLevelRepository;
    private final DocumentTypeRepository documentTypeRepository;
    private final AuditService auditService;

    public DocumentLevelService(DocumentLevelRepository documentLevelRepository,
                               DocumentTypeRepository documentTypeRepository,
                               AuditService auditService) {
        this.documentLevelRepository = documentLevelRepository;
        this.documentTypeRepository = documentTypeRepository;
        this.auditService = auditService;
    }

    @Transactional
    public DocumentLevelDto create(CreateDocumentLevelRequest request) {
        if (documentLevelRepository.existsByLevelNumber(request.levelNumber())) {
            throw new ConflictException("Document level number " + request.levelNumber() + " already exists.");
        }

        DocumentLevel level = new DocumentLevel();
        level.setLevelNumber(request.levelNumber());
        level.setLabel(request.label());
        level.setActive(true);
        documentLevelRepository.save(level);

        auditService.record("document_level", level.getId(), "created",
                Map.of("level_number", level.getLevelNumber(), "label", level.getLabel()));

        return DocumentLevelDto.from(level);
    }

    @Transactional
    public DocumentLevelDto update(Integer id, UpdateDocumentLevelRequest request) {
        DocumentLevel level = requireLevel(id);

        Map<String, Object> before = new LinkedHashMap<>();
        Map<String, Object> after = new LinkedHashMap<>();

        if (request.label() != null && !request.label().equals(level.getLabel())) {
            before.put("label", level.getLabel());
            after.put("label", request.label());
            level.setLabel(request.label());
        }
        if (request.active() != null && request.active() != level.isActive()) {
            before.put("active", level.isActive());
            after.put("active", request.active());
            level.setActive(request.active());
        }

        if (!after.isEmpty()) {
            auditService.record("document_level", id, "updated", Map.of("before", before, "after", after));
        }

        return DocumentLevelDto.from(level);
    }

    /** Counts powering the level deactivate confirmation (plan-back F5). */
    @Transactional(readOnly = true)
    public DocumentLevelUsageDto usage(Integer id) {
        requireLevel(id);
        return new DocumentLevelUsageDto(documentTypeRepository.countByLevelId(id));
    }

    /**
     * Hard delete (plan-back F5): blocked while any type — including
     * inactive ones — references the level; nothing cascades, since types
     * are the only reference and they keep working regardless (D5).
     */
    @Transactional
    public void delete(Integer id) {
        DocumentLevel level = requireLevel(id);
        long types = documentTypeRepository.countByLevelId(id);
        if (types > 0) {
            throw new DeletionBlockedException(
                    types + " document type(s) reference document level " + level.getLevelNumber()
                            + " — deactivate the level instead of deleting.",
                    Map.of("documentTypes", types));
        }

        documentLevelRepository.delete(level);

        auditService.record("document_level", id, "deleted", Map.of(
                "level_number", level.getLevelNumber(),
                "label", level.getLabel()));
    }

    private DocumentLevel requireLevel(Integer id) {
        return documentLevelRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Document level " + id + " not found."));
    }
}
