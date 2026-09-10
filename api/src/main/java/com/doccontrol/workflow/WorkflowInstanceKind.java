package com.doccontrol.workflow;

import com.doccontrol.common.domain.PersistableEnum;

/**
 * What an approval instance approves (Phase 2c). APPROVAL is the normal
 * draft-version approval; REAPPROVAL is a periodic-review re-approval of the
 * currently-released version — reviewers must see the difference, and its
 * completion resets the review clock instead of promoting a version.
 */
public enum WorkflowInstanceKind implements PersistableEnum {
    APPROVAL,
    REAPPROVAL
}
