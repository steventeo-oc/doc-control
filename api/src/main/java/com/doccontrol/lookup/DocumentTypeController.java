package com.doccontrol.lookup;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.List;

/**
 * Reads are open to any authenticated user; writes are admin-only (enforced
 * in SecurityConfig, see the /document-types/** rule).
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

    @GetMapping
    public List<DocumentTypeDto> list() {
        return documentTypeRepository.findAllByActiveTrueOrderByCodeAsc().stream()
                .map(DocumentTypeDto::from)
                .toList();
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
}
