package com.doccontrol.lookup;

/**
 * Partial update — null fields are left unchanged. The code is deliberately
 * absent: it prefixes generated document numbers and must not change.
 */
public record UpdateDepartmentRequest(String label, Boolean active) {
}
