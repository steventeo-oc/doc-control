# Phase 2 Roadmap — from QA Gap-Analysis Feedback

Companion to `CLAUDE.md`. Captures the real-world gaps surfaced by the QA
team after reviewing the Sprint 1 system, converted from the completed
`Enterprise_DocControl_Gap_Analysis.xlsx` questionnaire into a sequenced
plan. Sprint 1 (auth, lookups, documents, versions, users/roles) is done
and remains the foundation — nothing here replaces it, it extends it.

**Ground rule carried over from Sprint 1**: no phase below gets built
speculatively. Each phase's design still needs the same "confirm the real
shape before building" discipline that caught the ad-hoc-assignment insight
and the visibility bugs in Sprint 1 — this document sequences *what* to
build, not a green light to guess *how*.

## Phase 2a — Organization & Access foundation

**Why first**: every later phase (especially department-specific approval
routing in 2b) depends on users correctly belonging to the right
department(s). Small, contained, low-risk relative to everything else here.

- Multi-department users: `user` ↔ `department` becomes many-to-many
  (mirrors the existing `user_role` join table pattern).
- Department-scoped create/edit permission: only members of a department
  may create or edit documents belonging to that department. Admins remain
  unrestricted. Note: QA flagged (#3) that exceptions are sometimes needed
  — e.g. a non-QA member occasionally needing to edit a QA document. That
  exception mechanism is deferred to "Later," but the permission model
  should be designed so adding named-user overrides later doesn't require
  re-architecting (a permission-override table alongside the department
  rule, not a replacement of it).

## Phase 2b — Real workflow engine (Flowable 8.0.0)

**Why this is the big one**: three "Must" items (department-specific
chains, delegation, escalation/reminders) all point at real BPMN engine
capabilities, not custom code. Combined with the ad-hoc-assignment design
note captured earlier, this is a strong case for using a real engine
rather than hand-rolling workflow logic — delegation and escalation are
exactly what these engines are built for.

**Engine decision (confirmed)**: Flowable 8.0.0, embedded. The bounded
spike was completed against our Spring Boot 3.5.4 stack: both engines
handled ad-hoc per-instance reviewer assignment cleanly; Flowable wins on
trajectory (Camunda 7 is EOL-bound per its own docs; Camunda 8's
distributed cluster doesn't fit single-VM compose) and integration
friction.

**Confirmed requirements (QA conversation)**:
- Approval chains are **single-stage, parallel, 100% required** (matching
  current Alfresco behavior) — including cross-department sign-off: a
  cross-department document simply gets multiple departments' managers
  added as reviewers in that one stage. No sequential multi-department
  chains for now; BPMN keeps the door open if that ever changes (#6).
- Assignees are chosen **ad-hoc, per instance at start time** as either a
  named individual or a **role/candidate-group** (e.g. "ENG Manager") —
  reusing the existing `role` + `user_role` (+ department) structure. No
  new identity tables.
- **Delegation is unrestricted** — any reviewer can delegate to anyone.
- **Escalation defaults (configurable, not hardcoded)**: due date 3
  business days after start; reminder 1 day before and on the due date;
  escalate to document owner + admin when 2+ business days overdue.
  Notifications go through **Microsoft 365 / Graph API** — no generic SMTP
  integration.
- Conditional routing (#9) — Could/Maybe only, not required now.

**Status**: plan-back approved. Implemented and tested: core approval flow
(ad-hoc parallel start, 100% completion with version promotion, rejection,
unrestricted delegation, pooled role tasks via candidate groups, reviewer
visibility) **and** the reminder/escalation job — daily sweep with
configurable thresholds (3/1/2 business days), pooled tasks remind current
role members until claimed, reminders dedup per day and escalations fire
once per task per recipient, all recorded in `notification_log`. The
Microsoft Graph sender completed the phase (2026-09-11): log-only remains
the default until a deployment sets `DOCCONTROL_NOTIFICATION_*`.

## Phase 2c — Document lifecycle extensions

**Status**: implemented and tested (2026-09-10) per the approved plan-back
`Phase2c_2d_Design_PlanBack.md`.

- **Periodic scheduled review** (#10): ONE review interval applies to every
  document (not type-specific) — a configurable value, never hardcoded.
  The document owner is responsible for the review. A missed review flags
  the document as overdue, and the only way to clear the flag is
  re-approval through the workflow engine; reviewers must visibly see that
  a task is a re-approval (periodic review), not a first-time approval.
  Reuses the Phase 2b reminder/escalation job and `notification_log` dedup
  — new notification kinds, no new plumbing.
- **Effective date separate from approval date** (#11): the approver may
  set a future effective date when completing an approval (default:
  immediate — current behavior unchanged). An approved-but-not-yet-
  effective document gets its own visible state, distinct from released:
  normal users keep seeing the previously-effective version as current
  until the date arrives. A scheduled process flips the state on the
  effective date — reusing the daily job's scheduling, not a new
  mechanism.
- **Change Request / CAPA / Deviation reference** (#12) — **downgraded
  from Must to Should**: QA is no longer certain this is needed. If
  built: a simple optional free-text reference field on a document change
  (version upload), no validation against any external system, not a CAPA
  system. Cheap to add alongside the 2c migration, or defer.

## Phase 2d — Read & understood acknowledgment

**Status**: implemented and tested (2026-09-10) per the approved plan-back
`Phase2c_2d_Design_PlanBack.md`. Record-only audit evidence (#13) — NOT an
enforcement gate; nothing is blocked by a missing acknowledgment.

- **Scope**: the document's department — matches the existing department
  model exactly (`user_department`), no new visibility carve-out. Every
  new effective (released) version re-opens acknowledgment for the whole
  department; a prior version's acknowledgment never carries forward.
- **Window**: 7 business days by default, configurable — deliberately its
  own threshold set, separate from the approval workflow's 3/1/2-day
  knobs, since this is longer and lower-stakes. Reminders go to
  non-acknowledging department members near the window close; overdue
  non-acknowledgment escalates to owner + admin. Acknowledgments are still
  accepted after the window (record-only) — the status just shows them as
  overdue.
- **Status visibility**: document owner and admins by default; owner/admin
  can grant specific additional users view access to a given document's
  acknowledgment status — a small per-document, per-user grant list, not a
  role or department-level exception.

## Phase 2e — Distribution control

- **Watermark/stamp on export** (#15): released documents get a visible
  mark (e.g. "Uncontrolled if Printed") when exported/downloaded/printed.
  Needs a PDF-stamping approach — most straightforward if paired with a
  PDF rendition step (may need a library decision; flag for a short
  technical spike, similar in spirit to the Camunda evaluation).
- **Change notification tracking** (#16): notify relevant people when a
  document changes. QA's own answer was tentative ("my personal thinking
  is the owner, previous approvers, and admin") — treat this as a
  reasonable starting default, not a confirmed spec. Reuses 2b's
  Microsoft 365/Graph notification infrastructure — build once, use for
  both approval reminders and change notifications.

## Later — real, but not blocking rollout

Captured so they aren't lost, not scheduled yet:
- Named-user permission overrides beyond department rules (#3)
- Document-to-document relationships/references (#14)
- Retention schedules and disposition (#17)
- Legal hold (#18)
- Dashboard of pending approvals / overdue reviews (#19)
- Approval cycle time / KPI reporting (#20)

## Explicitly not needed (confirmed No)

- External party (auditor/supplier) access (#4) — internal employees only,
  for now.
- Stronger e-signature / re-authentication on approval (#21) — session
  login is sufficient; no regulatory driver for more requires this today.

## Open items (updated 2026-09-10)

- [x] Camunda vs. Flowable spike outcome — confirmed Flowable 8.0.0
  (Phase 2b implemented).
- [x] Who must acknowledge a document (2d) — confirmed: department-only.
- [ ] Who receives change notifications (2e) — still tentative; 2e stays
  not-started until the Graph sender lands AND this is answered.
