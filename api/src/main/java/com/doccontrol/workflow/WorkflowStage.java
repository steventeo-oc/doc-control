package com.doccontrol.workflow;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * Ordered stage within a template. Supports parallel-only chains (today) and
 * future sequential multi-department chains with the same structure.
 */
@Entity
@Table(name = "workflow_stage")
@Getter
@Setter
@NoArgsConstructor
public class WorkflowStage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Integer id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "template_id", nullable = false)
    private WorkflowTemplate template;

    @Column(name = "stage_order", nullable = false)
    private Integer stageOrder;

    @Column(nullable = false)
    private String name;

    private ApprovalMode approvalMode;

    /** Default 100 matches the current Alfresco "Required Approval Percentage" setting. */
    @Column(name = "required_approval_percentage", nullable = false)
    private Integer requiredApprovalPercentage = 100;

    /** Reserved for later — field exists from Sprint 1, logic deferred. */
    @Column(name = "due_date_offset_days")
    private Integer dueDateOffsetDays;

    @OneToMany(mappedBy = "stage", fetch = FetchType.LAZY)
    private List<WorkflowStageAssignee> assignees = new ArrayList<>();
}
