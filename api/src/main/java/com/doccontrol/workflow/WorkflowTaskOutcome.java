package com.doccontrol.workflow;

import com.doccontrol.common.domain.PersistableEnum;

public enum WorkflowTaskOutcome implements PersistableEnum {
    PENDING,
    APPROVED,
    REJECTED
}
