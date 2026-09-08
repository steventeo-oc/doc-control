package com.doccontrol.workflow;

import com.doccontrol.common.domain.PersistentEnums;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

@Converter(autoApply = true)
public class WorkflowInstanceStatusConverter implements AttributeConverter<WorkflowInstanceStatus, String> {

    @Override
    public String convertToDatabaseColumn(WorkflowInstanceStatus attribute) {
        return attribute == null ? null : attribute.getValue();
    }

    @Override
    public WorkflowInstanceStatus convertToEntityAttribute(String dbData) {
        return dbData == null ? null : PersistentEnums.fromValue(WorkflowInstanceStatus.class, dbData);
    }
}
