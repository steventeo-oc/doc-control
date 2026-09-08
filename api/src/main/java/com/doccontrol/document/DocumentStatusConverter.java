package com.doccontrol.document;

import com.doccontrol.common.domain.PersistentEnums;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

@Converter(autoApply = true)
public class DocumentStatusConverter implements AttributeConverter<DocumentStatus, String> {

    @Override
    public String convertToDatabaseColumn(DocumentStatus attribute) {
        return attribute == null ? null : attribute.getValue();
    }

    @Override
    public DocumentStatus convertToEntityAttribute(String dbData) {
        return dbData == null ? null : PersistentEnums.fromValue(DocumentStatus.class, dbData);
    }
}
