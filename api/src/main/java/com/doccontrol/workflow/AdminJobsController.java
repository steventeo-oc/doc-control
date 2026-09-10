package com.doccontrol.workflow;

import com.doccontrol.audit.AuditService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.Map;

/**
 * Manual trigger for the daily sweep (admin only). The job is idempotent
 * per business date — proven by {@link WorkflowJobIdempotencyTests} — so
 * running it as of any date is safe: it flips what is due, sends what is
 * deduped, and changes nothing on a re-run. The optional {@code date}
 * parameter simulates a business date (used by scripts/smoke.sh to verify
 * effective-date flips without waiting for the 07:00 cron).
 */
@RestController
@RequestMapping("/admin/jobs")
public class AdminJobsController {

    private final WorkflowNotificationJob job;
    private final AuditService auditService;

    public AdminJobsController(WorkflowNotificationJob job, AuditService auditService) {
        this.job = job;
        this.auditService = auditService;
    }

    @PostMapping("/daily-sweep")
    public Map<String, Object> runDailySweep(
            @RequestParam(name = "date", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        LocalDate swept = date == null ? LocalDate.now() : date;
        job.run(swept);
        auditService.record("daily_sweep", 0, "triggered", Map.of(
                "date", swept.toString(),
                "triggered_by", "admin"));
        return Map.of("date", swept.toString());
    }
}
