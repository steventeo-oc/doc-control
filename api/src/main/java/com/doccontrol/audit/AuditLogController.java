package com.doccontrol.audit;

import com.doccontrol.identity.User;
import com.doccontrol.security.CurrentUserProvider;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

/**
 * The permission-scoped audit-log query (activity plan-back, approved
 * 2026-09-14) — the API spec's Sprint 4 GET /audit-log, extended to all
 * authenticated users: scope defaults to the caller's own rows, and the
 * service refuses company scope for non-admins (403). The admin-only CSV
 * export lives at GET /audit-log/export (route-protected like /admin/**).
 */
@RestController
@RequestMapping("/audit-log")
public class AuditLogController {

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
            @RequestParam(name = "from", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(name = "to", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "page_size", defaultValue = "20") int pageSize) {
        User viewer = currentUserProvider.getCurrentUser();
        return queryService.query(viewer, AuditLogQueryService.Scope.parse(scope),
                ActivityCategory.parse(category), from, to, page, pageSize);
    }
}
