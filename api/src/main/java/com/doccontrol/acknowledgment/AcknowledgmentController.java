package com.doccontrol.acknowledgment;

import com.doccontrol.acknowledgment.dto.AcknowledgmentAccessDto;
import com.doccontrol.acknowledgment.dto.AcknowledgmentDto;
import com.doccontrol.acknowledgment.dto.AcknowledgmentStatusDto;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Read &amp; understood acknowledgment endpoints (Phase 2d). Record-only:
 * acknowledging is open to the document's department, status visibility to
 * owner/admin/granted users, and nothing is gated anywhere.
 */
@RestController
public class AcknowledgmentController {

    private final AcknowledgmentService acknowledgmentService;

    public AcknowledgmentController(AcknowledgmentService acknowledgmentService) {
        this.acknowledgmentService = acknowledgmentService;
    }

    @PostMapping("/documents/{id}/acknowledge")
    public AcknowledgmentDto acknowledge(@PathVariable Integer id) {
        return acknowledgmentService.acknowledge(id);
    }

    @GetMapping("/documents/{id}/acknowledgments")
    public AcknowledgmentStatusDto status(@PathVariable Integer id) {
        return acknowledgmentService.status(id);
    }

    @GetMapping("/documents/{id}/acknowledgments/access")
    public List<AcknowledgmentAccessDto> listAccess(@PathVariable Integer id) {
        return acknowledgmentService.listAccess(id);
    }

    public record GrantAccessRequest(@NotNull Integer userId) {
    }

    @PostMapping("/documents/{id}/acknowledgments/access")
    public AcknowledgmentAccessDto grant(@PathVariable Integer id,
                                         @RequestBody GrantAccessRequest request) {
        return acknowledgmentService.grant(id, request.userId());
    }

    @DeleteMapping("/documents/{id}/acknowledgments/access/{userId}")
    public ResponseEntity<Void> revoke(@PathVariable Integer id, @PathVariable Integer userId) {
        acknowledgmentService.revoke(id, userId);
        return ResponseEntity.noContent().build();
    }
}
