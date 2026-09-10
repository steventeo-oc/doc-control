package com.doccontrol.workflow.dto;

import com.doccontrol.identity.User;

/**
 * Minimal reviewer-picklist entry for starting an approval (ad-hoc
 * assignment): id, name, email — no roles, departments, or account data.
 * Served to anyone who may modify the document, so non-admin owners can
 * assign reviewers by name (Phase 2b usability follow-up).
 */
public record ReviewerCandidateDto(Integer id, String name, String email) {

    public static ReviewerCandidateDto from(User user) {
        return new ReviewerCandidateDto(user.getId(), user.getName(), user.getEmail());
    }
}
