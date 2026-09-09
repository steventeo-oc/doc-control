package com.doccontrol.document;

import java.util.List;

public record DocumentsPageDto(
        List<DocumentSummaryDto> content,
        int page,
        int pageSize,
        long totalElements,
        int totalPages) {

    public static DocumentsPageDto from(org.springframework.data.domain.Page<DocumentSummaryDto> page) {
        return new DocumentsPageDto(
                page.getContent(),
                page.getNumber(),
                page.getSize(),
                page.getTotalElements(),
                page.getTotalPages());
    }
}
