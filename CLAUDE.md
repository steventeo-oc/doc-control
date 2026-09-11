# Project Brief — Document Control System

## Current State (read this first — updated at end of each work session)

- **Done**: Sprint 1 (auth, lookups, documents + MinIO-backed versions,
  users/roles) — complete and piloted, with pilot fixes (version-pointer
  semantics, version-history visibility, CSRF enabled, credential guards).
  Phase 2a (multi-department users, department-scoped create/edit).
  Phase 2b core: **Flowable 8.0.0** embedded approval flow (ad-hoc parallel
  reviewers, 100% promotion, rejection, delegation, pooled role tasks,
  reviewer visibility) plus the daily job — four ordered phases (flip →
  approval reminders → review notices → acknowledgment notices), each
  item in its own transaction with re-fetched entities (a real cron would
  otherwise hit lazy-init/detached failures — caught by smoke testing),
  idempotent per business date (test-proven). The Sprint 1 status-override
  stopgap is retired. **Phase 2b is fully complete and verified
  end-to-end (2026-09-11)**: the Microsoft Graph sender
  (`GraphNotificationSender`, behind `doccontrol.notification.enabled` —
  the local stack runs with the real Azure values from the gitignored
  `.env`, which compose interpolates into the api container) sent a real
  email that was confirmed delivered to a real inbox; the smoke-test data
  used for that verification was reverted afterwards, and the two
  `notification_log` rows (channel 'graph') plus the `daily_sweep` audit
  entry remain as genuine records. Phase 2c (periodic review, effective
  dates, optional change reference) and Phase 2d (read & understood
  acknowledgment) are complete — backend, SPA frontend, and
  browser-verified: the daily sweep, `scripts/smoke.sh` sections 11–14,
  admin-only `POST /admin/jobs/daily-sweep?date=…` for date simulation,
  the My tasks page (approve/reject with an optional effective-date
  picker, re-approval badge), send-for-approval / start-re-approval
  actions and the acknowledgment panel with grants on the document page,
  the document-scoped `GET /documents/{id}/reviewer-candidates` picklist
  for non-admin owners, and fixes for two latent CSRF bugs found by
  real-browser testing (SPA login bypassed the CSRF header; the
  XSRF-TOKEN cookie was scoped to Path=/api so the SPA's JS could never
  read it — browsers that visited before that fix keep a stale cookie
  that blocks login until cleared; closing the browser clears it).
- **Pending (owner)**: rotate the Azure client secret (it passed through
  chat during setup — NOT yet done). The new value goes into the
  gitignored `.env`; after editing, the running api container needs
  `docker compose up -d api` (no rebuild) or Graph token requests will
  401 until then.
- **In progress / next**: nothing mid-flight. Phase 2e (watermarking,
  change notifications) has NOT started — blocked on one thing:
  confirming with QA who should receive change notifications, replacing
  their earlier tentative answer. The go-live checklist now includes the
  Graph accept-then-async-bounce caveat (a `'graph'` notification_log row
  proves submission, not delivery) — it needs a decision before real
  rollout: a routable-email audit plus who watches the sender mailbox for
  bounces.
- **Where things run (this dev machine)**: no Docker on Windows — Docker
  Engine lives inside WSL2 (run compose via `wsl -e bash -c "cd
  '/mnt/c/Users/Exp Local XYZ/Downloads/doc-control' && sudo docker compose
  up -d --build"`, with `POSTGRES_HOST_PORT=15432 MINIO_HOST_PORT=19000
  MINIO_CONSOLE_HOST_PORT=19001` to avoid port collisions). Tests need a
  live database: local dev Postgres cluster on **5434**
  (`~/.doccontrol-dev/pgdata`, override with `SPRING_DATASOURCE_URL`), and
  workflow/notification tests also need MinIO on **9000**
  (`~/.doccontrol-dev/minio.exe` — see api/README.md). 54 tests green.
- **WSL2 gotchas (hit 2026-09-10)**: `sudo` inside WSL prompts for a
  password — non-interactive `sudo` in a `wsl -e` one-liner hangs forever
  (work from an interactive WSL terminal, or pipe the password). The WSL
  VM also idle-shuts down when nothing holds a session open, which stops
  the whole compose stack; `restart: unless-stopped` brings it back on the
  next `wsl` call, so keep a WSL session alive while working against the
  stack (a background `wsl -e bash -c "sleep N"` works).
- **Deployment target**: `docker compose up -d --build` serves the SPA at
  localhost:3000 with the API under the `/api` mount; stack rebuilt from
  main on 2026-09-10 with Phase 2c/2d and the full smoke (sections 1–14,
  browser-verified UI) passing against it.
- **Verification habit**: `scripts/smoke.sh` walks the full flow (including
  the workflow release) end-to-end; run it after any stack rebuild.

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
- **`current_version_id` semantics (resolved during the pilot; amended in
  Phase 2c)** — the pointer means "the version the public sees". It is null
  until a document's first release. Version uploads and document creation
  never move the pointer — a pilot finding: uploading a draft to a released
  document used to drag the public version pointer to unreviewed content.
  Since Phase 2b the engine owns the move (approval completion →
  `promoteVersion`); **Phase 2c amendment (plan-back flag F2)**: an
  approval completed with a future effective date leaves the document
  `approved` with the pointer untouched, and the daily job's
  effective-date flip moves the pointer on the chosen date. So the pointer
  now moves via exactly two paths: an immediate approval completion, and
  the scheduled flip. On each release the newly-current version's status
  becomes `current` and the previously-current version becomes
  `superseded`; an approved-not-yet-effective version is `approved`;
  versions never pointed to stay `draft`. (This deliberately deviates from
  the API spec's create-document example, which shows current_version_id
  set on a draft; that example predates this decision.)
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
compose). The design plan-back was approved; the core approval flow
(ad-hoc parallel start, 100% completion with version promotion, rejection,
unrestricted delegation, pooled role tasks, reviewer visibility) is
implemented and tested — the status-override stopgap is retired. The
reminder/escalation job is also implemented (daily sweep, configurable
thresholds, pooled tasks remind current role members until claimed,
dedup via notification_log), and the Microsoft Graph sender completed
the phase — log-only remains the default until a deployment sets the
DOCCONTROL_NOTIFICATION_* values.

## Phase 2c/2d design note (requirements confirmed with QA, implemented 2026-09-10)

Full design in `Phase2c_2d_Design_PlanBack.md` (approved by the owner,
flags F1–F8 as proposed). Key points:

- **Periodic review**: ONE configurable interval for all documents
  (`doccontrol.review.interval-months`, 0 = off) — never per-type. The
  owner is responsible. The clock resets exactly when a version becomes
  effective (immediate approval, effective-date flip, re-approval).
  Overdue is derived (`next_review_due < today`), never stored, and the
  ONLY way to clear it is a completed re-approval — reviewers see
  "Periodic review re-approval" tasks (`POST /documents/{id}/review-approval`,
  `reapproval` flag in workflow DTOs). A rejected re-approval leaves the
  document released and still overdue.
- **Effective date**: the approver may pass `effectiveDate` when
  completing an approval task (default immediate = pre-2c behavior
  bit-for-bit). Future date → document/version `approved` (visible state,
  distinct from released; the pending version stays invisible to normal
  users because it is not the current version); the daily job flips it on
  the date. At most one pending-effective version per document (a newer
  outcome retires the older one, audited `superseded_before_effective`).
- **Change/CAPA reference** (#12): Should priority — optional free-text
  `change_reference` on version upload, no validation.
- **Acknowledgment (2d)**: department-scoped via live `user_department`
  membership, record-only (nothing gated). Window 7 business days
  (`doccontrol.acknowledgment.*` — deliberately separate knobs from the
  approval 3/1/2). Per-version: every newly-effective version re-opens
  acknowledgment; the (version, user) unique constraint is the
  no-carry-forward rule. Status visible to owner/admin by default, plus
  per-document per-user grants (`document_acknowledgment_access`);
  acknowledge is idempotent and admins are NOT exempt from the
  department-membership rule.
- **The daily job** runs four ordered phases (flip → approval reminders →
  review notices → acknowledgment notices) and is idempotent per business
  date — `WorkflowJobIdempotencyTests` runs it three times on one date and
  proves zero duplicate flips, notifications, or audit rows. Sweep-driven
  state mutations are audited as the non-login System user (V6), so
  `audit_log.performed_by` stays mandatory.
- **Config**: `doccontrol.review.*` (12-month interval, 5/2 reminder and
  escalation thresholds) and `doccontrol.acknowledgment.*` (7/2/2), all
  env-overridable. Notifications: REVIEW_DUE, REVIEW_OVERDUE,
  ACK_REMINDER, ACK_OVERDUE, PENDING_SUPERSEDED — all still via the
  log-only sender until the Graph sender lands.

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
- [x] **Admin status override was a Sprint 1 stopgap** — removed in Phase 2b
  as planned: releases are now driven by the workflow engine (approval
  completion promotes the version via `DocumentService.promoteVersion`).
  An auditor asking "who can release a document without going through
  approval?" now gets the answer "no one" — the engine's approval history
  is the record.
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
- [ ] **Confirm the daily-sweep audit story satisfies the auditor** — the
  manual trigger (`POST /admin/jobs/daily-sweep`) writes a `daily_sweep`
  audit row (who, when, which business date), and its item-level effects
  are audited (flips/clock resets as the System user) plus every send in
  `notification_log`. Scheduled (cron) runs have NO trigger-level audit row
  — they are visible only through those item-level effects. Decide before
  go-live whether that satisfies ISO 9001 evidence needs or whether
  scheduled runs should also write trigger rows (a one-line change in
  `WorkflowNotificationJob.runScheduled`); note the
  `/audit-log`+`/audit-log/export` endpoints are Sprint 4 and are the
  intended way to produce this evidence.
- [ ] **Graph accepts unroutable recipients at submission — delivery
  failures bounce asynchronously to the sender mailbox.** A
  `notification_log` row with channel `'graph'` proves Graph accepted the
  message (202), NOT that it was delivered — verified 2026-09-11 when a
  send to a `@doccontrol.local` placeholder was accepted and its
  non-delivery report went to the sender mailbox. Before go-live: confirm
  every real user's email address is routable (no placeholder
  `@doccontrol.local`/`@doccontrol.test` accounts may survive into a real
  deployment), and decide who monitors the sender mailbox for bounce
  reports.
