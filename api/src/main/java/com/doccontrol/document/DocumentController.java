package com.doccontrol.document;

import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
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
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;

@RestController
public class DocumentController {

    private final DocumentService documentService;
    private final DocumentVersionService documentVersionService;

    public DocumentController(DocumentService documentService, DocumentVersionService documentVersionService) {
        this.documentService = documentService;
        this.documentVersionService = documentVersionService;
    }

    private static final String CSV_HEADER =
            "document_number,title,status,progress,level,type,department,owner,next_review_due,review_overdue,created_at,updated_at";

    @GetMapping("/documents")
    public DocumentsPageDto list(
            @RequestParam(required = false) String type,
            @RequestParam(required = false) Integer level,
            @RequestParam(required = false) String department,
            @RequestParam(required = false) DocumentStatus status,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Boolean review_overdue,
            @RequestParam(required = false) Boolean trashed,
            @RequestParam(required = false) Boolean archived,
            @RequestParam(required = false) String owner,
            @RequestParam(required = false) Boolean favorite,
            @RequestParam(required = false) String sort,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(name = "page_size", defaultValue = "20") int pageSize) {
        return documentService.list(type, level, department, status, q, review_overdue, trashed, archived, owner, favorite, sort,
                page, pageSize);
    }

    @GetMapping("/documents/export")
    public ResponseEntity<String> export(
            @RequestParam(required = false) String type,
            @RequestParam(required = false) Integer level,
            @RequestParam(required = false) String department,
            @RequestParam(required = false) DocumentStatus status,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Boolean review_overdue,
            @RequestParam(required = false) Boolean trashed,
            @RequestParam(required = false) Boolean archived,
            @RequestParam(required = false) String owner,
            @RequestParam(required = false) Boolean favorite,
            @RequestParam(required = false) String sort) {
        List<DocumentSummaryDto> rows = documentService.exportRows(type, level, department, status, q,
                review_overdue, trashed, archived, owner, favorite, sort);

        StringBuilder csv = new StringBuilder("\uFEFF").append(CSV_HEADER).append("\r\n");
        for (DocumentSummaryDto row : rows) {
            String progress = "";
            if ("IN_REVIEW".equals(row.revisionStatus())) {
                progress = "v" + row.revisionVersionNumber() + " in review";
            } else if ("DRAFT".equals(row.revisionStatus())) {
                progress = "v" + row.revisionVersionNumber() + " draft";
            } else if ("RE_APPROVAL".equals(row.revisionStatus())) {
                progress = "re-approval";
            }

            String levelStr = row.levelNumber() == null ? "" : "Level " + row.levelNumber()
                    + (row.levelLabel() != null && !row.levelLabel().isBlank() ? " (" + row.levelLabel() + ")" : "");

            csv.append(csvField(row.documentNumber())).append(',')
                    .append(csvField(row.name())).append(',')
                    .append(csvField(row.status())).append(',')
                    .append(csvField(progress)).append(',')
                    .append(csvField(levelStr)).append(',')
                    .append(csvField(row.documentTypeCode())).append(',')
                    .append(csvField(row.departmentCode())).append(',')
                    .append(csvField(row.ownerName())).append(',')
                    .append(csvField(row.nextReviewDue() == null ? "" : row.nextReviewDue().toString())).append(',')
                    .append(csvField(row.reviewOverdue() ? "YES" : "NO")).append(',')
                    .append(csvField(row.createdAt() == null ? "" : row.createdAt().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")))).append(',')
                    .append(csvField(row.updatedAt() == null ? "" : row.updatedAt().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))))
                    .append("\r\n");
        }

        String filename = "documents-" + LocalDate.now() + ".csv";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(MediaType.valueOf("text/csv; charset=UTF-8"))
                .body(csv.toString());
    }

    private static String csvField(String value) {
        if (value == null) {
            return "";
        }
        if (value.contains(",") || value.contains("\"") || value.contains("\n") || value.contains("\r")) {
            return '"' + value.replace("\"", "\"\"") + '"';
        }
        return value;
    }

    @PostMapping("/documents/{id}/favorite")
    public ResponseEntity<Void> favorite(@PathVariable Integer id) {
        documentService.favorite(id);
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/documents/{id}/favorite")
    public ResponseEntity<Void> unfavorite(@PathVariable Integer id) {
        documentService.unfavorite(id);
        return ResponseEntity.noContent().build();
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

    @GetMapping("/documents/next-number")
    public DocumentNumberPreviewDto previewNextNumber(
            @RequestParam("document_type_id") Integer documentTypeId,
            @RequestParam(value = "department_id", required = false) Integer departmentId) {
        return documentService.previewNextNumber(documentTypeId, departmentId);
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

    @GetMapping("/documents/{id}/activity")
    public java.util.List<DocumentActivityDto> activity(@PathVariable Integer id) {
        return documentService.documentActivity(id);
    }

    public record DocumentReasonRequest(String reason) {}

    @PostMapping("/documents/{id}/obsolete")
    public ResponseEntity<Void> markObsolete(@PathVariable Integer id, @RequestBody(required = false) DocumentReasonRequest body) {
        documentService.markObsolete(id, body != null ? body.reason() : null);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/documents/{id}/reactivate")
    public ResponseEntity<Void> reactivate(@PathVariable Integer id, @RequestBody(required = false) DocumentReasonRequest body) {
        documentService.reactivate(id, body != null ? body.reason() : null);
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/documents/{id}/draft")
    public ResponseEntity<Void> discardDraftDocument(@PathVariable Integer id) {
        documentService.discardDraftDocument(id);
        return ResponseEntity.noContent().build();
    }
}
