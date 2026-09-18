package com.doccontrol.workflow.dto;

/**
 * Live badge counts for the Tasks section navigation.
 */
public record TaskCountsDto(
        int approvals,
        int acknowledgments,
        int started,
        int delegated) {
}
