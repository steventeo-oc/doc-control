# Project Brief — Document Control System

Read this file first. It orients you to the project; the two linked docs are
the detailed technical reference. Ask before deviating from anything stated
here as a decision (not a suggestion) — these were made deliberately after
planning discussion, not defaults.

## What this is

A custom-built, self-hosted Document Control system for a manufacturing
company (server manufacturing, ISO 9001). Replaces an aging free-tier
Alfresco instance currently run via Docker. This is **one of two systems**
in the company's broader platform — the other is a separate Testing Floor /
MES system for manufacturing traceability. **They are fully independent
deployments** (separate VM, separate database, separate repo, separate
deploy pipeline). Do not couple them. If integration is ever needed later,
it happens over a REST API call, never a shared database.

## Tech stack (decided, not open for silent change)

| Layer | Choice |
|---|---|
| Backend | Java + Spring Boot |
| Workflow engine | **Flowable 8.0.0** (embedded, Spring-native BPMN) — Sprint 3+, not before; chosen over Camunda because Camunda 7 is EOL-bound and Camunda 8's distributed architecture doesn't fit a single-VM deployment (verified via the bounded spike) |
| Frontend | React + TypeScript |
| Database | PostgreSQL |
| File storage | MinIO (S3-compatible, self-hosted) |
| Auth | Local accounts for now; built pluggable for LDAP/AD later |
| Deployment | Docker Compose on a single Ubuntu VM (see `docker-compose.yml`) |

If you think a different tool fits better for something, say so and explain
why — don't just substitute silently.

## Reference documents

- `Document_Control_Data_Model_v1.md` — full schema: tables, columns, FK
  relationships, and the reasoning behind each design choice (extensible
  type/department lookups, native versioning, stage-based workflow model).
  Treat table names as authoritative; map to JPA entities directly
  (e.g. `document` → `Document` entity, snake_case columns →
  camelCase fields via standard Spring/Hibernate naming strategy).
- `Document_Control_API_Spec_v1.md` — full REST endpoint list, grouped by
  resource, with which Sprint each belongs to. Endpoints marked Sprint 3
  (workflow) should not be built yet — see Current scope below.
- `Phase2_Roadmap.md` — **read this before starting any work beyond Sprint
  1.** Sprint 1 (below) is complete. Everything after it was re-scoped based
  on real QA feedback, not the original API spec's Sprint 2-4 labels — the
  roadmap doc supersedes those labels for anything workflow, lifecycle, or
  distribution related.

## Current scope: Sprint 1 (complete) — see Phase2_Roadmap.md for what's next

Sprint 1 is done: auth, lookups, documents (CRUD), versions (MinIO-backed),
users/roles, plus fixes found during piloting (current-version-pointer
semantics, version-history visibility). **Do not build anything from the
original API spec's Sprint 2-4 labels without checking `Phase2_Roadmap.md`
first** — real QA feedback changed the shape of what comes next
significantly. Start with Phase 2a (org/access foundation) per that
document.

## Non-negotiable conventions

1. **`document_number` is always server-generated**, never client-supplied.
   Uses `document_sequence_counter` per (type, department) pair. Gaps in the
   sequence are expected and fine (mirrors the current Alfresco behavior —
   confirmed reserved numbers like `SOP-QA-0003` simply weren't used yet).
2. **Every write action must produce an audit log entry** at the service
   layer, not left to individual controllers to remember. Even though
   `/audit-log` read endpoints are Sprint 4, start writing the log rows now
   so there's no backfill problem later.
3. **Document/department/type are all extensible lookup tables**, never
   hardcoded enums in application code. A new type or department should be
   addable via a database row (or later, an admin screen) with zero code
   changes.
4. **Permission filtering happens in the service layer**, not just hidden
   in the frontend. `GET /documents` and search must only return what the
   caller's role/department allows.
5. **Version numbers are a real system field**, not embedded in filenames.
   The current Alfresco setup does this wrong (`SOP-QA-0010 ... Rev 0.docx`
   with system version stuck at 0) — do not repeat that pattern. A
   `legacy_revision_label` field exists in the schema purely for migration
   reference, not for ongoing use.

## Decisions (previously open, now resolved)

- **Auth**: local accounts only for now. No AD/LDAP integration in this
  phase — but keep the auth layer structured so one could be added later
  without a rewrite (e.g. don't hardcode password-based login as the only
  possible auth flow throughout the codebase).
- **Departments**: only seed `QA`, `ENG`, `PROD`, `HR` as known departments
  at go-live. **Do not assume this is the full list** — more will be added
  over time. This is exactly why `department` is a lookup table and not a
  hardcoded enum (see Non-negotiable conventions above). No code should
  ever assume a fixed/closed set of departments; adding one must be a data
  change only, ideally via a simple admin screen in a later sprint (not
  required for Sprint 1 — a direct DB insert is fine until then).
- **Migration**: the new system **starts clean at go-live**. No migration
  of existing Alfresco content is in scope. The old Alfresco/Docker
  instance can be kept running read-only as a reference archive if needed,
  but nothing needs to be built to import from it. Do not spend any effort
  on Alfresco data export/import tooling unless explicitly asked later.

## Schema decisions (resolved after implementation plan-back)

These four items were gaps identified by whoever implements this against
the data model doc — resolved here so they're answered once, not re-asked.

- **`user_role` join table** (`user_id`, `role_id`) — add it. Required for
  permission filtering to function at all. Many-to-many: a user can hold
  more than one role.
- **Password storage** — add `password_hash` to the `user` table (bcrypt).
  No separate credentials table; keep it simple for a local-accounts-only
  system. If AD/LDAP is added later, this column simply goes unused for
  those accounts rather than being restructured.
- **Soft delete** — add a nullable `deleted_at` timestamp to `document`.
  `DELETE /documents/{id}` sets this instead of removing the row; default
  list views exclude rows where it's set; `/restore` clears it. Do not add
  a `deleted`/`trashed` value to the document status enum — keep lifecycle
  status and soft-delete as separate concerns.
- **Visibility rule (provisional)** — released/approved documents are
  visible to all authenticated users. Draft/in-review documents are visible
  only to the document owner, any assigned reviewers, and admins. (Create
  and edit used to be open to any authenticated user too — superseded by
  the Phase 2a department-scoped rule below.) Read visibility remains a
  starting rule, expected to be revisited once real usage patterns are
  known — not a permanent design constraint.
- **Login identifier** — login by `email` (already unique on `user`). No
  separate username field.
- **Multi-department users (Phase 2a)** — `user` ↔ `department` is
  many-to-many via the `user_department` join table (mirrors `user_role`);
  the singular `user.department_id` column was dropped in migration V3.
  Users must belong to at least one department; the users API takes/lists
  `departments` (full-replacement PATCH, like roles). User responses
  changed shape accordingly (`departments` array).
- **Department-scoped create/edit (Phase 2a)** — only members of a
  department may create documents in it or edit its documents; admins
  remain unrestricted. Ownership no longer grants edit rights by itself:
  ownership transfers are restricted to members of the document's
  department, so owners are always members. Named-user overrides (roadmap
  #3, "Later") are designed to plug into `DocumentService.canModify` as an
  additional clause backed by an override table alongside the department
  rule — not a replacement of it.
- **`current_version_id` semantics (resolved during the pilot)** — the
  pointer means "the version the public sees". It is null until a
  document's first release, and changes only via an explicit release: the
  admin status override to `released`/`approved` re-points it at the latest
  version, including a re-release of an already-released document (that is
  how an uploaded draft gets published). Version uploads and document
  creation never move the pointer — a pilot finding: uploading a draft to a
  released document used to drag the public version pointer to unreviewed
  content. (This deliberately deviates from the API spec's create-document
  example, which shows current_version_id set on a draft; that example
  predates this decision.) Sprint 3's promote endpoint will own this
  properly. On each release the newly-current version's status becomes
  `current` and the previously-current version becomes `superseded`;
  versions never pointed to stay `draft`.
- **Version history visibility (pilot finding #2)** — for non-owner/non-admin
  viewers of a visible document, the version list shows exactly the current
  version, and version detail/download for any other version id returns 404
  (existence not leaked). Owners and admins see the full history. Draft
  versions of a released document are therefore not enumerable or
  downloadable by normal users.
- **Confirmed low-stakes assumptions**: Java 21 + Spring Boot 3.x; Maven;
  session-cookie auth via Spring Security; `audit_log.details` as Postgres
  `jsonb`; seed roles limited to `Admin` and `User` for now (role names like
  "QA Reviewer" arrive with Sprint 3 workflow work, not before).

## Sprint 3 design note (requirements confirmed with QA)

Confirmed: approval chains are **single-stage, parallel, 100% required**
(matching current Alfresco behavior) even for cross-department sign-off —
a cross-department document just gets multiple departments' managers added
as reviewers in that one stage, not a sequential multi-department chain.
Assignees are chosen **ad-hoc, per approval instance** at start time, as
either a named individual or a **role/candidate-group** (e.g. "ENG
Manager") — reusing the existing `role` + `user_role` (+ department)
structure, no new identity tables. **Delegation is unrestricted** (any
reviewer can delegate to anyone). **Escalation defaults are configurable,
not hardcoded**: due date 3 business days after start, reminders 1 day
before and on the due date, escalation to document owner + admin at 2+
business days overdue — notifications via **Microsoft 365 / Graph API**
(no generic SMTP).

Engine decision: **Flowable 8.0.0**, embedded (bounded spike completed:
both engines handled ad-hoc per-instance assignment cleanly; Camunda 7 is
EOL-bound and Camunda 8's distributed architecture doesn't fit single-VM
compose). A design plan-back (data model, API shape, Flowable mapping) has
been delivered for review — implementation starts only after that review.

Items discovered during implementation that must be resolved before a real
deployment, even if they don't block Sprint 1 development itself:

- [x] **Admin password rotation**: no endpoint exists yet to change the
  bootstrap admin's password after first startup. Fold a minimal
  password-change capability into the Users/roles resource work — don't
  ship Sprint 1 as "complete" without it. Until then, the account is stuck
  with whatever `DOCCONTROL_BOOTSTRAP_ADMIN_PASSWORD` was set to at first
  startup. *(Resolved: `POST /users/{id}/password` — self-service with
  current password, admin reset for others; audited as `password_changed`.)*
- [ ] **Confirm `DOCCONTROL_BOOTSTRAP_ADMIN_PASSWORD` and
  `DOCCONTROL_BOOTSTRAP_ADMIN_EMAIL` are actually overridden** at real
  deployment time — the checked-in defaults (`admin@doccontrol.local` /
  `changeme_admin`) are dev-only and must never reach a real environment.
  A startup guard enforces this: default credentials always log a prominent
  warning, and startup **hard fails** when a `prod`/`production` profile is
  active with them — deployment must set real credentials AND activate one
  of those profiles.
- [x] **CSRF protection** — was disabled in Sprint 1 (SameSite=Lax only).
  Now enabled for the SPA: double-submit cookie scheme (`XSRF-TOKEN` cookie
  echoed in `X-XSRF-TOKEN`, Spring Security's documented SPA pattern in
  `SpaCsrfTokenRequestHandler`), with `SameSite=Lax` kept on as defense in
  depth. The frontend sends the header automatically; `scripts/smoke.sh`
  demonstrates the full flow with curl.
- [ ] **Admin status override is a Sprint 1 stopgap** — `PATCH /documents/{id}`
  accepts an optional `status` field (admin-only, audited as
  `status_changed`) so documents can reach approved/released before the
  workflow engine exists and the visibility rule is exercised by real API
  traffic. When Sprint 3 lands, status changes become workflow-driven and
  this override must be **removed or narrowed to a deliberate break-glass
  action** — an auditor asking "who can release a document without going
  through approval?" must get the answer "no one", not "an undocumented
  bypass nobody removed".
- [ ] **Mint a second break-glass Admin before go-live**: create the account
  (`POST /users` with `"roles": ["Admin"]`) and **securely store its
  credentials** (password manager / sealed envelope, not a chat message),
  then verify it can log in. This is the actual mitigation for "the sole
  admin's password is lost" — an operational step, not a code fix. Also
  note: an admin cannot change their own roles, so the second admin is the
  only way back if the primary account is ever locked out.
- [ ] **File upload limits & storage config are dev defaults** —
  `spring.servlet.multipart.*` currently allows 50MB. Proposal in
  `application.yml`: 25MB if only office documents are in scope, **100MB
  (110MB request) if large CAD/DWG drawings are** — confirm by measuring the
  largest real artifact in the old read-only Alfresco archive before
  deciding. Storage: override MinIO credentials at deployment
  (`MINIO_ROOT_*` for the container, `DOCCONTROL_STORAGE_ACCESS_KEY/SECRET_KEY`
  for the api) and **create a dedicated MinIO user** for the api with
  read/write on the `doccontrol` bucket only — the api should never use the
  root account. Serve MinIO behind TLS; switch the api's storage endpoint to
  https accordingly.
