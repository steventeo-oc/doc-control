package com.doccontrol.lookup;

/**
 * Partial update — null fields are left unchanged. The tierNumber is
 * deliberately absent: it is the tiers' stable display ordering, not a
 * label (lookup admin plan-back F5).
 */
public record UpdateDocumentTierRequest(String label, Boolean active) {
}
