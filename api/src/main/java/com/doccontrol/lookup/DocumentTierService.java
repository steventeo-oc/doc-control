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
 * Tiers get the same admin CRUD pattern as types and departments (lookup
 * admin plan-back F5). tierNumber is display ordering only — it prefixes
 * nothing — but it is still the tiers' stable sort, so it is set at
 * creation and never patched. Deactivating a tier cascades to nothing:
 * types referencing it keep working (D5/D6).
 */
@Service
public class DocumentTierService {

    private final DocumentTierRepository documentTierRepository;
    private final DocumentTypeRepository documentTypeRepository;
    private final AuditService auditService;

    public DocumentTierService(DocumentTierRepository documentTierRepository,
                               DocumentTypeRepository documentTypeRepository,
                               AuditService auditService) {
        this.documentTierRepository = documentTierRepository;
        this.documentTypeRepository = documentTypeRepository;
        this.auditService = auditService;
    }

    @Transactional
    public DocumentTierDto create(CreateDocumentTierRequest request) {
        if (documentTierRepository.existsByTierNumber(request.tierNumber())) {
            throw new ConflictException("Document tier number " + request.tierNumber() + " already exists.");
        }

        DocumentTier tier = new DocumentTier();
        tier.setTierNumber(request.tierNumber());
        tier.setLabel(request.label());
        tier.setActive(true);
        documentTierRepository.save(tier);

        auditService.record("document_tier", tier.getId(), "created",
                Map.of("tier_number", tier.getTierNumber(), "label", tier.getLabel()));

        return DocumentTierDto.from(tier);
    }

    @Transactional
    public DocumentTierDto update(Integer id, UpdateDocumentTierRequest request) {
        DocumentTier tier = requireTier(id);

        Map<String, Object> before = new LinkedHashMap<>();
        Map<String, Object> after = new LinkedHashMap<>();

        if (request.label() != null && !request.label().equals(tier.getLabel())) {
            before.put("label", tier.getLabel());
            after.put("label", request.label());
            tier.setLabel(request.label());
        }
        if (request.active() != null && request.active() != tier.isActive()) {
            before.put("active", tier.isActive());
            after.put("active", request.active());
            tier.setActive(request.active());
        }

        if (!after.isEmpty()) {
            auditService.record("document_tier", id, "updated", Map.of("before", before, "after", after));
        }

        return DocumentTierDto.from(tier);
    }

    /** Counts powering the tier deactivate confirmation (plan-back F5). */
    @Transactional(readOnly = true)
    public DocumentTierUsageDto usage(Integer id) {
        requireTier(id);
        return new DocumentTierUsageDto(documentTypeRepository.countByTierId(id));
    }

    /**
     * Hard delete (plan-back F5): blocked while any type — including
     * inactive ones — references the tier; nothing cascades, since types
     * are the only reference and they keep working regardless (D5).
     */
    @Transactional
    public void delete(Integer id) {
        DocumentTier tier = requireTier(id);
        long types = documentTypeRepository.countByTierId(id);
        if (types > 0) {
            throw new DeletionBlockedException(
                    types + " document type(s) reference document tier " + tier.getTierNumber()
                            + " — deactivate the tier instead of deleting.",
                    Map.of("documentTypes", types));
        }

        documentTierRepository.delete(tier);

        auditService.record("document_tier", id, "deleted", Map.of(
                "tier_number", tier.getTierNumber(),
                "label", tier.getLabel()));
    }

    private DocumentTier requireTier(Integer id) {
        return documentTierRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Document tier " + id + " not found."));
    }
}
