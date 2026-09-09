package com.doccontrol.lookup;

import com.doccontrol.audit.AuditService;
import com.doccontrol.common.web.ConflictException;
import com.doccontrol.common.web.NotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class DocumentTypeService {

    private final DocumentTypeRepository documentTypeRepository;
    private final DocumentTierRepository documentTierRepository;
    private final AuditService auditService;

    public DocumentTypeService(DocumentTypeRepository documentTypeRepository,
                               DocumentTierRepository documentTierRepository,
                               AuditService auditService) {
        this.documentTypeRepository = documentTypeRepository;
        this.documentTierRepository = documentTierRepository;
        this.auditService = auditService;
    }

    @Transactional
    public DocumentTypeDto create(CreateDocumentTypeRequest request) {
        DocumentTier tier = documentTierRepository.findById(request.tierId())
                .orElseThrow(() -> new NotFoundException("Document tier " + request.tierId() + " not found."));

        if (documentTypeRepository.existsByCode(request.code())) {
            throw new ConflictException("Document type code '" + request.code() + "' already exists.");
        }

        DocumentType type = new DocumentType();
        type.setCode(request.code());
        type.setLabel(request.label());
        type.setTier(tier);
        type.setActive(true);
        documentTypeRepository.save(type);

        auditService.record("document_type", type.getId(), "created",
                Map.of("code", type.getCode(), "label", type.getLabel(), "tier_id", tier.getId()));

        return DocumentTypeDto.from(type);
    }

    @Transactional
    public DocumentTypeDto update(Integer id, UpdateDocumentTypeRequest request) {
        DocumentType type = documentTypeRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Document type " + id + " not found."));

        Map<String, Object> before = new LinkedHashMap<>();
        Map<String, Object> after = new LinkedHashMap<>();

        if (request.label() != null && !request.label().equals(type.getLabel())) {
            before.put("label", type.getLabel());
            after.put("label", request.label());
            type.setLabel(request.label());
        }
        if (request.tierId() != null && !request.tierId().equals(type.getTier().getId())) {
            DocumentTier tier = documentTierRepository.findById(request.tierId())
                    .orElseThrow(() -> new NotFoundException("Document tier " + request.tierId() + " not found."));
            before.put("tier_id", type.getTier().getId());
            after.put("tier_id", tier.getId());
            type.setTier(tier);
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
}
