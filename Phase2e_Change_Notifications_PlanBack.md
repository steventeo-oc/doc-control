# Phase 2e — Change Notifications: Design Plan-Back

Companion to `Phase2_Roadmap.md` and `CLAUDE.md`. The requirement was
confirmed with QA on 2026-09-11 and recorded in the roadmap: **when a
document changes, notify everyone in the document's department** — the
same audience as Phase 2d's acknowledgment tracking, not a separate list.
This document walks that requirement back through the existing design for
owner approval. *(Status: approved unchanged by the owner and implemented
2026-09-11 — `DocumentService.notifyDepartmentOfChange`, the live-path and
flip-path sends, sweep phase 5, and `WorkflowChangeNotificationTests`; 63
tests green.)*

Watermarking (#15) is deliberately **not** in this document — it is a
separate track, deferred until a short technical spike on PDF-stamping
library options has been reviewed.

Everything below is grounded in the code as it exists on main today
(`WorkflowService.complete`, `DocumentService.promoteVersion`,
`DocumentService.notifyOwnerOfSupersededPending`,
`WorkflowNotificationJob`, `AcknowledgmentService.outstandingUsers`,
`GraphNotificationSender`, `notification_log` after V6).

**Headline: this is small.** No migration (V6 already added every column
needed), no new API endpoints, no frontend changes, no new configuration.
One notification kind, one shared send helper, one new sweep phase.

---

## 1. Flags — decision points for the owner

### F1 — A department-wide send must not be able to block or roll back an approval

`GraphNotificationSender.send` throws on failure **by design** ("a broken
Graph must not silently swallow notifications"). The daily job wraps each
item in its own transaction with per-item try/catch, so a Graph outage
there only logs warnings. But the live approval path sends **inline in
the requester's transaction**: `WorkflowService.complete` →
`approveVersionPendingEffectivity` → `notifyOwnerOfSupersededPending`
(today the only live-path send, single recipient). If a change notice to
N department members were sent the same way with failures propagating, a
Graph hiccup would roll back the final approver's completion — the
approval would appear to fail because mail was down.

**Resolution (recommended)**: the change-notice send is best-effort on the
live path — wrapped in try/catch, failure logs a WARN and the approval
still commits. Missed sends are recovered by the catch-up sweep (§3.4):
same-run retry seconds later, plus manual re-run of
`POST /admin/jobs/daily-sweep?date=…` for that business date. The
dedup_key (§3.3) makes every retry exactly-once. Note this deliberately
diverges from `PENDING_SUPERSEDED`, which stays failure-propagating as
shipped — that asymmetry is acceptable (single owner recipient, existing
tested behavior); changing it is out of scope.

### F2 — "A document changes" means: the current-version pointer moves

The trigger is exactly the two pointer-move paths that already exist:

- **Immediate approval completion** (`WorkflowService.complete` →
  `promoteVersion`) — a new version becomes effective the same day;
- **The daily job's effective-date flip** (phase 1 → `promoteVersion`) —
  a deferred approval takes effect on its chosen date.

Explicitly **not** triggers:

- **Re-approvals** (immediate or deferred) — the content is unchanged; no
  new version exists, the pointer never moves, and the acknowledgment
  window does not re-open. QA's "when a document changes" is about
  content people work to, and a periodic re-certification changes
  nothing. (If a "recertified" notice is ever wanted, it would be a new,
  separate kind — out of scope.)
- **Draft uploads, version-history events, rejections** — none of these
  change what is in effect; draft content is invisible to the department
  anyway.
- **Metadata edits** (title corrections etc.) — the in-effect content is
  unchanged. If QA ever wants change-reference-bearing uploads announced
 *before* approval, that is a different notification about a draft —
  out of scope.
- **`PENDING_SUPERSEDED` retirements** — a version that never took effect
  is retired; only the owner is told (existing behavior, unchanged).

**First release counts**: the pointer moving from null to v1 is the
biggest change a document ever has — the department is told "this
document is now in effect". Recommended: yes, notify on first release.

### F3 — Audience: everyone in the department, no exclusions

Recipients = `userRepository.findActiveByDepartmentId(document's
department)` — the exact call `AcknowledgmentService.outstandingUsers`
already makes, evaluated live at send time. Consequences, all accepted:

- The owner is included (owners are always department members).
- Admins are included only if they are members — same rule as
  acknowledgment; membership is the definition, no role carve-out.
- The final approver may receive a notice for an approval they just
  completed (they are usually a department manager). Harmless noise at
  department scale; excluding "the actor" would add a rule that has to
  be explained to QA for zero real benefit. Recommended: no exclusions.
- Inactive users are excluded by the existing finder.
- A user belonging to several departments gets at most one notice per
  document change — the audience is the members of the *document's* one
  department; there is no fan-out to multiply.
- Department with zero active members: nothing is sent; nothing breaks.

### F4 — Dedup: once per version per recipient, ever — not per day

`dedup_key = "change:version=" + version.getId()` per recipient, checked
via the existing `existsByKindAndDedupKeyAndRecipientId`. A version can
only become current once, so the notice is an **event**, not a reminder —
the per-day dedup used by REMINDER/ACK_REMINDER is the wrong shape here.
Once-ever is also what makes every retry path (catch-up sweep, manual
daily-sweep re-run, simulated dates) exactly-once with no extra logic.
The per-version key mirrors the existing `"ack-overdue:version="` and
`"pending-superseded:version="` precedent.

---

## 2. The notification

- **Kind**: `DOCUMENT_CHANGED` (joins REMINDER, ESCALATION, REVIEW_DUE,
  REVIEW_OVERDUE, ACK_REMINDER, ACK_OVERDUE, PENDING_SUPERSEDED).
- **Subject**: `Document changed: <document_number> v<N> now in effect`.
- **Body**: document number and title, the new version number, the
  effective date, and the `change_reference` free text when present
  (2c's Should item finally gets a consumer — shown as
  `Change reference: …`). Plain text, like every existing kind. No deep
  link — there is no configured base URL anywhere in the system yet;
  adding one is a separate, system-wide nicety (out of scope).
- **Anchoring**: `notification_log` row with `document_id`,
  `document_version_id`, the dedup key, recipient, subject,
  `notification_date` (business date: today on the live path, the
  sweep's date in the catch-up phase), and `channel` from the sender
  ('log' / 'graph'). `workflow_instance_id` stays null — this notice is
  not tied to a task. No schema change: every column already exists
  (V6).
- **Audit**: no `audit_log` rows — sending is not a state mutation; the
  `notification_log` row is the record, same as every other kind.

## 3. Where the send happens

### 3.1 One shared helper

A single `notifyDepartmentOfChange(document, version, notificationDate)`
on `DocumentService` — next to `notifyOwnerOfSupersededPending`, which
already injected `NotificationSender` + `NotificationLogRepository`
(`UserRepository` joins them for the audience query). Both trigger paths
and the catch-up phase call it. The daily job's existing `notifyDocument`
helper stays for its own kinds.

### 3.2 Live path — immediate approval completion

`WorkflowService.complete`, right after the successful `promoteVersion`
call (same transaction): try/catch-wrapped send, per F1. The approval
HTTP request gains at most N Graph calls' latency (token-cached); the
department-scale send volume here is tens, not thousands.

### 3.3 Flip path — daily job phase 1

Inside the flip's existing per-item transaction, right after the
successful `promoteVersion`: same best-effort send. Crucially the send
must be caught **inside** the item transaction — if it propagated, the
item's try/catch would roll back the *flip* on a Graph outage, and a
mail problem would silently block effectivity. The flip commits; the
notice retries via the catch-up phase.

### 3.4 New phase 5 — catch-up sweep (makes retries and testing uniform)

```
run(today):
  1. flipDueVersions(today)          # 2c — unchanged
  2. sweepApprovalTasks(today)       # 2b — unchanged
  3. sweepReviewOverdue(today)       # 2c — unchanged
  4. sweepAcknowledgments(today)     # 2d — unchanged
  5. sweepChangeNotifications(today) # 2e — NEW
```

Phase 5 finds versions with `status = 'current' AND effective_at = today`
(document not soft-deleted) and runs the same deduped helper for each.
That query catches both trigger paths on their effective day: flips
landed in phase 1 of the same run, immediate approvals happened earlier
today. So:

- A phase-1 send failure is retried **seconds later in the same run**.
- Any other same-day failure is retried by re-running the manual
  admin endpoint for that business date — the ops lever that already
  exists for date simulation; dedup skips whoever already got theirs.
- The scheduled sweep alone does **not** retry yesterday's failure (the
  query is keyed on today) — that is the honest boundary; the manual
  re-run covers it.
- New department members who join after the effective day are **not**
  sent the old change notice — catching them up is the acknowledgment
  system's job (ACK_REMINDER/ACK_OVERDUE), not this event notice's.

Phase 5 is also what makes the change notice testable through the
existing harness: the idempotency test (sweep run three times on one
date → zero duplicate notifications) extends to it unchanged.

## 4. What does not change

- **No migration** — `notification_log` gained `document_id`,
  `document_version_id`, `dedup_key` and a nullable
  `workflow_instance_id` in V6; nothing new is needed.
- **No new endpoints, no DTO changes, no SPA work** — the notice is
  fully internal. The document page already shows the state the email
  describes.
- **No new configuration** — no thresholds exist for an event notice;
  transport is governed by the existing
  `doccontrol.notification.enabled` (log-only default, Graph when set).
  If an off-switch is ever wanted it is a one-line guard; recommended
  against for now — a silently-disabled change notice would be worse
  than the noise it prevents.
- **The bounce caveat scales with this** — department-wide sends mean
  one stale placeholder address per member bounces per change. This adds
  weight to the existing go-live checklist items (routable-email audit
  before rollout; a named watcher for the sender mailbox); it changes
  nothing in the design.

## 5. Edge cases

| # | Situation | Decision |
|---|---|---|
| D1 | Graph down when the final approver clicks approve | Approval commits; WARN logged; phase 5 of the next sweep run (or a manual daily-sweep re-run for today) delivers the missed notices. |
| D2 | Send succeeded, then the approval transaction rolls back for another reason | The email went out but the log row rolled back with it → a retry would send a duplicate. Graph-accepted mail is async anyway (the bounce caveat); accepted as a rare, self-healing edge — same property the existing `PENDING_SUPERSEDED` send has. |
| D3 | Version effective today, document soft-deleted later the same day | Phase 5 filters `deleted_at IS NULL`; restore resumes sweeps (existing rule). |
| D4 | Simulated date (`POST /admin/jobs/daily-sweep?date=D`) | Behaves like any sweep for business date D: versions effective on D get notices dated D, deduped per version per recipient. |
| D5 | Department membership changes mid-day | Audience is evaluated live per send; whoever is a member when their notice is attempted gets it. |
| D6 | First release (pointer null → v1) | Notified like any change (flag F2) — "now in effect" rather than "changed". |

## 6. Explicitly out of scope

- Watermarking on export (#15) — separate track; PDF-stamping library
  spike first, design after.
- Deep links into the SPA (needs a system-wide base-URL setting).
- Digest/batching, per-user opt-outs, per-department overrides.
- A "recertified" notice for re-approvals (flag F2 — separate kind if
  ever wanted).
- Changing `PENDING_SUPERSEDED`'s failure semantics (flag F1 note).

## 7. Test impact (when implementation is approved)

- Existing 54 tests stay green; a few that assert exact
  `notification_log` contents after completing an approval will see the
  new `DOCUMENT_CHANGED` rows and need small updates.
- New coverage: notice to all active department members on immediate
  approval (incl. first release); on the effective-date flip; **no**
  notice for immediate or deferred re-approvals; dedup once per version
  per recipient across a three-run idempotent sweep; phase-5 catch-up
  for a version flipped in phase 1 of the same run; change_reference
  rendering; D4 simulated-date behavior.
- Workflow/notification tests keep needing the live Postgres (5434) +
  MinIO (9000) dev stack as today.
