package com.doccontrol.document;

import com.doccontrol.common.domain.PersistableEnum;

/**
 * Lifecycle status of a document (document.status). Values stored exactly as
 * in the data model doc. Soft-delete is deliberately NOT a status here — it is
 * a separate deleted_at column (CLAUDE.md schema decisions).
 */
public enum DocumentStatus implements PersistableEnum {
    DRAFT,
    IN_REVIEW,
    APPROVED,
    RELEASED,
    SUPERSEDED,
    OBSOLETE
}
