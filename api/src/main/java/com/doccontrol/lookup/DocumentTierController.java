package com.doccontrol.lookup;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.List;

/**
 * Tiers now have the same admin CRUD pattern as types and departments
 * (lookup admin plan-back F5). Reads are open to any authenticated user;
 * writes are admin-only (enforced in SecurityConfig). The list default
 * deliberately flips to active-only to match the other two lookups —
 * includeInactive=true is the admin shape.
 */
@RestController
@RequestMapping("/document-tiers")
public class DocumentTierController {

    private final DocumentTierRepository documentTierRepository;
    private final DocumentTierService documentTierService;

    public DocumentTierController(DocumentTierRepository documentTierRepository,
                                  DocumentTierService documentTierService) {
        this.documentTierRepository = documentTierRepository;
        this.documentTierService = documentTierService;
    }

    @GetMapping
    public List<DocumentTierDto> list(
            @RequestParam(value = "includeInactive", required = false, defaultValue = "false")
            boolean includeInactive) {
        return (includeInactive
                ? documentTierRepository.findAllByOrderByTierNumberAsc()
                : documentTierRepository.findAllByActiveTrueOrderByTierNumberAsc())
                .stream()
                .map(DocumentTierDto::from)
                .toList();
    }

    @GetMapping("/{id}/usage")
    public DocumentTierUsageDto usage(@PathVariable Integer id) {
        return documentTierService.usage(id);
    }

    @PostMapping
    public ResponseEntity<DocumentTierDto> create(@Valid @RequestBody CreateDocumentTierRequest request) {
        DocumentTierDto created = documentTierService.create(request);
        return ResponseEntity
                .created(URI.create("/document-tiers/" + created.id()))
                .body(created);
    }

    @PatchMapping("/{id}")
    public DocumentTierDto update(@PathVariable Integer id,
                                  @Valid @RequestBody UpdateDocumentTierRequest request) {
        return documentTierService.update(id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Integer id) {
        documentTierService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
