# "Started by Me" Tasks Pane — Short Plan-Back

Companion to `CLAUDE.md`. Drafted 2026-09-14 at the owner's request;
**not yet built — no code until reviewed.** Real gap confirmed: there is
no way to track approvals you *started* — the Tasks panes cover reviews
assigned to you and acknowledgments you owe, and completed-approval
history lives in Activity (linked from Tasks as of 0d6f4b0) but only as
raw audit rows, without per-reviewer state.

Grounded in the code on main: `WorkflowInstance` carries
`startedBy` (User), `status` (IN_PROGRESS / COMPLETED / REJECTED),
`kind` (approval / reapproval), `startedAt`, `completedAt`;
`WorkflowInstanceRepository` has no started-by query yet;
`GET /workflow-instances/{id}` and `…/tasks` are gated only by document
visibility (`requireVisible`) — which every starter passes, since
`canEdit` holders are department members and members see department
drafts (levels plan-back F4) — but the tasks endpoints return **active
tasks only**, so "who has already approved" is invisible there today.

---

## 1. Target shape

**Backend — one new read endpoint, `GET /my/started-instances`**: the
caller's started instances (`startedBy` = caller, matching the existing
`/my/tasks` + `/my/acknowledgments` naming family), newest first, no
pagination (a user's own starts are a handful; F3). Each row reuses the
existing instance DTO fields (documentId, documentNumber, versionNumber,
status, reapproval, startedByName, startedAt, completedAt) plus, **for
IN_PROGRESS instances only**, an embedded per-reviewer breakdown:

    reviewers: [ { name, state: "approved" | "pending", role: string | null } ]

- **approved** entries come from Flowable's **finished** tasks
  (HistoryService, plan-back F1) — assignee resolved to a name the same
  way `toTaskDto` already does.
- **pending** entries come from the active tasks the instance-detail
  path already resolves: a claimed task shows its assignee; an
  unclaimed pooled task shows the **candidate role** as the pending
  party (`role: "ENG Manager"`, no individual — nobody has committed
  yet, F5). Delegations surface naturally: the current assignee is the
  pending party.
- COMPLETED / REJECTED rows carry no `reviewers` array — the status,
  kind and `completedAt` tell the story, and the document page's
  approval history holds the detail.

**SPA — a third Tasks pane**: sidebar entry **"Started by Me"** →
`/tasks?view=started` (the established `?view=` pattern, F1 of the nav
restructure). Rows: document number (link to `/documents/:id`), version,
status badge (in review / approved / rejected — the existing badge
vocabulary; `reapproval` badge when kind is re-approval), started date,
and for in-progress rows the reviewer line: ✓ approved names / … pending
names-or-roles. No new actions on the pane — the document page stays the
action surface (same rule as every dashboard card).

## 2. Flags

### F1 — "who approved" requires Flowable history (the one new mechanism)
Active-task queries cannot show completed reviewers. Flowable's
HistoryService (`createHistoricTaskInstanceQuery().processInstanceId(…)
.finished()`) provides assignee + end time at the engine's default
`audit` history level — auto-configured as a bean alongside TaskService,
never used in this codebase yet. Verified against the engine defaults at
build time; if the level were ever `none`, the per-reviewer breakdown
degrades to pending-only rather than erroring.

### F2 — the starter sees reviewer names
Justified: the starter holds `canEdit` on the document — the same
surface the owner and reviewers already see names on. No new
information leak beyond today's instance detail.

### F3 — no pagination
`startedBy = caller` scopes the set to a person's own starts. Add
page params only if a real user's list ever grows (not built).

### F4 — reuse, not duplication (the owner's stated constraint)
The endpoint reuses the existing DTO assembly and reviewer-resolution
idioms (`toTaskDto`'s name lookup, `resolveReviewers`' role handling);
the only genuinely new query logic is the repository's
`findByStartedByIdOrderByStartedAtDesc` and the finished-task history
query. No new tables, no new status tracking — Flowable remains the
single source of truth.

### F5 — pooled tasks render as roles, not people
An unclaimed candidate-group task has no committed reviewer; showing
individuals would fabricate accountability. The role is the pending
party until someone claims.

## 3. Out of scope

Per-instance drill-in from the pane (the document page + existing
instance endpoints already serve it); any action (delegate/approve)
from the pane; pagination; showing re-approval completions differently
beyond the existing re-approval badge.

## 4. Test impact

New backend test class: starter sees own started instances (approval
and re-approval kinds); another user's list excludes them; in-progress
instance with two named reviewers shows [approved, pending] after one
approves; rejected instance reports rejected with no reviewers array;
pooled-task instance renders the role as pending. Frontend: no SPA
harness — browser-verified per the runbook (pane per role, states,
links). Existing 113 stay green; smoke re-run per the standing habit
after the stack rebuild.
