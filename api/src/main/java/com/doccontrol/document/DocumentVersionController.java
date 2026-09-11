package com.doccontrol.document;

import com.doccontrol.storage.FileStorageService.DownloadedFile;
import com.doccontrol.watermark.WatermarkService;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
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
    private final WatermarkService watermarkService;

    public DocumentVersionController(DocumentVersionService versionService,
                                     WatermarkService watermarkService) {
        this.versionService = versionService;
        this.watermarkService = watermarkService;
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

    /**
     * Downloads a version. Default: a stamped PDF rendition when
     * watermarking applies (Phase 2e plan-back F1 matrix), the original
     * otherwise. {@code original=true} is the audited owner/admin escape
     * hatch for the untouched file (flag F2).
     */
    @GetMapping("/documents/{id}/versions/{versionId}/download")
    public ResponseEntity<Resource> download(@PathVariable Integer id,
                                             @PathVariable Integer versionId,
                                             @RequestParam(value = "original", required = false,
                                                     defaultValue = "false") boolean original) {
        DocumentVersionService.VersionDownload download =
                versionService.openForDownload(id, versionId, original);
        // original=true never goes near the stamping pipeline — the escape
        // hatch must return the untouched file (plan-back flag F2)
        WatermarkService.StampedDownload stamped = original
                ? null
                : watermarkService.stampForDownload(download.versionStatus(), download.file());
        if (stamped != null) {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentDisposition(ContentDisposition.attachment()
                    .filename(stamped.fileName(), StandardCharsets.UTF_8)
                    .build());
            return ResponseEntity.ok()
                    .headers(headers)
                    .contentLength(stamped.pdf().length)
                    .contentType(MediaType.APPLICATION_PDF)
                    .body(new ByteArrayResource(stamped.pdf()));
        }
        DownloadedFile file = download.file();
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
