# Department Membership Levels — Design Plan-Back

Companion to `CLAUDE.md`. New permission requirement confirmed by the
owner on 2026-09-14: `user_department` gains a level, reworking Phase 2a's
department-member predicate with the same weight as an original phase.
This document walks the requirement back through the existing design for
owner approval. **No code has been written.** Implementation starts only
after approval, same discipline as the phase plan-backs.

Grounded in the code on main today: `DocumentService.canModify` /
`requireCanModify` / `requireDepartmentMember`, every caller of those
(including both Phase 2b approval-start gates), `WorkflowService.resolveSlots`,
`UserService.replaceDepartments`, `UserDepartment`, and the live
`findVisible` visibility rule.

---

## 0. What exists today (the exact surface being reworked)

- **`canModify(document)`** = admin OR member of the document's department.
  One flat predicate gates: metadata edit, version upload, soft-delete
  (trash), restore, **`WorkflowService.start`**, **`startReviewApproval`**
  (Phase 2b periodic re-approval), the reviewer-candidates picklist, the
  audited original-download escape hatch, and full version-history
  visibility. Document **create** is gated separately by
  `requireDepartmentMember` (same member-or-admin shape).
- **Reviewer assignment has no permission filter**: whoever may start an
  approval may assign ANY active user or ANY role as reviewer
  (`resolveSlots` validates existence, nothing else).
- **Draft/in-review visibility** already includes department members
  (`findVisible`: owner, reviewers, department members, admin) — every
  level keeps that read right; levels govern *writes*, not reads.
- **Users API**: `CreateUserRequest.departmentIds: List<Integer>`
  (@NotEmpty) and `UpdateUserRequest.departmentIds` (full replacement)
  swap memberships via `replaceDepartments`; `UserDto.departments` is a
  list of `DepartmentDto` with **no level**. There is no
  department-members surface for non-admins.
- **Admin** short-circuits every predicate via `isAdmin()` and holds no
  membership rows — untouched by this design.
- **Ownership** is orthogonal and restricted to department members
  (transfer check), so owners are always members.

---

## 1. The matrix collapses into two document predicates

The confirmed matrix (Manager / Collaborator / Contributor / Consumer ×
own / others' / start-approval / change-levels) maps onto exactly **two**
document predicates plus create plus member management:

| Level | create | edit (metadata + versions) | delete/restore | start approval + reviewer picklist | change member levels |
|---|---|---|---|---|---|
| MANAGER | ✓ | any dept doc | any dept doc | any dept doc | ✓ dept |
| COLLABORATOR | ✓ | any dept doc | **own only** | any dept doc ("anything they can edit") | ✗ |
| CONTRIBUTOR | ✓ | **own only** | **own only** | **own only** | ✗ |
| CONSUMER | ✗ | ✗ | ✗ | ✗ | ✗ |
| Admin | ✓ (everywhere) | ✓ | ✓ | ✓ | ✓ (as with everything) |

- **`canEdit(user, document)`** = admin, or level MANAGER/COLLABORATOR
  (any document in the department), or level CONTRIBUTOR and the user owns
  it. Gates: metadata update, version upload, **start approval**,
  **review-approval start**, reviewer-candidates picklist, audited
  original download, full version-history visibility. The pleasant
  collapse: the matrix's "can start approval on anything they can edit"
  makes start-approval ≡ edit — one predicate, not two.
- **`canManageDocument(user, document)`** = admin, or level MANAGER (any
  document in the department), or level COLLABORATOR/CONTRIBUTOR and the
  user owns it. Gates: soft-delete (trash) and restore only — the
  matrix's "edit-not-delete on others'" line.
- **`canCreate(user, department)`** = level MANAGER/COLLABORATOR/
  CONTRIBUTOR (Consumer excluded — "no create rights at all").
- **`canManageMembers(user, department)`** = level MANAGER. Admin
  continues to bypass everything exactly as today (no membership rows, no
  changes to `isAdmin()` logic anywhere).

`View/download` is not a predicate — it is the existing visibility rule,
unchanged: every level is a member and keeps today's read rights
(including department drafts and downloads).

---

## 2. Flags — decision points and friction

### F1 — API shape: memberships carry levels, omission is a 400

`CreateUserRequest.departmentIds` and `UpdateUserRequest.departmentIds`
become `departments: List<MembershipInput>` where
`MembershipInput(Integer departmentId, String level)` — **level is
`@NotNull` and enum-validated**: an omitted or unknown level is a 400
validation error, never a silent assumption. This is a breaking shape
change to an admin-only surface; the SPA ships in the same change (the
UsersPage department picker becomes department + level pairs).
`UserDto.departments` becomes `List<DepartmentMembershipDto>`
(DepartmentDto + `level`) so every consumer can render the level.

### F2 — Migration: one-time COLLABORATOR retrofit, then no default (V8)

```sql
ALTER TABLE user_department ADD COLUMN level text;
UPDATE user_department SET level = 'COLLABORATOR';   -- ONE-TIME retrofit
ALTER TABLE user_department ALTER COLUMN level SET NOT NULL;
ALTER TABLE user_department ADD CONSTRAINT ck_user_department_level
    CHECK (level IN ('MANAGER','COLLABORATOR','CONTRIBUTOR','CONSUMER'));
```

Explicitly documented as a **one-time data decision**: there is no
production data yet, so every existing membership becomes COLLABORATOR
(the closest match to today's flat member = full-edit semantics). The
column deliberately gets **no DEFAULT** — from this migration forward the
database itself rejects a membership insert without an explicit level,
backing the API's reject-don't-assume rule with a second layer.

### F3 — Phase 2b friction: the approval gates become level-aware (the asked-for flag)

`WorkflowService.start`, `startReviewApproval`, and the
reviewer-candidates endpoint all call `documentService.requireCanModify`
— the flat Phase 2a predicate. All three move to **`canEdit`** (section
1): a Manager or Collaborator starts approvals on anything in the
department, a Contributor only on their own documents, a Consumer never.
Concretely: today's tests where "a department member starts an approval on
a colleague's draft" keep passing for COLLABORATOR (the retrofit level)
and gain new 403 counterparts for CONTRIBUTOR/CONSUMER.

**Reviewer-assignment pool friction (sub-flag F3b):** today whoever may
start may assign ANY active user or ANY role as reviewer
(`resolveSlots` checks existence only). "Consumer = no approval rights at
all" is contradicted if a Consumer is *assigned* to approve.
**Recommendation**: reject named-USER assignees whose membership level in
the *document's* department is CONSUMER (clear 409: "User X is a Consumer
in department 'Y' and cannot be assigned as a reviewer"). ROLE slots stay
unrestricted — roles are department-agnostic and cannot be level-filtered
at assignment time; the residual edge (a Consumer who holds a reviewer
role claiming a pooled task) is a role-design matter, documented rather
than coded.

### F4 — Read visibility is explicitly unchanged

All four levels are members and keep today's read rights: released
documents public-visible, department drafts/in-review visible (existing
`findVisible` clause), downloads included. "Consumer = view/download
only" describes the *absence* of write rights — it does not narrow or
expand visibility, and this plan-back does not touch the (provisional,
Phase-2a) visibility rule.

### F5 — Manager self-service needs a new members surface

Managers are not admins; the Users page is admin-only. New
department-scoped endpoints:

- `GET /departments/{id}/members` — members with levels (Manager of that
  department or Admin).
- `PATCH /departments/{id}/members/{userId}` `{level}` — change one
  member's level; caller must be a MANAGER of that department or Admin.
  Target must be a member (404 otherwise); an omitted level is a 400
  (same rule as F1). Audited as `membership_level_changed` with
  before/after.

**Adding or removing members stays admin-only** (Users page) — the
confirmed requirement covers level *changes* only; flag if that should
grow later. A Manager may change their own level (self-service includes
self); if that leaves the department with zero Managers, level management
falls back to Admins — allowed, no guard, but the SPA should warn on the
last-manager case. Placement recommendation: a per-department "Members"
panel on the LookupsPage (the page that already carries per-department
admin actions), visible to Managers and Admins.

### F6 — Ownership × level interactions

A Consumer who owns a document is contradictory (they could never edit
it, yet the review clock and acknowledgment make owners responsible).
**Recommendation**: ownership transfers require the new owner to hold at
least CONTRIBUTOR in the department (extends the existing membership
check at the transfer site); and when a member's level is *changed* to
CONSUMER while they own documents, the change is allowed but the SPA
warns with the count of owned documents (server allows — ownership is
not silently revoked). Flag if hard-blocking the downgrade is preferred
instead.

### F7 — Version-history and original-download gates move to canEdit

Two quiet semantic shifts inside the rework, called out so they are
chosen rather than absorbed: full version-history visibility (today:
any member via `canModify`) and the audited original-download escape
hatch both move to **`canEdit`** — a Consumer sees the current version
and downloads stamped renditions, but not full history or unstamped
originals. Both were admin-or-member before; Manager/Collaborator/
Contributor keep them.

### F8 — Everything membership-based but level-blind stays level-blind

Acknowledgment (2d) scope, review-clock sweeps, the acknowledgment
reminders, department-scoped search visibility, and the daily job all key
off membership existence, not level — Consumers read and acknowledge
like everyone else. The deferred "Later" named-user cross-department
override item is **untouched**: it remains a separate future item that
would plug into the same predicate seam alongside levels, exactly as the
existing `canModify` extension-seam comment describes — levels do not
replace or pre-empt it.

---

## 3. API summary

| Method & path | Change |
|---|---|
| `POST /users` | `departmentIds` → `departments: [{departmentId, level}]`, level required (F1) |
| `PATCH /users/{id}` | same shape, full replacement unchanged |
| `GET /departments/{id}/members` | **new** — members + levels (Manager of dept / Admin) |
| `PATCH /departments/{id}/members/{userId}` | **new** — `{level}` required; Manager of dept / Admin; audited |
| `UserDto.departments` | gains `level` per entry |
| everything else | same endpoints, level-aware predicates behind them |

## 4. Edge cases

| # | Situation | Decision |
|---|---|---|
| D1 | Department with zero Managers | Allowed (membership removals and self-demotions can create it); level management falls back to Admins. SPA warns on the last-manager self-demotion. |
| D2 | Manager changes their own level | Allowed (self-service includes self); same zero-Manager note as D1. |
| D3 | Level changed while an approval is in flight | In-flight process unaffected — permission is checked at start time; the running approval completes under the rules of when it started. |
| D4 | Level changed to CONSUMER while the member owns documents | Allowed with an SPA warning listing the owned documents (F6); their edit/start rights on those documents end immediately. |
| D5 | Ownership transfer to a Consumer | Rejected — new owner must hold at least CONTRIBUTOR (F6). |
| D6 | Consumer assigned as a named reviewer | Rejected at start time with a clear message (F3b); role slots documented as out of level-gating scope. |
| D7 | Member removed from a department while owning documents | Today's behavior already permits admin removal; unchanged — the documents keep the owner, visibility rules apply, and re-adding restores access. Not a level concern. |
| D8 | Admin in a department with a membership row | Pointless but harmless; admin rights never derive from membership, and the admin short-circuit evaluates first exactly as today. |

## 5. Explicitly out of scope

- The "Later" named-user cross-department override (roadmap #3) — untouched future item on the same seam (F8).
- Per-document or per-version permission overrides.
- Manager ability to add/remove members (level *changes* only, per the confirmed requirement).
- A permission-reflection API for the SPA (`callerCanEdit` flags on document DTOs) — the SPA keeps today's show-then-fail behavior; noted as optional polish later.

## 6. Test impact (when implementation is approved)

- Migration: existing memberships become COLLABORATOR; the CHECK
  constraint rejects level-less inserts.
- Matrix coverage per level: create, edit own, edit others, delete own,
  delete others, start approval own/others, reviewer-candidates, member
  level change (Manager ✓ / non-Manager 403 / Admin ✓), Consumer named-
  assignee rejection, ownership transfer to Consumer rejected.
- Existing Phase 2a/2b tests keep passing where the acting member is
  COLLABORATOR (the retrofit level); new 403 counterparts for
  CONTRIBUTOR/CONSUMER; users-API tests updated for the `departments`
  shape (omitted level → 400).
- SPA verified per the runbook: Users page level pickers, Manager
  members panel on LookupsPage, Consumer login shows read-only surface.
