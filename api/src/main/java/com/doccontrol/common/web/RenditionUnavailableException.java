package com.doccontrol.common.web;

/**
 * A document rendition (LibreOffice conversion or PDF stamping) could not
 * be produced. Downloads fail closed with 503 — an unstamped original
 * must never escape because the rendition pipeline is unhealthy
 * (Phase 2e plan-back flag F4).
 */
public class RenditionUnavailableException extends RuntimeException {

    public RenditionUnavailableException(String message) {
        super(message);
    }

    public RenditionUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
