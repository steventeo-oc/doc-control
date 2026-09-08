package com.doccontrol.document;

import com.doccontrol.common.domain.PersistentEnums;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

@Converter(autoApply = true)
public class DocumentVersionStatusConverter implements AttributeConverter<DocumentVersionStatus, String> {

    @Override
    public String convertToDatabaseColumn(DocumentVersionStatus attribute) {
        return attribute == null ? null : attribute.getValue();
    }

    @Override
    public DocumentVersionStatus convertToEntityAttribute(String dbData) {
        return dbData == null ? null : PersistentEnums.fromValue(DocumentVersionStatus.class, dbData);
    }
}
