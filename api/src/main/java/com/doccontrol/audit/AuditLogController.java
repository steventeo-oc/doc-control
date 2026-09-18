package com.doccontrol.audit;

import com.doccontrol.identity.User;
import com.doccontrol.security.CurrentUserProvider;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * The permission-scoped audit-log query (activity plan-back, approved
 * 2026-09-14) — the API spec's Sprint 4 GET /audit-log, extended to all
 * authenticated users: scope defaults to the caller's own rows, and the
 * service refuses company scope for non-admins (403). The admin-only CSV
 * export lives at GET /audit-log/export (route-protected like /admin/**)
 * and is the ISO 9001 evidence surface the go-live checklist asked for.
 */
@RestController
@RequestMapping("/audit-log")
public class AuditLogController {

    private static final String CSV_HEADER =
            "performed_at,actor_name,actor_email,entity_type,action,entity_id,department_code,details";

    private final AuditLogQueryService queryService;
    private final CurrentUserProvider currentUserProvider;

    public AuditLogController(AuditLogQueryService queryService,
                              CurrentUserProvider currentUserProvider) {
        this.queryService = queryService;
        this.currentUserProvider = currentUserProvider;
    }

    @GetMapping
    public AuditLogQueryService.AuditLogPageDto list(
            @RequestParam(name = "scope", defaultValue = "mine") String scope,
            @RequestParam(name = "category", required = false) String category,
            @RequestParam(name = "department_id", required = false) Integer departmentId,
            @RequestParam(name = "q", required = false) String q,
            @RequestParam(name = "from", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(name = "to", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "page_size", defaultValue = "20") int pageSize) {
        User viewer = currentUserProvider.getCurrentUser();
        return queryService.query(viewer, AuditLogQueryService.Scope.parse(scope),
                ActivityCategory.parse(category), departmentId, q, from, to, page, pageSize);
    }

    /** The filtered set as CSV — unpaged, admin-only (also enforced in the service). */
    @GetMapping("/export")
    public ResponseEntity<String> export(
            @RequestParam(name = "scope", defaultValue = "company") String scope,
            @RequestParam(name = "category", required = false) String category,
            @RequestParam(name = "department_id", required = false) Integer departmentId,
            @RequestParam(name = "q", required = false) String q,
            @RequestParam(name = "from", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(name = "to", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        User viewer = currentUserProvider.getCurrentUser();
        List<AuditLogQueryService.AuditLogDto> rows = queryService.exportRows(viewer,
                AuditLogQueryService.Scope.parse(scope), ActivityCategory.parse(category),
                departmentId, q, from, to);
        StringBuilder csv = new StringBuilder(CSV_HEADER).append("\r\n");
        for (AuditLogQueryService.AuditLogDto row : rows) {
            csv.append(csvField(row.performedAt() == null
                            ? "" : row.performedAt().format(DateTimeFormatter.ISO_DATE_TIME)))
                    .append(',')
                    .append(csvField(row.actorName())).append(',')
                    .append(csvField(row.actorEmail())).append(',')
                    .append(csvField(row.entityType())).append(',')
                    .append(csvField(row.action())).append(',')
                    .append(csvField(String.valueOf(row.entityId()))).append(',')
                    .append(csvField(row.departmentCode())).append(',')
                    .append(csvField(row.details() == null
                            ? "" : row.details().toString()))
                    .append("\r\n");
        }
        String filename = "audit-log-" + LocalDate.now() + ".csv";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(MediaType.valueOf("text/csv"))
                .body(csv.toString());
    }

    /** Minimal RFC 4180 quoting: quote when needed, double embedded quotes. */
    private static String csvField(String value) {
        if (value == null) {
            return "";
        }
        if (value.contains(",") || value.contains("\"") || value.contains("\n")
                || value.contains("\r")) {
            return '"' + value.replace("\"", "\"\"") + '"';
        }
        return value;
    }
}
