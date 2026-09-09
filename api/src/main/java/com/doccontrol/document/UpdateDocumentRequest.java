package com.doccontrol.document;

/**
 * Metadata-only update (name, owner) — the file itself is versioned, never
 * patched. Null fields are left unchanged.
 *
 * The Sprint 1 `status` override field was REMOVED in Phase 2b: releases are
 * now driven by the workflow engine on approval completion (see
 * DocumentService.promoteVersion and the go-live checklist).
 */
public record UpdateDocumentRequest(String name, Integer ownerUserId) {
}
