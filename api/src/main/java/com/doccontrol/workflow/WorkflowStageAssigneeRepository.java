package com.doccontrol.workflow;

import org.springframework.data.jpa.repository.JpaRepository;

public interface WorkflowStageAssigneeRepository extends JpaRepository<WorkflowStageAssignee, Integer> {
}
