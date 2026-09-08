package com.doccontrol.document;

import com.doccontrol.common.domain.PersistableEnum;

/**
 * Status of an individual version (document_version.status). A new upload
 * starts as draft; "current" is what promote marks it as once a workflow
 * completes with approval (Sprint 3).
 */
public enum DocumentVersionStatus implements PersistableEnum {
    DRAFT,
    CURRENT,
    SUPERSEDED
}
