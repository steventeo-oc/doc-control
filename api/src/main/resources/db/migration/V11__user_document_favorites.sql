-- User document favorites / bookmarks: per-user starred documents for quick access

CREATE TABLE user_document_favorite (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES document (id) ON DELETE CASCADE,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT uk_user_document_favorite UNIQUE (user_id, document_id)
);

CREATE INDEX idx_user_document_favorite_user ON user_document_favorite (user_id);
