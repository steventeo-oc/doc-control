package com.doccontrol.identity;

/**
 * Partial update per the spec ("update department/active status"), plus name
 * and ad_username. Email and roles are deliberately absent: email is the
 * login identifier and must not drift, and role assignment is reserved for
 * the Sprint 3 workflow work where reviewer roles first appear.
 */
public record UpdateUserRequest(String name, Integer departmentId, String adUsername, Boolean active) {
}
