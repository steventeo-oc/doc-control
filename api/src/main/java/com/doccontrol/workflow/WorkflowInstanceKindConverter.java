package com.doccontrol.workflow;

import com.doccontrol.common.domain.PersistentEnums;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

@Converter(autoApply = true)
public class WorkflowInstanceKindConverter implements AttributeConverter<WorkflowInstanceKind, String> {

    @Override
    public String convertToDatabaseColumn(WorkflowInstanceKind attribute) {
        return attribute == null ? null : attribute.getValue();
    }

    @Override
    public WorkflowInstanceKind convertToEntityAttribute(String dbData) {
        return dbData == null ? null : PersistentEnums.fromValue(WorkflowInstanceKind.class, dbData);
    }
}
