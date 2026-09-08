package com.doccontrol.common.domain;

import java.util.Locale;

/**
 * Marker for enums that are persisted as text columns, using the exact
 * lowercase values from Document_Control_Data_Model_v1.md (e.g. "in_review").
 */
public interface PersistableEnum {

    default String getValue() {
        return ((Enum<?>) this).name().toLowerCase(Locale.ROOT);
    }
}
