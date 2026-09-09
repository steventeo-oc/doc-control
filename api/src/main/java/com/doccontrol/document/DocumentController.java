package com.doccontrol.document;

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

@RestController
@RequestMapping("/documents")
public class DocumentController {

    private final DocumentService documentService;

    public DocumentController(DocumentService documentService) {
        this.documentService = documentService;
    }

    @GetMapping
    public DocumentsPageDto list(
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String department,
            @RequestParam(required = false) DocumentStatus status,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(name = "page_size", defaultValue = "20") int pageSize) {
        return documentService.list(type, department, status, q, page, pageSize);
    }

    @PostMapping
    public ResponseEntity<DocumentDto> create(@Valid @RequestBody CreateDocumentRequest request) {
        DocumentDto created = documentService.create(request);
        return ResponseEntity
                .created(URI.create("/documents/" + created.id()))
                .body(created);
    }

    @GetMapping("/{id}")
    public DocumentDto get(@PathVariable Integer id) {
        return documentService.get(id);
    }

    @PatchMapping("/{id}")
    public DocumentDto update(@PathVariable Integer id, @Valid @RequestBody UpdateDocumentRequest request) {
        return documentService.update(id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Integer id) {
        documentService.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/restore")
    public DocumentDto restore(@PathVariable Integer id) {
        return documentService.restore(id);
    }
}
