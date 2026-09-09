package com.doccontrol.lookup;

/** API shape of a document type. */
public record DocumentTypeDto(Integer id, String code, String label, Integer tierId, boolean active) {

    public static DocumentTypeDto from(DocumentType type) {
        return new DocumentTypeDto(type.getId(), type.getCode(), type.getLabel(),
                type.getTier().getId(), type.isActive());
    }
}
