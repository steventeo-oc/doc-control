package com.doccontrol.workflow;

import com.doccontrol.config.WorkflowProperties;
import org.flowable.engine.delegate.TaskListener;
import org.flowable.task.service.delegate.DelegateTask;
import org.springframework.stereotype.Component;

import java.time.ZoneId;
import java.util.Date;

/**
 * Applies a confirmed Phase 2b rule per task slot at creation:
 * "user:&lt;id&gt;" slots become direct assignees, "role:&lt;name&gt;" slots
 * become pooled candidate groups (one member's approval satisfies the slot),
 * and every task gets a due date of N business days out (configurable).
 */
@Component("slotAssignmentListener")
public class SlotAssignmentListener implements TaskListener {

    static final String USER_PREFIX = "user:";
    static final String ROLE_PREFIX = "role:";

    private final WorkflowProperties properties;

    public SlotAssignmentListener(WorkflowProperties properties) {
        this.properties = properties;
    }

    @Override
    public void notify(DelegateTask delegateTask) {
        // Phase 2c: a periodic-review re-approval must be visibly different
        // from a first-time approval — the task name carries it into every
        // task list, and the instance DTOs expose the reapproval flag.
        if (Boolean.TRUE.equals(delegateTask.getVariable("reapproval"))) {
            delegateTask.setName("Periodic review re-approval");
        }
        String slot = (String) delegateTask.getVariable("slot");
        if (slot == null) {
            throw new IllegalStateException("Approval task created without an assignee slot");
        }
        if (slot.startsWith(ROLE_PREFIX)) {
            delegateTask.addCandidateGroup(slot.substring(ROLE_PREFIX.length()));
        } else if (slot.startsWith(USER_PREFIX)) {
            delegateTask.setAssignee(slot.substring(USER_PREFIX.length()));
        } else {
            throw new IllegalStateException("Unrecognized assignee slot: " + slot);
        }
        delegateTask.setDueDate(Date.from(
                BusinessDays.addBusinessDays(java.time.LocalDate.now(), properties.dueBusinessDays())
                        .atTime(17, 0)
                        .atZone(ZoneId.systemDefault())
                        .toInstant()));
    }
}
