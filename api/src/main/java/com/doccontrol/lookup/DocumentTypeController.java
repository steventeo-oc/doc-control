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
 * Reads are open to any authenticated user; writes are admin-only (enforced
 * in SecurityConfig, see the /document-types/** rule — usage reads too, so
 * the deactivate/delete confirmation numbers match the write surface).
 */
@RestController
@RequestMapping("/document-types")
public class DocumentTypeController {

    private final DocumentTypeRepository documentTypeRepository;
    private final DocumentTypeService documentTypeService;

    public DocumentTypeController(DocumentTypeRepository documentTypeRepository,
                                  DocumentTypeService documentTypeService) {
        this.documentTypeRepository = documentTypeRepository;
        this.documentTypeService = documentTypeService;
    }

    /**
     * Active rows only by default; `includeInactive=true` is the admin and
     * filter shape (plan-back F2) — deactivated types stay visible for
     * reactivation and for searching the documents that reference them.
     */
    @GetMapping
    public List<DocumentTypeDto> list(
            @RequestParam(value = "includeInactive", required = false, defaultValue = "false")
            boolean includeInactive) {
        return (includeInactive
                ? documentTypeRepository.findAllByOrderByCodeAsc()
                : documentTypeRepository.findAllByActiveTrueOrderByCodeAsc())
                .stream()
                .map(DocumentTypeDto::from)
                .toList();
    }

    @GetMapping("/{id}/usage")
    public DocumentTypeUsageDto usage(@PathVariable Integer id) {
        return documentTypeService.usage(id);
    }

    @PostMapping
    public ResponseEntity<DocumentTypeDto> create(@Valid @RequestBody CreateDocumentTypeRequest request) {
        DocumentTypeDto created = documentTypeService.create(request);
        return ResponseEntity
                .created(URI.create("/document-types/" + created.id()))
                .body(created);
    }

    @PatchMapping("/{id}")
    public DocumentTypeDto update(@PathVariable Integer id,
                                  @Valid @RequestBody UpdateDocumentTypeRequest request) {
        return documentTypeService.update(id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Integer id) {
        documentTypeService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
