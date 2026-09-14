package com.doccontrol.audit;

import java.util.List;

/**
 * The four human-relevant activity categories (activity plan-back F3),
 * mapped from the entity types actually written. Lookup-config rows
 * (document_type, document_tier) belong to no category: they surface only
 * in the all-categories view and the admin CSV export.
 */
public enum ActivityCategory {
    DOCUMENTS("document", "document_version"),
    WORKFLOW("workflow_instance", "daily_sweep"),
    ACKNOWLEDGMENT("document_acknowledgment", "document_acknowledgment_access"),
    MEMBERSHIP("department", "user");

    private final List<String> entityTypes;

    ActivityCategory(String... entityTypes) {
        this.entityTypes = List.of(entityTypes);
    }

    public List<String> entityTypes() {
        return entityTypes;
    }

    /** Case-insensitive lookup for the query param; null/blank passes through. */
    public static ActivityCategory parse(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return ActivityCategory.valueOf(value.trim().toUpperCase());
    }
}
