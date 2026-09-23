package com.doccontrol.lookup;

/** API shape of a document type. */
public record DocumentTypeDto(Integer id, String code, String label, Integer levelId, boolean active) {

    public static DocumentTypeDto from(DocumentType type) {
        return new DocumentTypeDto(type.getId(), type.getCode(), type.getLabel(),
                type.getLevel().getId(), type.isActive());
    }
}
