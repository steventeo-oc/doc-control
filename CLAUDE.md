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
| Workflow engine | Camunda or Flowable (Spring-native BPMN) — **Sprint 3+, not Sprint 1** |
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
  only to the document owner, any assigned reviewers, and admins. Any
  authenticated user may create a document (no department restriction on
  creation). This is a starting rule and expected to be revisited once real
  usage patterns are known — not a permanent design constraint.
- **Login identifier** — login by `email` (already unique on `user`). No
  separate username field.
- **Confirmed low-stakes assumptions**: Java 21 + Spring Boot 3.x; Maven;
  session-cookie auth via Spring Security; `audit_log.details` as Postgres
  `jsonb`; seed roles limited to `Admin` and `User` for now (role names like
  "QA Reviewer" arrive with Sprint 3 workflow work, not before).

## Sprint 3 design note (captured early, not yet acted on)

Observed from actual current Alfresco usage (both the real workflow export
reviewed during planning and confirmed directly): reviewers are assigned
**ad-hoc, per approval instance**, not fixed in advance. Whoever starts an
approval picks the specific reviewers (any number) at that moment; the
"Required Approval Percentage" setting applies to that instance's chosen
group, not a fixed roster.

This means the current schema's `workflow_stage_assignee` — tied to the
*template* — is likely the wrong shape. The template should define
*structure* (stage count, parallel/sequential, required approval
percentage); *who* fills each stage should be chosen at
`workflow_instance` start time, not baked into the template. Likely
requires an instance-level assignee table distinct from any
template-level defaults.

**Do not implement this yet.** This is a structural note for whenever
Sprint 3 workflow design actually starts — captured now so it isn't lost,
not a green light to start building it. Real approval-chain shape
(sequential vs. parallel across departments, whether it varies by document
type) still needs confirmation from a real QA conversation before Sprint 3
begins in earnest.

Items discovered during implementation that must be resolved before a real
deployment, even if they don't block Sprint 1 development itself:

- [ ] **Admin password rotation**: no endpoint exists yet to change the
  bootstrap admin's password after first startup. Fold a minimal
  password-change capability into the Users/roles resource work — don't
  ship Sprint 1 as "complete" without it. Until then, the account is stuck
  with whatever `DOCCONTROL_BOOTSTRAP_ADMIN_PASSWORD` was set to at first
  startup.
- [ ] **Confirm `DOCCONTROL_BOOTSTRAP_ADMIN_PASSWORD` and
  `DOCCONTROL_BOOTSTRAP_ADMIN_EMAIL` are actually overridden** at real
  deployment time — the checked-in defaults (`admin@doccontrol.local` /
  `changeme_admin`) are dev-only and must never reach a real environment.
- [ ] **CSRF is currently disabled** (`SecurityConfig`, Sprint 1) — fine for
  now with `SameSite=Lax` cookies and no frontend yet, but revisit once the
  React frontend lands and is making real cross-origin-capable requests.
