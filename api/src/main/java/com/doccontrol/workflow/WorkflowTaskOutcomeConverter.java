package com.doccontrol.workflow;

import com.doccontrol.common.domain.PersistentEnums;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

@Converter(autoApply = true)
public class WorkflowTaskOutcomeConverter implements AttributeConverter<WorkflowTaskOutcome, String> {

    @Override
    public String convertToDatabaseColumn(WorkflowTaskOutcome attribute) {
        return attribute == null ? null : attribute.getValue();
    }

    @Override
    public WorkflowTaskOutcome convertToEntityAttribute(String dbData) {
        return dbData == null ? null : PersistentEnums.fromValue(WorkflowTaskOutcome.class, dbData);
    }
}
