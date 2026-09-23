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
 * Levels now have the same admin CRUD pattern as types and departments
 * (lookup admin plan-back F5). Reads are open to any authenticated user;
 * writes are admin-only (enforced in SecurityConfig). The list default
 * deliberately flips to active-only to match the other two lookups —
 * includeInactive=true is the admin shape.
 */
@RestController
@RequestMapping("/document-levels")
public class DocumentLevelController {

    private final DocumentLevelRepository documentLevelRepository;
    private final DocumentLevelService documentLevelService;

    public DocumentLevelController(DocumentLevelRepository documentLevelRepository,
                                  DocumentLevelService documentLevelService) {
        this.documentLevelRepository = documentLevelRepository;
        this.documentLevelService = documentLevelService;
    }

    @GetMapping
    public List<DocumentLevelDto> list(
            @RequestParam(value = "includeInactive", required = false, defaultValue = "false")
            boolean includeInactive) {
        return (includeInactive
                ? documentLevelRepository.findAllByOrderByLevelNumberAsc()
                : documentLevelRepository.findAllByActiveTrueOrderByLevelNumberAsc())
                .stream()
                .map(DocumentLevelDto::from)
                .toList();
    }

    @GetMapping("/{id}/usage")
    public DocumentLevelUsageDto usage(@PathVariable Integer id) {
        return documentLevelService.usage(id);
    }

    @PostMapping
    public ResponseEntity<DocumentLevelDto> create(@Valid @RequestBody CreateDocumentLevelRequest request) {
        DocumentLevelDto created = documentLevelService.create(request);
        return ResponseEntity
                .created(URI.create("/document-levels/" + created.id()))
                .body(created);
    }

    @PatchMapping("/{id}")
    public DocumentLevelDto update(@PathVariable Integer id,
                                  @Valid @RequestBody UpdateDocumentLevelRequest request) {
        return documentLevelService.update(id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Integer id) {
        documentLevelService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
