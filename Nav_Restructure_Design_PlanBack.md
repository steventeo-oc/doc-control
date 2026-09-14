# Navigation Restructure — Design Plan-Back

Companion to `CLAUDE.md`. Confirmed direction from the owner (2026-09-14):
new top navigation (Documents | Tasks | Departments | Admin | Account
menu), per-section sidebars, and one new backend query. This plan-back
walks it through the existing routing/component structure and flags every
place the current shape makes the rework awkward. **No code has been
written.** Dashboard is explicitly out of scope (separate deferred item).

Grounded in the code on main: `App.tsx` routes (`/` index = DocumentsPage,
`documents/:id`, `tasks`, `lookups`, `users`), `GET /my/tasks`,
`POST /documents/{id}/restore`, and `findVisible` (which does **not**
filter `deleted_at` — a soft-deleted document is still fetchable by id
today; only the lists exclude it).

---

## 1. Target shape

Top nav: **Documents | Tasks | Departments | Admin** + **Account menu**
(top right, replacing the banner's inline identity + Log out).
Visibility: Documents/Tasks/Departments for everyone (every user has at
least one department); Admin only for admins.

| Section | Sidebar | Routes |
|---|---|---|
| Documents | All Documents, My Documents, Trash | `/documents` with a `view` search param (`all` / `mine` / `trash`) |
| Tasks (renamed from "My Tasks") | My Approvals, Pending My Acknowledgment | `/tasks` with `view` (`approvals` / `acknowledgments`) |
| Departments (new) | the user's own departments; admins see all (inactive marked) | `/departments` list, `/departments/:id` detail |
| Admin (renamed from "Lookups"; Departments removed) | Document Types, Tiers, Users | `/admin/types`, `/admin/tiers`, `/admin/users` |
| — | — | `/documents/:id` detail unchanged; `/login` unchanged |

The old `/lookups` and `/users` paths become redirects to their new
homes so bookmarks don't die.

## 2. Flags — where the current structure is awkward (the asked-for list)

### F1 — The `/documents/:id` route collides with Documents sidebar paths

Sidebar entries like `/documents/mine` or `/documents/trash` would be
captured by `documents/:id` ("mine" as an id). **Resolution**: one
`DocumentsPage` with a `view` search parameter (`/documents?view=mine`) —
no new paths, no collision, and the detail route stays untouched. Same
pattern for Tasks (`/tasks?view=acknowledgments`); Tasks has no dynamic
segment, but the consistency is worth more than prettier paths.

### F2 — "The one backend addition" is actually three small ones

1. **Pending My Acknowledgment** (the announced one): `GET
   /my/acknowledgments` — the inverse of `outstandingUsers`: released,
   not-soft-deleted documents whose current version has no acknowledgment
   row for the caller, across the caller's departments (membership-based,
   level-blind — Consumers owe acknowledgments like everyone, per the
   levels plan-back's F4-adjacent rule). Response: document number/name,
   department, effective date, window close, overdue flag. Acknowledging
   stays on the document page (an inline Acknowledge button is an
   optional nicety, not in v1).
2. **Trash listing**: no endpoint returns soft-deleted rows today.
   `GET /documents?trashed=true` — returns trashed documents the caller
   can manage (Manager: their department's; Collaborator/Contributor:
   their own; Admin: all) — the same rule as delete/restore
   (`canManageDocument`), so everything in the list is restorable by the
   caller. Restore itself reuses the existing `POST …/restore` untouched.
3. **My Documents**: the list endpoint has no owner filter.
   `GET /documents?owner=me`.

All three are small parameter/query additions to the existing documents
list and one new read-only acknowledgment endpoint — but they should be
counted, not absorbed: the backend surface grows by three, not one.

### F3 — LookupsPage decomposes; the Members panel extracts

Today's `LookupsPage` is one component with three cards (tiers, types,
departments) and the members panel embedded in the departments card. The
rework splits it: the types card becomes `/admin/types`, the tiers card
`/admin/tiers` (both otherwise unchanged), the departments table is
**deleted** (replaced by the Departments section), and the Members panel
extracts into a shared `DepartmentMembersPanel` component — its new home
is the department detail page, where it renders for Managers and Admins
only (Consumers and Contributors get the read-only view). UsersPage moves
to `/admin/users` unchanged.

### F4 — Account menu contents are an assumption

The banner becomes an Account menu dropdown. Proposed contents: identity
(name, email, departments with levels — read-only), **Change password**
(the self-service endpoint already exists and has no UI today — natural
home), and Log out. Flag if anything else belongs there; nothing else is
invented.

### F5 — Layout restructure is contained but real

`App.tsx` gains a section-layout notion (top nav + optional section
sidebar) instead of today's single flat banner. All existing routes stay
inside the authenticated layout; the change is the chrome, not the
routing tree (per F1, the tree barely grows). Old nav labels disappear —
"Lookups" and the top-level "Users" link included.

## 3. Department detail page (the new page's shape)

- **Info**: code, label, active flag.
- **Documents**: the existing documents list filtered to the department
  (server-side `department=` code filter, so visibility rules apply
  unchanged — members see released + department drafts, per the levels
  plan-back's F4).
- **Members panel** (Manager/Admin only, extracted per F3): the existing
  level controls from the lookup work, unchanged in behavior.
- Consumers and Contributors: info + documents, nothing else — read-only
  exactly as confirmed.

## 4. Out of scope

- Dashboard (explicitly deferred by the owner).
- Inline acknowledge from the Pending pane (optional nicety, later).
- Any permission-reflection UI beyond what the levels plan-back shipped.
- Moving, renaming, or re-routing the document detail page.

## 5. Test impact

- Backend: `GET /my/acknowledgments` (pending set, window fields,
  excludes acknowledged/soft-deleted/non-members); `trashed=true`
  (visibility per `canManageDocument`, restore round-trip); `owner=me`.
- Frontend: no SPA test harness exists — verified per the runbook
  (nav restructure, sidebars, Department detail for each level, Account
  menu, redirects from the old paths).
- Existing backend tests stay green; the new params are additive.
