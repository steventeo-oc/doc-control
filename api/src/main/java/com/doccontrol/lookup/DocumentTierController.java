package com.doccontrol.lookup;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Read-only per the API spec — tiers have no create/patch endpoints in
 * Sprint 1.
 */
@RestController
@RequestMapping("/document-tiers")
public class DocumentTierController {

    private final DocumentTierRepository documentTierRepository;

    public DocumentTierController(DocumentTierRepository documentTierRepository) {
        this.documentTierRepository = documentTierRepository;
    }

    @GetMapping
    public List<DocumentTierDto> list() {
        return documentTierRepository.findAllByOrderByTierNumberAsc().stream()
                .map(DocumentTierDto::from)
                .toList();
    }
}
