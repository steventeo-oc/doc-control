package com.doccontrol.document;

import com.doccontrol.storage.FileStorageService.DownloadedFile;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;

@RestController
public class DocumentVersionController {

    private final DocumentVersionService versionService;

    public DocumentVersionController(DocumentVersionService versionService) {
        this.versionService = versionService;
    }

    @GetMapping("/documents/{id}/versions")
    public List<DocumentVersionDto> list(@PathVariable Integer id) {
        return versionService.list(id);
    }

    @PostMapping(value = "/documents/{id}/versions", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public DocumentVersionDto upload(@PathVariable Integer id,
                                     @RequestParam("file") MultipartFile file,
                                     @RequestParam(value = "change_notes", required = false) String changeNotes,
                                     @RequestParam(value = "change_reference", required = false) String changeReference) throws IOException {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("file is required");
        }
        return versionService.upload(id, file.getOriginalFilename(), file.getContentType(),
                file.getSize(), file.getInputStream(), changeNotes, changeReference);
    }

    @GetMapping("/documents/{id}/versions/{versionId}")
    public DocumentVersionDto get(@PathVariable Integer id, @PathVariable Integer versionId) {
        return versionService.get(id, versionId);
    }

    @GetMapping("/documents/{id}/versions/{versionId}/download")
    public ResponseEntity<InputStreamResource> download(@PathVariable Integer id,
                                                        @PathVariable Integer versionId) {
        DownloadedFile file = versionService.openForDownload(id, versionId);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentDisposition(ContentDisposition.attachment()
                .filename(file.fileName(), StandardCharsets.UTF_8)
                .build());
        return ResponseEntity.ok()
                .headers(headers)
                .contentLength(file.size())
                .contentType(MediaType.parseMediaType(
                        file.contentType() == null ? "application/octet-stream" : file.contentType()))
                .body(new InputStreamResource(file.content()));
    }
}
