package com.doccontrol.workflow.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * Ad-hoc, per-instance reviewer selection (confirmed with QA): each slot is
 * either a named user or a role/candidate-group. At least one required.
 */
public record StartApprovalRequest(@NotEmpty List<@Valid AssigneeInput> assignees) {

    public record AssigneeInput(
            @NotBlank String type,   // "USER" or "ROLE"
            Integer userId,          // required when type == USER
            String roleName) {       // required when type == ROLE
    }
}
