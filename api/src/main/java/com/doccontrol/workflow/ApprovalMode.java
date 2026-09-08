package com.doccontrol.workflow;

import com.doccontrol.common.domain.PersistableEnum;

/**
 * How a stage's approvals are counted: parallel (all assignees act, threshold
 * via required_approval_percentage) or single (one designated approver).
 */
public enum ApprovalMode implements PersistableEnum {
    PARALLEL,
    SINGLE
}
