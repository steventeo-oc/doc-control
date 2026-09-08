package com.doccontrol.common.domain;

public final class PersistentEnums {

    private PersistentEnums() {
    }

    public static <E extends Enum<E> & PersistableEnum> E fromValue(Class<E> enumType, String dbValue) {
        for (E constant : enumType.getEnumConstants()) {
            if (constant.getValue().equals(dbValue)) {
                return constant;
            }
        }
        throw new IllegalArgumentException(
                "No " + enumType.getSimpleName() + " constant for database value: " + dbValue);
    }
}
