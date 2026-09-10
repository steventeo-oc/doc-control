package com.doccontrol.document;

import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.net.URI;

@RestController
public class DocumentController {

    private final DocumentService documentService;
    private final DocumentVersionService documentVersionService;

    public DocumentController(DocumentService documentService, DocumentVersionService documentVersionService) {
        this.documentService = documentService;
        this.documentVersionService = documentVersionService;
    }

    @GetMapping("/documents")
    public DocumentsPageDto list(
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String department,
            @RequestParam(required = false) DocumentStatus status,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Boolean review_overdue,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(name = "page_size", defaultValue = "20") int pageSize) {
        return documentService.list(type, department, status, q, review_overdue, page, pageSize);
    }

    /**
     * Multipart per the API spec: metadata plus an optional file. A file on
     * create becomes version 1; current_version_id stays null until the
     * document is explicitly released (see CLAUDE.md — the spec's create
     * example predates that decision).
     */
    @PostMapping(value = "/documents", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<DocumentDto> create(
            @RequestParam("document_type_id") Integer documentTypeId,
            @RequestParam("department_id") Integer departmentId,
            @RequestParam("name") String name,
            @RequestParam(value = "file", required = false) MultipartFile file) throws IOException {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("name is required");
        }
        DocumentDto created = documentService.create(documentTypeId, departmentId, name.trim());
        if (file != null && !file.isEmpty()) {
            documentVersionService.upload(created.id(), file.getOriginalFilename(), file.getContentType(),
                    file.getSize(), file.getInputStream(), null, null);
        }
        return ResponseEntity
                .created(URI.create("/documents/" + created.id()))
                .body(created);
    }

    @GetMapping("/documents/{id}")
    public DocumentDto get(@PathVariable Integer id) {
        return documentService.get(id);
    }

    @PatchMapping("/documents/{id}")
    public DocumentDto update(@PathVariable Integer id, @Valid @RequestBody UpdateDocumentRequest request) {
        return documentService.update(id, request);
    }

    @DeleteMapping("/documents/{id}")
    public ResponseEntity<Void> delete(@PathVariable Integer id) {
        documentService.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/documents/{id}/restore")
    public DocumentDto restore(@PathVariable Integer id) {
        return documentService.restore(id);
    }
}
