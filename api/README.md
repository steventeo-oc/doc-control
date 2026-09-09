# doc-control-api

Spring Boot backend for the Document Control system (Sprint 1 — schema and
entity layer; endpoints come with the API work).

## Stack

- Java 21, Spring Boot 3.5.x, Maven
- PostgreSQL (schema owned by Flyway migrations in `src/main/resources/db/migration`)
- Spring Data JPA with `ddl-auto=validate` — Hibernate only verifies that the
  entities match the migrated schema; it never alters it

**API mount:** all endpoints live under `/api` (`server.servlet.context-path`)
so the SPA owns every other path — browser deep links like `/documents/42`
reach the React app, not the API. The spec's resource paths (`/auth/login`,
`/documents`, …) are unchanged relative to that mount, so the API base URL in
deployment is `http://host:8080/api`.

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
5432, MinIO on 9000). For local development without Docker:

**PostgreSQL** — any instance works; point the app at it with environment
overrides:

```bash
SPRING_DATASOURCE_URL="jdbc:postgresql://localhost:5434/doccontrol" \
mvn spring-boot:run
```

Defaults (used inside compose and by any local cluster that mirrors it):
`jdbc:postgresql://localhost:5432/doccontrol`, user `doccontrol`.

**MinIO** — file storage for document versions. Either `docker compose up
minio`, or run the standalone binary:

```bash
mkdir -p ~/.doccontrol-dev/minio-data
MINIO_ROOT_USER=doccontrol MINIO_ROOT_PASSWORD=changeme_in_env_file \
  ~/.doccontrol-dev/minio.exe server ~/.doccontrol-dev/minio-data \
  --address ":9000" --console-address ":9001"
```

The app creates the `doccontrol` bucket on startup if missing (best effort —
it starts even if MinIO is down; uploads then fail with a clear error).

## Verifying

`DocControlApplicationTests` boots the whole context against a real database:
Flyway applies all migrations, then Hibernate validates every entity against
the actual schema. It needs a reachable database:

```bash
SPRING_DATASOURCE_URL="jdbc:postgresql://localhost:5434/doccontrol" mvn test
```

The version-endpoint tests (`DocumentVersionEndpointTests`) additionally
need MinIO on localhost:9000 — they upload real files and download them back.

## Notes

- The `user` table is quoted (`"user"`) — reserved word in PostgreSQL.
- `document` ↔ `document_version` have a circular FK; the
  `current_version_id` constraint is added after `document_version` exists
  and stays nullable until a version is uploaded.
- No seed user: the initial admin is created at startup by the auth layer
  (bcrypt at runtime), not by a migration.
