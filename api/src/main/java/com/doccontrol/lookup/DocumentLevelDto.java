package com.doccontrol.lookup;

/** API shape of a document level. */
public record DocumentLevelDto(Integer id, Integer levelNumber, String label, boolean active) {

    public static DocumentLevelDto from(DocumentLevel level) {
        return new DocumentLevelDto(level.getId(), level.getLevelNumber(), level.getLabel(), level.isActive());
    }
}
