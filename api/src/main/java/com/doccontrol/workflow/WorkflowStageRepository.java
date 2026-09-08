package com.doccontrol.workflow;

import org.springframework.data.jpa.repository.JpaRepository;

public interface WorkflowStageRepository extends JpaRepository<WorkflowStage, Integer> {
}
