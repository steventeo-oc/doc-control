package com.doccontrol.audit;

import com.doccontrol.identity.User;
import com.doccontrol.security.CurrentUserProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;

/**
 * Writes the ISO 9001 audit trail. Called from service-layer write methods —
 * never from controllers — so the log entry is part of the same transaction
 * as the change it records (CLAUDE.md convention 2). MANDATORY propagation
 * makes it impossible to "fire and forget" outside that transaction.
 */
@Service
public class AuditService {

    private final AuditLogRepository auditLogRepository;
    private final CurrentUserProvider currentUserProvider;

    public AuditService(AuditLogRepository auditLogRepository, CurrentUserProvider currentUserProvider) {
        this.auditLogRepository = auditLogRepository;
        this.currentUserProvider = currentUserProvider;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void record(String entityType, Integer entityId, String action, Map<String, Object> details) {
        recordAs(currentUserProvider.getCurrentUser(), entityType, entityId, action, details);
    }

    /**
     * Same contract as {@link #record}, with an explicit actor — used by
     * sweep-driven mutations running outside any security context (the
     * System user, see {@link SystemActor}). Still MANDATORY: the entry is
     * part of the same transaction as the change it records.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordAs(User actor, String entityType, Integer entityId, String action,
                         Map<String, Object> details) {
        AuditLog entry = new AuditLog();
        entry.setEntityType(entityType);
        entry.setEntityId(entityId);
        entry.setAction(action);
        entry.setPerformedBy(actor);
        entry.setDetails(details);
        auditLogRepository.save(entry);
    }
}
