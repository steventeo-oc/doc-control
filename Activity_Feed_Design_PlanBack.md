# Activity Feed & Audit Access — Design Plan-Back

Companion to `CLAUDE.md`. Drafted 2026-09-14 at the owner's request;
**not yet approved — no code has been written.** Full plan-back weight:
this touches new backend query logic, permission scoping, a schema
migration, and closes the long-standing go-live checklist item
("/audit-log + /audit-log/export … the intended way to produce this
evidence"). The dashboard's Activity placeholder is replaced only after
this document is approved.

Grounded in the code on main: the `AuditLog` entity (`entity_type`,
`entity_id`, `action`, `performed_by`, `performed_at`, `details` jsonb —
**no department column**), the complete inventory of `AuditService`
write sites (below), the API spec's Sprint 4 rows (`GET /audit-log` with
`entity_type`/`entity_id`/`from`/`to`/`performed_by` params and
`GET /audit-log/export` as CSV, "admin/auditor role only"), the
documents list's `page`/`page_size` pagination pattern, and the nav
grammar from the restructure (sections with sidebars; Admin split).

---

## 1. Target shape

**One permission-scoped query, three surfaces:**

1. **`GET /audit-log`** — the spec's Sprint 4 endpoint, extended from
   admin-only to all authenticated users with server-enforced scoping:
   - `scope` — `mine` (rows performed by the caller; default),
     `departments` (rows whose department is one of the caller's), and
     `company` (**Admin only** — every row; a non-admin requesting it
     gets 403, not a silent clamp).
   - `category` — `documents` | `workflow` | `acknowledgment` |
     `membership`; omitted = all categories.
   - `from` / `to` — ISO dates on `performed_at` (the spec's original
     params; the UI's Today/7/14/28 presets compute them client-side).
   - `page` / `page_size` — same pagination pattern as the documents
     list.
2. **`GET /audit-log/export`** — **Admin only**, same filters, no
   pagination, streamed CSV (`audit-log-YYYYMMDD.csv`); columns:
   performed_at, actor name + email, entity_type, action, entity_id,
   department code, details (jsonb as text). This is the ISO 9001
   evidence export — the go-live checklist item closes when it ships.
3. **The dashboard Activity card** — real data replacing the
   placeholder: `GET /audit-log?scope=mine&from=<7 days ago>&page_size=5`
   — my activity, last 7 days, top 5, footer deep link "All activity →".

**The full Activity view gets a top-level nav entry** (recommendation in
F4): `/activity`, section "Activity" between Departments and Admin, with
the scope filter as the section sidebar — Mine / My Departments
(everyone) and Company (admins only), matching the app's existing
navigation grammar. Category and time-range presets are in-page controls
above the list. The dashboard card deep-links to
`/activity?scope=mine`.

## 2. Flags — the decisions this design turns on

### F1 — `audit_log` has no department column (the load-bearing change)

Department scoping needs to know each row's department. Resolving it at
query time means per-entityType joins (document, version→document,
workflow_instance→version→document, acknowledgment→document, department
rows, user rows) — slow, ugly, and brittle as entity types grow.
**Resolution: migration V9 adds a nullable `audit_log.department_id`
(FK → department, indexed with `performed_at`), populated at write time**
— every write site already holds its department context in the same
transaction (convention 2), so this is free and can never drift.
`AuditService` gains overloads taking the department; the existing
`record`/`recordAs` stay (null department). V9 also backfills existing
rows via direct joins (document-anchored rows and `department` rows are
fully resolvable; `user`, `document_type`, `document_tier`,
`daily_sweep` rows stay NULL). Pre-go-live the dev data is disposable,
so the backfill is a nicety for meaningful dev testing, not a production
need.

### F2 — What "Mine" means (asked-for definition call)

**Rows performed by the caller** (actor view). The alternative —
"activity concerning me" (someone acknowledged a document I own, a task
I'm assigned) — is a reverse lookup with genuinely different scoping
rules and ambiguous edges; it is explicitly **out of scope**, noted as a
Later enrichment. The dashboard card spec ("my activity") reads
naturally as the actor view; System-user rows (sweep-driven flips and
clock resets) never appear in Mine for a human — they appear in
department scope ("the system released SOP-…"), which is exactly the
department-relevant activity.

### F3 — The four categories don't cover everything (by design)

Mapping from the actual write inventory:

| Category | entity_type | actions today |
|---|---|---|
| Documents | `document`, `document_version` | created, updated, deleted, restored, status_changed, review_clock_reset, review_reset_scheduled, original_downloaded |
| Workflow | `workflow_instance`, `daily_sweep` | created (start + re-approval), completed, task_approved, rejected, task_delegated; sweep trigger rows |
| Acknowledgment | `document_acknowledgment`, `document_acknowledgment_access` | created; granted, revoked |
| Membership | `department`, `user` | created, updated, deleted, member_level_changed; user created/updated/password_changed |

`document_type` and `document_tier` rows (admin lookup config) map to
**no category**: they appear in the all-categories view and the Admin
CSV, but a category filter never surfaces them. Rows with NULL
department (lookup config, user rows, sweep triggers) are invisible in
`departments` scope — nothing to match — and visible in Mine (if actor)
and Admin company scope. Both behaviors are conservative by intent.

### F4 — Where the full view lives (the owner's open question — my read)

**Top-level nav entry, "Activity", for everyone — not Admin-section-only
and not deep-link-only.** Reasoning: the feature serves all users under
existing visibility rules (same grammar as Documents/Tasks/
Departments); the dashboard card is deliberately a 5-row teaser, and a
teaser that deep-links to a page you can't find again from the nav is a
dead end; and the Admin capability (company scope + CSV) is just two
controls on the same query — splitting them into the Admin section would
give the same data two homes. Concretely: `/activity` with a section
sidebar **Mine / My Departments / Company (admins)** — the scope filter
wears the app's existing sidebar pattern — plus in-page category and
time-range controls, and the export button visible to admins only. The
alternative (admin audit browse under Admin, personal feed behind the
dashboard link) was considered and rejected as two surfaces for one
query. If the owner prefers keeping the top nav at five items, the
fallback is the same page reachable only via the dashboard deep link —
workable, but discoverability suffers and I'd still route admins'
company view through the same `/activity` page rather than an
Admin-section twin.

### F5 — Reconciliation with the API spec

The spec's `GET /audit-log` ("admin/auditor role only") is superseded in
scope — same path, extended params, all users with server-side
scoping — mirroring how earlier phases re-labeled the original spec's
sprint assignments after QA feedback. `entity_type`/`performed_by` from
the spec are absorbed by `category` and `scope`; `entity_id` is dropped
(a feed filter, not a row lookup — the audit rows themselves remain
immutable and read-only; there is no per-row endpoint). The spec's
"auditor role" does not exist (roles are Admin/User); Admin carries the
auditor capability — a dedicated read-only Auditor role is a Later
candidate, not built here.

### F6 — Row shape and rendering

Response rows: `id, performedAt, actorName, actorEmail, entityType,
action, entityId, departmentCode, details`. Human-readable sentences
("uploaded version 3 of SOP-QA-0001") are rendered **frontend-side**
from a small entityType+action map — keeps the API dumb and the CSV raw;
the document number inside `details` powers the row's link where one
exists. The dashboard card reuses the compact row idiom (one line + muted
meta) and the empty-state icon pattern; its scope is fixed to `mine` per
the owner's spec — switching the card to department scope later is a
one-param change, flagged as a cheap knob, not built.

### F7 — Performance and integrity

Two indexes in V9: `(department_id, performed_at DESC)` and
`(performed_by, performed_at DESC)`; company scope rides
`performed_at`. Table volume at this org is tiny (hundreds of rows/year
per department), so this is hygiene, not tuning. **No write path
changes**: the feed is read-only over the immutable audit trail; nothing
gains the ability to edit or delete rows (retention/disposition stays
Later #17). `notification_log` remains a separate table — delivery
evidence, not activity.

### F8 — What the checklist item looks like when closed

CLAUDE.md's open item ("Confirm the daily-sweep audit story satisfies
the auditor… /audit-log + /audit-log/export endpoints are Sprint 4")
closes when: an admin can browse all rows with category/time filters,
export the filtered set as CSV, and the CSV contains the scheduled-sweep
`triggered` rows (proving the 2026-09-14 decision's value). The
plan-back is the design record; the checklist box gets checked at
implementation, not at approval.

## 3. Out of scope

- "Activity concerning me" reverse feed (F2) — Later enrichment.
- Real-time push / live refresh — the page reads on load, like every
  other list.
- A dedicated read-only Auditor role (F5).
- Retention, disposition, legal hold (roadmap Later #17/#18).
- Any change to how or when audit rows are written — V9 only adds a
  column and backfills; write semantics are untouched.

## 4. Test impact

- **Scoping (the critical tests)**: non-admin requesting `company` →
  403; non-admin `departments` scope sees exactly their departments'
  rows — including System-user rows carrying a department — and never
  NULL-department rows or other departments' rows; `mine` sees only
  own-actor rows. Admin sees all three scopes.
- **Filters**: category mapping (each of the four, and
  not-a-category rows excluded), from/to windows, pagination shape
  (mirrors the documents-list tests).
- **Export**: admin-only (non-admin → 403); CSV header + row shape;
  filter composition survives into the export; scheduled-sweep rows
  present.
- **Migration**: V9 applies cleanly on the existing schema; the
  backfill's resolvable rows land with the right department.
- **Frontend**: no SPA test harness — browser-verified per the runbook
  (2×2 dashboard with the real card; /activity per scope for admin and
  non-admin; filters; CSV download; placeholder gone).
