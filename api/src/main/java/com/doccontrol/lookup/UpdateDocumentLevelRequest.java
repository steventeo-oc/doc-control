package com.doccontrol.lookup;

/**
 * Partial update — null fields are left unchanged. The levelNumber is
 * deliberately absent: it is the levels' stable display ordering, not a
 * label (lookup admin plan-back F5).
 */
public record UpdateDocumentLevelRequest(String label, Boolean active) {
}
