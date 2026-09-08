-- V2 — go-live seed data.
-- Per CLAUDE.md: departments are ONLY these four known ones at go-live — the
-- list is explicitly not closed, new departments/types are data changes (row
-- inserts), never code changes. No document_sequence_counter rows are seeded:
-- counters are created lazily per (type, department) on first document creation.

INSERT INTO department (code, label) VALUES
    ('QA',   'Quality Assurance'),
    ('ENG',  'Engineering'),
    ('PROD', 'Production'),
    ('HR',   'Human Resources');

INSERT INTO document_tier (tier_number, label) VALUES
    (1, 'Policy'),
    (2, 'Procedure'),
    (3, 'Work Instruction'),
    (4, 'Form/Record');

-- Initial document types. Tier mapping of DWG to Work Instruction level is a
-- judgment call for seeding only — adjust with a data change if needed.
INSERT INTO document_type (code, label, tier_id) VALUES
    ('SOP',  'Standard Operating Procedure', (SELECT id FROM document_tier WHERE tier_number = 2)),
    ('WI',   'Work Instruction',             (SELECT id FROM document_tier WHERE tier_number = 3)),
    ('DWG',  'Drawing',                      (SELECT id FROM document_tier WHERE tier_number = 3)),
    ('FORM', 'Form',                         (SELECT id FROM document_tier WHERE tier_number = 4));

-- Sprint 1 roles only (CLAUDE.md). Reviewer-style roles ("QA Reviewer" etc.)
-- arrive with Sprint 3 workflow work.
INSERT INTO role (name) VALUES
    ('Admin'),
    ('User');

-- NOTE: no seed user here. The initial admin account is created at startup
-- (bcrypt-encoded password, from configuration) once the auth layer exists —
-- never a hardcoded hash in a migration.
