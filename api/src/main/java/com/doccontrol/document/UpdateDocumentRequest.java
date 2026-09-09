package com.doccontrol.document;

/**
 * Metadata-only update (name, owner) — the file itself is versioned, never
 * patched. Null fields are left unchanged.
 *
 * `status` is a Sprint 1 stopgap (see CLAUDE.md go-live checklist): admin
 * only, audited as status_changed, so documents can reach approved/released
 * before the workflow engine exists. Accepted as a string and validated
 * against the data model's values so bad values return a clean 400.
 */
public record UpdateDocumentRequest(String name, Integer ownerUserId, String status) {
}
