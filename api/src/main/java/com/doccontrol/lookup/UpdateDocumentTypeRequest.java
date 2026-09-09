package com.doccontrol.lookup;

/**
 * Partial update — null fields are left unchanged. The code is deliberately
 * absent: it is part of generated document numbers and must not change.
 */
public record UpdateDocumentTypeRequest(String label, Integer tierId, Boolean active) {
}
