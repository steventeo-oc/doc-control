package com.doccontrol.document;

/**
 * Metadata-only update (name, owner) — the file itself is versioned, never
 * patched. Null fields are left unchanged.
 */
public record UpdateDocumentRequest(String name, Integer ownerUserId) {
}
