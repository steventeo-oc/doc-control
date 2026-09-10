package com.doccontrol.document;

import com.doccontrol.common.domain.PersistableEnum;

/**
 * Status of an individual version (document_version.status). A new upload
 * starts as draft; approval marks it "approved" — immediately "current" for
 * an immediate release, or "approved" until its effective date arrives for
 * a deferred one (Phase 2c). "superseded" is what the previously-current
 * version becomes.
 */
public enum DocumentVersionStatus implements PersistableEnum {
    DRAFT,
    APPROVED,
    CURRENT,
    SUPERSEDED
}
