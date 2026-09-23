package com.doccontrol.lookup;

import com.doccontrol.audit.AuditService;
import com.doccontrol.common.web.ConflictException;
import com.doccontrol.common.web.DeletionBlockedException;
import com.doccontrol.common.web.NotFoundException;
import com.doccontrol.document.DocumentRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class DocumentTypeService {

    private final DocumentTypeRepository documentTypeRepository;
    private final DocumentLevelRepository documentLevelRepository;
    private final DocumentRepository documentRepository;
    private final DocumentSequenceCounterRepository documentSequenceCounterRepository;
    private final AuditService auditService;

    public DocumentTypeService(DocumentTypeRepository documentTypeRepository,
                               DocumentLevelRepository documentLevelRepository,
                               DocumentRepository documentRepository,
                               DocumentSequenceCounterRepository documentSequenceCounterRepository,
                               AuditService auditService) {
        this.documentTypeRepository = documentTypeRepository;
        this.documentLevelRepository = documentLevelRepository;
        this.documentRepository = documentRepository;
        this.documentSequenceCounterRepository = documentSequenceCounterRepository;
        this.auditService = auditService;
    }

    @Transactional
    public DocumentTypeDto create(CreateDocumentTypeRequest request) {
        DocumentLevel level = documentLevelRepository.findById(request.levelId())
                .orElseThrow(() -> new NotFoundException("Document level " + request.levelId() + " not found."));

        if (documentTypeRepository.existsByCode(request.code())) {
            throw new ConflictException("Document type code '" + request.code() + "' already exists.");
        }

        DocumentType type = new DocumentType();
        type.setCode(request.code());
        type.setLabel(request.label());
        type.setLevel(level);
        type.setActive(true);
        documentTypeRepository.save(type);

        auditService.record("document_type", type.getId(), "created",
                Map.of("code", type.getCode(), "label", type.getLabel(), "level_id", level.getId()));

        return DocumentTypeDto.from(type);
    }

    @Transactional
    public DocumentTypeDto update(Integer id, UpdateDocumentTypeRequest request) {
        DocumentType type = requireType(id);

        Map<String, Object> before = new LinkedHashMap<>();
        Map<String, Object> after = new LinkedHashMap<>();

        if (request.label() != null && !request.label().equals(type.getLabel())) {
            before.put("label", type.getLabel());
            after.put("label", request.label());
            type.setLabel(request.label());
        }
        if (request.levelId() != null && !request.levelId().equals(type.getLevel().getId())) {
            DocumentLevel level = documentLevelRepository.findById(request.levelId())
                    .orElseThrow(() -> new NotFoundException("Document level " + request.levelId() + " not found."));
            before.put("level_id", type.getLevel().getId());
            after.put("level_id", level.getId());
            type.setLevel(level);
        }
        if (request.active() != null && request.active() != type.isActive()) {
            before.put("active", type.isActive());
            after.put("active", request.active());
            type.setActive(request.active());
        }

        if (!after.isEmpty()) {
            auditService.record("document_type", id, "updated", Map.of("before", before, "after", after));
        }

        return DocumentTypeDto.from(type);
    }

    /** Counts powering the deactivate confirmation (plan-back F1). */
    @Transactional(readOnly = true)
    public DocumentTypeUsageDto usage(Integer id) {
        requireType(id);
        return new DocumentTypeUsageDto(documentRepository.countByDocumentTypeId(id));
    }

    /**
     * Hard delete (plan-back F4): blocked while any document — including
     * soft-deleted ones — references the type; otherwise its
     * sequence-counter bookkeeping rows go with it.
     */
    @Transactional
    public void delete(Integer id) {
        DocumentType type = requireType(id);
        long documents = documentRepository.countByDocumentTypeId(id);
        if (documents > 0) {
            throw new DeletionBlockedException(
                    documents + " document(s) (including soft-deleted) reference document type '"
                            + type.getCode() + "' — deactivate it instead of deleting.",
                    Map.of("documents", documents));
        }

        long counters = documentSequenceCounterRepository.deleteByDocumentTypeId(id);
        documentTypeRepository.delete(type);

        auditService.record("document_type", id, "deleted", Map.of(
                "code", type.getCode(),
                "label", type.getLabel(),
                "removed_sequence_counters", counters));
    }

    private DocumentType requireType(Integer id) {
        return documentTypeRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Document type " + id + " not found."));
    }
}
