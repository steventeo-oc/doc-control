# doc-control-api

Spring Boot backend for the Document Control system (Sprint 1 — schema and
entity layer; endpoints come with the API work).

## Stack

- Java 21, Spring Boot 3.5.x, Maven
- PostgreSQL (schema owned by Flyway migrations in `src/main/resources/db/migration`)
- Spring Data JPA with `ddl-auto=validate` — Hibernate only verifies that the
  entities match the migrated schema; it never alters it

## Layout

```
src/main/java/com/doccontrol/
├── common/      shared enum-persistence helpers
├── identity/    user, role, user_role
├── lookup/      document_tier, document_type, department, document_sequence_counter
├── document/    document, document_version (+ status enums)
├── workflow/    template/stage/assignee/instance/task (schema-only for now, endpoints Sprint 3)
└── audit/       audit_log
```

## Running locally

The deployment target is `docker-compose.yml` at the repo root (postgres on
5432). For local development without Docker, any PostgreSQL instance works —
point the app at it with environment overrides:

```bash
SPRING_DATASOURCE_URL="jdbc:postgresql://localhost:5434/doccontrol" \
mvn spring-boot:run
```

Defaults (used inside compose and by any local cluster that mirrors it):
`jdbc:postgresql://localhost:5432/doccontrol`, user `doccontrol`.

## Verifying

`DocControlApplicationTests` boots the whole context against a real database:
Flyway applies all migrations, then Hibernate validates every entity against
the actual schema. It needs a reachable database:

```bash
SPRING_DATASOURCE_URL="jdbc:postgresql://localhost:5434/doccontrol" mvn test
```

## Notes

- The `user` table is quoted (`"user"`) — reserved word in PostgreSQL.
- `document` ↔ `document_version` have a circular FK; the
  `current_version_id` constraint is added after `document_version` exists
  and stays nullable until a version is uploaded.
- No seed user: the initial admin is created at startup by the auth layer
  (bcrypt at runtime), not by a migration.
