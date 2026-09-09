package com.doccontrol.document;

import com.doccontrol.common.domain.PersistentEnums;
import org.springframework.core.convert.converter.Converter;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Accepts the data model's lowercase status values ("in_review") as query
 * parameters, mapping to the enum; anything else is a 400.
 */
@Component
public class DocumentStatusParamConverter implements Converter<String, DocumentStatus> {

    @Override
    public DocumentStatus convert(String source) {
        try {
            return PersistentEnums.fromValue(DocumentStatus.class, source);
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown document status: " + source);
        }
    }
}
