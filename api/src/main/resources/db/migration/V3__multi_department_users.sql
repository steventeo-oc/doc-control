-- V3 — Phase 2a: users belong to one or more departments (many-to-many),
-- mirroring the user_role pattern (Phase2_Roadmap.md, Phase 2a).
-- Existing single-department assignments are migrated into the join table,
-- then the singular column is dropped.

CREATE TABLE user_department (
    user_id      integer NOT NULL REFERENCES "user" (id),
    department_id integer NOT NULL REFERENCES department (id),
    PRIMARY KEY (user_id, department_id)
);

INSERT INTO user_department (user_id, department_id)
SELECT id, department_id
FROM "user"
WHERE department_id IS NOT NULL;

ALTER TABLE "user" DROP COLUMN department_id;
