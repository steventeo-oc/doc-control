# Dashboard Landing Page — Design Plan-Back

Companion to `CLAUDE.md`. Candidate from the "Later" backlog (roadmap
#19), refined with the owner 2026-09-14: **exactly three dashlets** — My
Approvals, My Acknowledgments, My Documents (via `?owner=me`). An
"activities feed" dashlet is explicitly EXCLUDED — it needs an audit-log
read API that doesn't exist yet (Sprint 4 scope). This plan-back walks the
existing routing/nav structure and flags every assumption. **No code has
been written.**

Grounded in the code on main: `App.tsx` (index route `/` → redirect to
`/documents`; catch-all `*` → `/documents`), `Layout.tsx` (top nav
Documents | Tasks | Departments | Admin + Account menu; section sidebars
keyed by the first path segment, with a `|| 'documents'` fallback and
"no sidebar when the section has no entries" behavior; `LoginPage`
navigates to `/` on success), and the three data sources already wired in
`web/src/api/resources.ts`: `workflowApi.myTasks()` (`GET /my/tasks`),
`acknowledgmentApi.pending()` (`GET /my/acknowledgments`), and the
documents list with `owner=me`.

---

## 1. Target shape

A new `DashboardPage` with three dashlets, becoming the app's landing
page. The top nav gains **Dashboard** as the first item for everyone:
Dashboard | Documents | Tasks | Departments | Admin (+ Account menu).
**Zero backend changes** — every dashlet reads an endpoint that exists
today and is already typed in the SPA client.

| Dashlet | Source (exists) | Each row shows | Order / limit |
|---|---|---|---|
| My Approvals | `GET /my/tasks` (`WorkflowTask`) | document number, task name (+ re-approval badge), due date — overdue highlighted | due date asc, first 8 |
| My Acknowledgments | `GET /my/acknowledgments` (`PendingAcknowledgment`) | document number/name, department, window close — overdue highlighted | window close asc (nulls last), first 8 |
| My Documents | `GET /documents?owner=me` | document number, name, status | the list endpoint's default order (createdAt desc), first 8 |

Each dashlet: heading with a live count, the rows above, and a footer
deep link into the owning section page ("All my approvals →" →
`/tasks?view=approvals`, etc.). Every row links to the document page —
approve/acknowledge actions stay in their existing homes (Tasks section /
the document page's acknowledgment panel), matching the nav plan-back's
decision not to inline actions.

## 2. Flags — decisions and where the current shape is awkward

### F1 — `/` overload vs an explicit `/dashboard` path

`Layout.tsx` derives the active section from the first path segment with
a `|| 'documents'` fallback — at `/` that fallback would render the
Documents sidebar on the dashboard, so making `/` itself the dashboard
means touching that logic. **Resolution**: an explicit `/dashboard`
route; the index route flips from `<Navigate to="/documents">` to
`<Navigate to="/dashboard">`, and `dashboard` is simply not a key in the
sections config — the existing "no sidebar when the section has no
entries" behavior renders the dashboard full-width with **zero Layout
changes**. Post-login (`navigate('/')`) lands on the dashboard via the
index redirect — no LoginPage change.

### F2 — zero backend additions, with one payload caveat

All three sources exist with the shapes shown above (grounded:
`WorkflowTask` carries documentNumber/documentId/versionNumber, task
name, `reapproval`, `dueDate`, `claimedByMe`, `candidateGroups`;
`PendingAcknowledgment` carries departmentCode, versionNumber,
`windowClosesAt`, `overdue`; the documents list sorts createdAt desc and
applies server-side visibility rules unchanged). Caveat: each dashlet
fetches the **full** list and slices client-side (first N). At this
org's scale that is fine; if a user's task or document list ever grows
large, the fix is a server-side limit parameter — noted, not built. No
pagination in v1.

### F3 — dashlet content assumptions (the asked-for list)

- Counts come from the same payload (`array.length`) — no separate count
  endpoints.
- Approvals: pooled (unclaimed candidate-group) tasks and claimed-by-me
  tasks both belong in "My Approvals" — exactly what `GET /my/tasks`
  returns and what the Tasks pane already shows; rendered as-is.
- Acknowledgments: the `overdue` flag comes from the payload; acknowledging
  still happens on the document page.
- My Documents uses the same request the My Documents sidebar view makes
  (`owner=me`) — same rows, same order, no trashed documents.
- Empty states: one calm sentence per dashlet ("Nothing waiting for your
  approval.") — an empty dashboard is the goal state, not an error.

### F4 — the catch-all route follows the landing page

The `*` route currently goes to `/documents`. Proposal: follow the index
to `/dashboard` so an unknown URL lands on the landing page, consistent
with F1. `/documents` remains a first-class, bookmarkable route — nothing
moves or breaks. Flag if documents is preferred as the catch-all target.

### F5 — what is deliberately NOT on the dashboard

- No activities feed — needs an audit-log read API that doesn't exist
  (Sprint 4); explicitly excluded by the owner.
- No KPI / cycle-time reporting (#20, a separate Later item).
- No admin dashlet — admins see the same three dashlets; the Admin
  section stays where it is.
- No new actions — the dashboard is read-only wayfinding; nothing on it
  mutates state.

## 3. Test impact

- Backend: none — zero endpoint changes; the existing suite stays green.
- Frontend: no SPA test harness — verified per the runbook in a real
  browser: landing after login; all three dashlets for each membership
  level (including a Consumer who owes acknowledgments but can hold no
  approvals); counts matching the section pages; overdue highlighting;
  deep links; empty states.
