package com.doccontrol.document;

public record DocumentNumberPreviewDto(
        Integer typeId,
        String typeCode,
        Integer departmentId,
        String departmentCode,
        Integer nextSequenceNumber,
        String nextDocumentNumber,
        Integer currentLatestSequenceNumber,
        String currentLatestDocumentNumber
) {}
