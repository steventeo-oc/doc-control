package com.doccontrol.identity;

import java.util.List;

/**
 * Partial update: name, ad_username, active, roles, departments. Email is
 * deliberately absent: it is the login identifier and must not drift.
 *
 * `roles` and `departments` use full-replacement semantics (the request
 * lists exactly what the account should hold). An admin cannot change their
 * own roles — same guard as self-deactivation, so a moment of carelessness
 * can't lock out the only account that can fix it.
 */
public record UpdateUserRequest(String name, List<Integer> departmentIds, String adUsername,
                                Boolean active, List<String> roles) {
}
