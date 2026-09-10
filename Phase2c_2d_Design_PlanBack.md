# Phase 2c / 2d — Design Plan-Back

Companion to `Phase2_Roadmap.md` and `CLAUDE.md`. Requirements were
confirmed with QA on 2026-09-10 (recorded in the roadmap); this document
walks the confirmed requirements back through the existing design — data
model, API shape, and interaction with the Phase 2b Flowable approval flow
— for owner approval. **No code has been written.** Implementation starts
only after this plan-back is approved, same discipline as Phase 2b.

Everything below is grounded in the code as it exists on main today
(`WorkflowService`, `WorkflowNotificationJob`, `DocumentService.promoteVersion`,
`SlotAssignmentListener`, `BusinessDays`, `notification_log`, V1–V5
migrations).

---

## 1. Flags — where this touches or strains the Phase 2b design

Read this section first. Each flag names the existing behavior it
collides with and the recommended resolution. None are blockers; all are
design-level and resolvable, but several amend decisions recorded in
CLAUDE.md, so they should be acknowledged, not absorbed silently.

### F1 — Re-approval must run on a released (current) version; 2b forbids that today

`WorkflowService.start` rejects anything that is not a `DRAFT` version
("Only draft versions can be sent for approval") and allows one
in-progress instance per version. Periodic re-approval has no new version:
it re-approves the currently-released content.

**Resolution**: a separate start path — `POST /documents/{id}/review-approval`
— that targets `document.current_version`, requires document status
`released`, and starts the same `documentApproval` BPMN process with an
extra process variable `reapproval=true` (plus a `kind` column on
`workflow_instance`: `APPROVAL` | `REAPPROVAL`). The completion handler
branches on the kind: a re-approval completion skips the version promotion
(the version is already current) and resets the review clock instead.

### F2 — "Process ended → promoteVersion → released" is no longer the whole story

Today, when the last reviewer approves, `WorkflowService.complete` calls
`DocumentService.promoteVersion` unconditionally: pointer moves, version →
`current`, previous → `superseded`, document → `released`. With effective
dates, that moment splits in two: **approved** (decision made) and
**effective** (in force). For a future effective date the pointer must NOT
move at approval time.

**Resolution**: the completion handler passes the approver's effective
date through. Immediate (default) → exactly today's behavior. Future →
document → `approved` (status already exists in the enum and is already in
the public-visibility set, unused by 2b), version → `approved` (new
version-status value), pointer untouched; the daily job flips it on the
effective date. **This amends the pilot-resolved `current_version_id`
semantics** ("the pointer changes only via an explicit release"): the
pointer now also moves via the scheduled effective-date flip. CLAUDE.md
must be updated when this is implemented.

### F3 — `DocumentVersionStatus` has no "approved" value

`DRAFT / CURRENT / SUPERSEDED` cannot express "approved content, not yet
in effect". **Resolution**: add `APPROVED` to `DocumentVersionStatus`.
Lifecycle: `draft → approved` (future-effective approval completes) `→
current` (effective date flip). Immediate approvals go straight to
`current` as today. The pending version stays invisible to normal users
automatically: it is not `currentVersion`, so the existing
`findVisibleVersion` 404s it and the version list shows only the current
version — no new visibility carve-out needed (owners/admins see it in
history as "approved").

### F4 — `notification_log.workflow_instance_id` is NOT NULL

Every notification today is tied to a workflow task. Review-overdue
notifications (2c) and acknowledgment reminders (2d) have no workflow
instance. **Resolution**: make `workflow_instance_id` nullable and add
nullable `document_id` and `document_version_id` FKs, so each notification
kind anchors to whatever it is about. Dedup keys become per-kind (§5).

### F5 — `AuditService.record` requires a current user; the daily job has none

`AuditService.record` is `Propagation.MANDATORY` and reads
`currentUserProvider.getCurrentUser()` — that's exactly why
`notification_log` exists as a separate, actor-less log. But the
effective-date flip is a state mutation that must land in `audit_log`
(convention 2: every write produces an audit entry).

**Resolution (recommended)**: a dedicated `system` user (email
`system@doccontrol.internal`, `active = false` so it can never log in, no
roles/departments), inserted by migration and used as the actor for all
sweep-driven mutations. This keeps `audit_log.performed_by` mandatory and
gives auditors a clean "the system did this" trail. The alternative —
making `performed_by` nullable — weakens the audit schema for every
future reader; not recommended.

### F6 — "One approval at a time" must become per-document, not per-version

2b enforces one in-progress instance per *version*. A released document
with a review-overdue flag could simultaneously run a draft-version
approval (new content) and a re-approval (current content); both endings
fight over pointer/status. **Resolution**: at start, reject when the
*document* already has an `in_progress` instance (cheap indexed query).
This is a small 2b amendment; existing behavior is unchanged in practice
(one version could only have one instance anyway).

### F7 — The daily job becomes state-mutating, not just notifying

Today `WorkflowNotificationJob` only sends notifications. 2c adds the
effective-date flip. **Resolution**: keep one `@Scheduled` sweep (same
cron), run as ordered phases: (1) effective-date flips, (2) approval
reminders/escalations (unchanged), (3) review notifications, (4)
acknowledgment reminders/escalations. Flips run first so a version that
becomes effective today starts its acknowledgment window the same day.
Each phase stays idempotent and per-item try/caught like today.

### F8 — Rejection of a re-approval leaves the document released (and overdue)

If reviewers reject a periodic re-approval, the document must stay
released — its content is unchanged and already in effect. It simply
remains review-overdue and the escalations keep going. This differs from
draft-version rejection (where nothing was ever released) and should be
stated in the UI ("re-approval rejected — document remains released;
overdue review continues to escalate"). The real fix path is a new version
+ normal approval, which also clears the overdue flag.

---

## 2. Phase 2c — design

### 2.1 Data model (migration `V6__review_and_effectivity.sql`)

```sql
-- Effectivity
ALTER TABLE document_version ADD COLUMN effective_at date;
    -- The date this version took (or takes) effect. Set at approval
    -- completion (approval date when immediate) and by the approver when
    -- a future effective date is chosen. Immutable once effective.

-- Periodic review
ALTER TABLE document ADD COLUMN last_reviewed_at date;
    -- When the in-effect content was last certified (approval or
    -- re-approval completion date, or the effective-date flip).
ALTER TABLE document ADD COLUMN next_review_due date;
    -- last anchor (effective date) + review interval.

-- Change/CAPA reference (Should-priority; rides along or drops out)
ALTER TABLE document_version ADD COLUMN change_reference text;

-- System actor for sweep-driven mutations (flag F5)
INSERT INTO "user" (name, email, active)
SELECT 'System', 'system@doccontrol.internal', false
WHERE NOT EXISTS (SELECT 1 FROM "user" WHERE email = 'system@doccontrol.internal');
```

- **Review overdue is derived, not stored**: `next_review_due IS NOT NULL
  AND next_review_due < today AND status = 'released'`. No flag column →
  no sync bugs; the daily job only notifies. Changing the configured
  interval affects future resets only (stored due dates stand).
- **One clock-reset rule everywhere**: the review clock resets when a
  version *becomes effective* — immediate approval (completion day),
  effective-date flip (flip day), re-approval (completion day if
  immediate, flip day if future). `version.effective_at` records content
  effectiveness; `document.last_reviewed_at` records the latest
  certification of the in-effect content — two concerns, two fields.
- Review tracking applies only to documents with an in-effect version
  (`released` with a current version). Drafts have no review clock;
  superseded/obsolete/trashed documents are skipped by all sweeps.

### 2.2 Engine interaction (Flowable)

- **Same BPMN process** (`documentApproval`), one extra process variable:
  - `reapproval` (boolean, default false) — set by the review-approval
    start path. `SlotAssignmentListener` (or the same listener reading the
    variable) prefixes the task name/description, e.g. "Periodic review
    re-approval — Review document version", so the reviewer sees it in
    Flowable itself, not just in our DTOs.
- **Completion payload** gains `effectiveDate` (ISO date, optional):
  `POST /workflow-tasks/{taskId}/complete {"approved":true,"comment":"…",
  "effectiveDate":"2026-10-01"}`. Absent/null/today ⇒ immediate (current
  behavior bit-for-bit). Only the completion that ends the process uses
  the value; validation: not before today.
- **Completion branches**:
  - Normal approval, immediate → `promoteVersion` (unchanged) + stamp
    `version.effective_at = today` + reset review clock.
  - Normal approval, future → document → `approved`, version → `approved`
    (F2/F3), `version.effective_at = chosen date`, pointer untouched,
    audit `status_changed` with before/after incl. `effective_date`.
  - Re-approval, immediate → no pointer move (already current); reset
    review clock; audit `review_reapproved`.
  - Re-approval, future → nothing moves now; review clock resets at the
    flip. (The old version stays in effect — and stays overdue if it was
    — until the effective date. Honest and simple.)
  - Any rejection → instance `rejected`; for re-approvals the document is
    untouched (F8).
- **Daily-sweep phase 1 (effective-date flip)**: find versions with
  `status = 'approved' AND effective_at <= today`, skip soft-deleted
  documents, then for each: `promoteVersion(version)` (pointer, statuses,
  document → `released` — existing, audited logic), stamp
  `last_reviewed_at = effective_at`, `next_review_due = effective_at +
  interval`, all as the `system` actor. Idempotent by construction (the
  version leaves the `approved` state as part of the flip).

### 2.3 API shape (2c)

| Method & path | Change |
|---|---|
| `POST /documents/{id}/review-approval` | **New.** Body = same assignee shape as workflow start (`{"assignees":[{type,userId|roleName}]}`). Starts a re-approval of the current version. Requires: document `released` with a current version, `canModify`, no in-progress instance for the *document* (F6). Returns `WorkflowInstanceDto` (201). |
| `POST /workflow-tasks/{taskId}/complete` | Body gains optional `effectiveDate`. |
| `GET /documents/{id}` | `DocumentDto` gains `lastReviewedAt`, `nextReviewDue`, `reviewOverdue` (computed), and `pendingEffectiveDate` (present when status = `approved`: the approved version's `effective_at`). |
| `GET /documents` | `DocumentSummaryDto` gains `nextReviewDue` + `reviewOverdue`; new filter `review_overdue=true|false`. |
| `POST /documents/{id}/versions` | Optional `change_reference` form field (Should item). |
| `GET /workflow-instances/{id}`, `/my/tasks`, instance tasks | Task/instance DTOs gain `reapproval: boolean`. |

No new "overdue review" list endpoint — the filter param covers it (the
dashboard is roadmap "Later" #19).

### 2.4 Config (2c)

```yaml
doccontrol:
  review:
    interval-months: 12          # one interval for ALL documents; 0 = tracking off
    reminder-before-days: 5      # business days before next_review_due (QA-tunable)
    escalate-after-overdue-days: 2
```

Independent knobs from the approval workflow's 3/1/2 (annual reviews want
a longer reminder horizon); same shape, same env-override pattern
(`DOCCONTROL_REVIEW_*`).

### 2.5 Review notifications (new kinds, same plumbing)

- `REVIEW_DUE` — to the document owner when `next_review_due` is within
  `reminder-before-days` business days (and on the due date). Dedup
  per day per (document, recipient) — mirrors the approval REMINDER.
- `REVIEW_OVERDUE` — to owner + active admins once
  `next_review_due` is ≥ `escalate-after-overdue-days` business days past.
  Dedup once per (document, next_review_due value, recipient) — the
  per-task-once semantics of approval ESCALATION map naturally onto "per
  review cycle"; if the clock resets (re-approval), the key changes and
  escalation can fire again for the next cycle.

---

## 3. Phase 2d — design

### 3.1 Data model (migration `V7__acknowledgments.sql`)

```sql
CREATE TABLE document_acknowledgment (
    id                  integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    document_version_id integer NOT NULL REFERENCES document_version (id),
    user_id             integer NOT NULL REFERENCES "user" (id),
    acknowledged_at     timestamp NOT NULL DEFAULT now(),
    UNIQUE (document_version_id, user_id)
);

CREATE TABLE document_acknowledgment_access (
    id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    document_id integer NOT NULL REFERENCES document (id),
    user_id     integer NOT NULL REFERENCES "user" (id),
    granted_by  integer NOT NULL REFERENCES "user" (id),
    granted_at  timestamp NOT NULL DEFAULT now(),
    UNIQUE (document_id, user_id)
);
```

- **Who owes**: current *active* members of the document's department
  (`user_department`), evaluated live at read/notify time. No snapshot
  table — "matches the existing department model exactly" was the
  confirmed requirement, and a snapshot would quietly fork that model.
  Someone who leaves the department mid-window simply drops out of the
  outstanding set; their recorded acknowledgment (if any) stays.
- **No carry-forward** falls out of the key: acknowledgment is per
  *version*; each newly-effective version starts the department from
  zero. The unique constraint makes re-acknowledgment a no-op.
- **Window anchor**: the version's `effective_at` (2c field) — immediate
  releases open the window on release day; future-effective versions open
  it on the flip day. You acknowledge what is in effect.
- `document_acknowledgment_access` is the per-document, per-user grant
  list for status visibility. It grants *status visibility only* — no
  document permissions of any kind (released documents are already
  public-visible).

### 3.2 API shape (2d)

| Method & path | Description |
|---|---|
| `POST /documents/{id}/acknowledge` | Acknowledge the document's current (effective) version. Caller must be an active member of the document's department (admins included only via membership — the acknowledged population is defined by the department model). Idempotent: re-acknowledging returns the existing record. Audited `acknowledgment_created`. |
| `GET /documents/{id}/acknowledgments` | Status: acknowledged list (user, when), outstanding list, window (`opensAt`, `closesAt`, `overdue` flag). Visible to owner, admins, and granted users. |
| `POST /documents/{id}/acknowledgments/access` | Grant status-visibility to a user. Body `{"userId": N}`. Owner or admin only. Audited `acknowledgment_access_granted`. |
| `DELETE /documents/{id}/acknowledgments/access/{userId}` | Revoke. Owner or admin only. Audited `acknowledgment_access_revoked`. |
| `GET /documents/{id}/acknowledgments/access` | List current grants. Owner or admin only. |

Access checks follow the house pattern: invisible document ⇒ 404;
visible document but not in the allowed viewer set ⇒ 403 for the
status/grant endpoints, and 403 (not 404) for acknowledge-by-non-member —
the document is public-visible, the caller is simply out of scope.

### 3.3 Config (2d)

```yaml
doccontrol:
  acknowledgment:
    window-business-days: 7      # confirmed default
    reminder-before-days: 2      # business days before the window closes
    escalate-after-overdue-days: 2
```

Deliberately separate from `doccontrol.workflow.*` (confirmed: longer and
lower-stakes). Same env-override pattern (`DOCCONTROL_ACKNOWLEDGMENT_*`).

### 3.4 Acknowledgment notifications

- `ACK_REMINDER` — to each non-acknowledging department member within
  `reminder-before-days` of the window close (and on the close day).
  Dedup per day per (version, recipient).
- `ACK_OVERDUE` — after the window closes, a summary escalation to owner
  + active admins ("N of M have not acknowledged…"). Dedup once per
  (version, recipient) — mirrors approval ESCALATION. Record-only: no
  gate closes; acknowledgments keep arriving and are simply marked
  overdue in the status view.

---

## 4. The daily job after 2c/2d (one sweep, ordered phases)

```
@Scheduled(cron = doccontrol.workflow.reminder-cron)   # unchanged 07:00
run(today):
  1. flipDueVersions(today)        # 2c state mutation, system actor, audited
  2. sweepApprovalTasks(today)     # 2b REMINDER / ESCALATION — unchanged
  3. sweepReviewOverdue(today)     # 2c REVIEW_DUE / REVIEW_OVERDUE
  4. sweepAcknowledgments(today)   # 2d ACK_REMINDER / ACK_OVERDUE
```

Flips run first so a version becoming effective today opens its
acknowledgment window the same day and its review clock starts today.
Every phase: per-item try/catch (one broken item never stops the sweep),
idempotent, all sends via `NotificationSender` (log-only today, Graph
when the Azure app registration arrives — none of this changes the
sender contract).

`notification_log` schema after V6: `workflow_instance_id` nullable;
`document_id`, `document_version_id` nullable FKs; `flowable_task_id`
nullable as today. Each kind anchors to what it concerns.

---

## 5. Edge cases & decided defaults

| # | Situation | Decision |
|---|---|---|
| D1 | Effective date = today or in the past on the complete call | Treated as immediate; validation rejects dates before today. |
| D2 | New approval completes while another outcome is pending-effective | Only one pending-effective version may exist per document. If a second approval completes first, the older pending version is retired (`superseded`, audit `superseded_before_effective`, owner notified) and the newer outcome applies. Rare (the flip lands within a day of the date), but the rule removes the race. |
| D3 | Review-approval requested while status is `approved` (pending effective) | Rejected — re-approval targets the in-effect version; wait for the flip (or the pending outcome to be superseded). |
| D4 | Interval config changes mid-life | Stored `next_review_due` stands; new interval applies at the next reset. |
| D5 | Document soft-deleted while pending-effective / overdue / in a window | All sweeps skip `deleted_at IS NOT NULL`; restore resumes. |
| D6 | Re-acknowledge (idempotency) | Return the existing record; audit only the first. |
| D7 | Acknowledge by a user outside the document's department | 403 (document is visible; caller is out of the acknowledged population). Admins are not exempt — membership is the rule. |
| D8 | Review reminder/escalation thresholds | Independent `doccontrol.review.*` knobs (default 5/2), not shared with the approval 3/1/2 — annual cycles need a longer reminder horizon. QA-tunable. |
| D9 | `IN_REVIEW` document status is currently never set by 2b (documents stay `draft` while tasks are open) | Out of scope for 2c/2d — noted here because the new `approved` state sits adjacent to it. If QA wants `in_review` populated, that's a small separate change. |

---

## 6. Explicitly out of scope

- Phase 2e (watermarking, change-notification tracking) — untouched;
  change notifications on effective-date flips belong to 2e and stay
  unstarted.
- Any enforcement gating in 2d (confirmed record-only).
- Per-type or per-document review intervals (confirmed: one global
  interval).
- Validation of the change/CAPA reference against external systems
  (confirmed: free text, Should priority).
- Holiday calendars in `BusinessDays` (structure already allows adding
  one; not needed for these defaults).

## 7. Test impact (when implementation is approved)

- Existing 41 tests must stay green: immediate approvals take the exact
  current code path (`promoteVersion` unchanged for that case).
- New coverage: future-effective approval + flip (incl. pointer stays,
  then moves); re-approval start/complete/reject + review clock reset;
  review-overdue notification dedup; acknowledgment window (business
  days), reminders/escalation dedup, per-version re-acknowledgment,
  access grants; system-actor audit rows; D2 supersession race.
- Workflow/notification tests need the live Postgres (5434) + MinIO
  (9000) dev stack as today.
