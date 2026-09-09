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

## Phase 2b — Real workflow engine

**Why this is the big one**: three "Must" items (department-specific
chains, delegation, escalation/reminders) all point at real BPMN engine
capabilities (Camunda/Flowable), not custom code. Combined with the
ad-hoc-assignment design note captured earlier, this is now a stronger
case for using a real engine rather than hand-rolling workflow logic —
delegation and escalation are exactly what these engines are built for.

Confirmed requirements to design against:
- Approval chains differ by department — each department has a different
  approving manager/group (#5).
- Ad-hoc reviewer assignment at instance start time (captured earlier,
  confirmed by real Alfresco usage) — not fixed in a template.
- Sequential approval is not required for the common case ("parallel is
  enough, but can be more" — #6) — build parallel-first, keep the door
  open for sequential since it's a real BPMN capability either way.
- Reviewer delegation/reassignment while unavailable (#7) — must-have.
- Automatic reminders and escalation for overdue approvals (#8) — via
  **Microsoft 365 / Graph API**, since the company has its own Microsoft
  email domain. Do not build a generic SMTP integration by default.
- Conditional routing (#9) — Could/Maybe only, not required now.

**Before building**: confirm the bounded Camunda vs. Flowable spike (asked
for earlier) was completed, and get its recommendation — this phase is the
reason that evaluation exists.

## Phase 2c — Document lifecycle extensions

- **Periodic scheduled review** (#10): documents need a review-due date
  even without content changes — track it, and this is a natural companion
  to 2b's reminder/escalation infrastructure (same notification mechanism
  can flag overdue reviews, not just overdue approvals).
- **Effective date separate from approval date** (#11): a document can be
  approved now but scheduled to take effect later. Requires a new field
  distinct from the existing status/approval timestamps — needs its own
  small design pass, not an assumption that "approved" and "effective"
  timestamps can be merged.
- **Change Request / CAPA / Deviation reference** (#12): document changes
  should be able to reference an external change-control record number.
  For now this is likely a free-text or structured reference field, not a
  full CAPA system — confirm scope before building; don't accidentally
  build a second nonconformance system inside document control.

## Phase 2d — Read & understood acknowledgment

A small, mostly independent feature (#13): staff must be able to formally
acknowledge they've read and understood a new/updated released document,
with that record tracked (who, which version, when). Effectively a
lightweight training-record capability. Needs:
- A new table (e.g. `document_acknowledgment`: user, document_version,
  acknowledged_at).
- A way to know *who* needs to acknowledge a given document — this needs a
  real answer (all staff? department-scoped? role-scoped?) before building
  — don't guess this one, it directly determines the data model.

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

## Open items before Phase 2b design can start

- Confirm Camunda vs. Flowable spike outcome.
- Confirm exactly who needs to receive change notifications (2e) — QA's
  answer was explicitly tentative.
- Confirm who needs to acknowledge a given document in 2d — all staff,
  department-scoped, or role-scoped.
