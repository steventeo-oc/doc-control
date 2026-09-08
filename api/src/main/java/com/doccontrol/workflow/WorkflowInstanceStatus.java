package com.doccontrol.workflow;

import com.doccontrol.common.domain.PersistableEnum;

public enum WorkflowInstanceStatus implements PersistableEnum {
    IN_PROGRESS,
    COMPLETED,
    REJECTED
}
