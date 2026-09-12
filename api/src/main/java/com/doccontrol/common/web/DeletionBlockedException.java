package com.doccontrol.common.web;

import java.util.Map;

/**
 * A DELETE was refused because live rows still reference the entity
 * (lookup admin plan-back F4). Rendered as 409 with the human sentence in
 * the ProblemDetail detail and the structured counts under the "blocking"
 * property, so the SPA can show exactly what is in the way.
 */
public class DeletionBlockedException extends RuntimeException {

    private final Map<String, Object> blocking;

    public DeletionBlockedException(String message, Map<String, Object> blocking) {
        super(message);
        this.blocking = blocking;
    }

    public Map<String, Object> getBlocking() {
        return blocking;
    }
}
