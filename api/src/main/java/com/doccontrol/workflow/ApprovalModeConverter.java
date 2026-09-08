package com.doccontrol.workflow;

import com.doccontrol.common.domain.PersistentEnums;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

@Converter(autoApply = true)
public class ApprovalModeConverter implements AttributeConverter<ApprovalMode, String> {

    @Override
    public String convertToDatabaseColumn(ApprovalMode attribute) {
        return attribute == null ? null : attribute.getValue();
    }

    @Override
    public ApprovalMode convertToEntityAttribute(String dbData) {
        return dbData == null ? null : PersistentEnums.fromValue(ApprovalMode.class, dbData);
    }
}
