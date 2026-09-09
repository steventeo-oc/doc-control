package com.doccontrol.identity;

import java.util.List;

/**
 * Partial update per the spec ("update department/active status"), plus name,
 * ad_username, and roles. Email is deliberately absent: it is the login
 * identifier and must not drift.
 *
 * `roles` uses full-replacement semantics (the request lists exactly the
 * roles the account should hold). An admin cannot change their own roles —
 * same guard as self-deactivation, so a moment of carelessness can't lock
 * out the only account that can fix it.
 */
public record UpdateUserRequest(String name, Integer departmentId, String adUsername,
                                Boolean active, List<String> roles) {
}
