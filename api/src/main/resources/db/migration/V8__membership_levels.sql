-- V8 — Department membership levels (Department_Levels_Design_PlanBack.md):
-- every user_department row carries an explicit level — MANAGER,
-- COLLABORATOR, CONTRIBUTOR, CONSUMER — replacing the flat
-- "member = full edit" semantics of Phase 2a (reworked in place; see the
-- plan-back for the two-predicate mapping).
--
-- ONE-TIME DATA DECISION (documented per the approved plan-back, F2): the
-- retrofit backfills every existing membership to COLLABORATOR — the
-- closest match to the old flat-member semantics. This is the only
-- defaulting that will ever happen: the column deliberately gets NO
-- database DEFAULT, so from this migration forward an INSERT without an
-- explicit level fails here as a second layer behind the API's
-- reject-don't-assume rule.

ALTER TABLE user_department ADD COLUMN level text;

UPDATE user_department SET level = 'COLLABORATOR';

ALTER TABLE user_department ALTER COLUMN level SET NOT NULL;

ALTER TABLE user_department ADD CONSTRAINT ck_user_department_level
    CHECK (level IN ('MANAGER', 'COLLABORATOR', 'CONTRIBUTOR', 'CONSUMER'));
