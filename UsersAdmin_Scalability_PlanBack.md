# Users Admin Scalability Plan-Back (draft — not yet approved, no code written)

Found during UI/UX review 2026-09-15. Larger and less certain than
`RejectConfirmation_PlanBack.md` — needs a real decision, not a quick fix.
Deliberately kept out of `Design_System_Redesign_PlanBack.md`'s Phase 4
(Admin) scope, since that phase is a reskin and this is a structural problem
a reskin won't fix.

## Problem (confirmed against the code, not just the screenshot)

- `GET /users` (`api/src/main/java/com/doccontrol/identity/UserController.java`)
  returns an unpaginated `List<UserDto>` — every user, every time. No page/size
  params exist on the endpoint today.
- `web/src/pages/UsersPage.tsx` has no pagination state at all (confirmed by
  grep — no `pagination`/`totalPages` in the file), and renders, per user row,
  a nested loop over every department × the 4 membership levels
  (MANAGER/COLLABORATOR/CONTRIBUTOR/CONSUMER) as an inline checkbox+picker
  matrix.
- With today's dev data (17+ departments, per `CLAUDE.md`'s SMK
  smoke-artifact notes), the baseline screenshot of this one page alone
  renders **15,095px tall** for a single viewport-width capture. CLAUDE.md is
  explicit that more departments will be added over time as ordinary data
  changes ("no code should ever assume a fixed/closed set of departments") —
  so this page's cost scales directly with normal company growth, not just
  dev clutter.

## Why this isn't a Phase 4 reskin item

Phase 4 (Admin) in the redesign plan is scoped as "purely
visual/structural... no functional... change." Paginating an endpoint and
restructuring how department memberships are edited per user are functional
changes to the API contract and the interaction model, not a skin swap onto
the same DOM.

## Proposed directions (needs your pick, not mine — these are real trade-offs)

1. **Paginate `GET /users`** the same way `GET /documents` already does
   (page/pageSize/totalElements), and add the equivalent Prev/Next control to
   `UsersPage.tsx`. Straightforward, consistent with the rest of the app.
   Doesn't by itself fix the per-row department matrix bulk.
2. **Collapse each user's department memberships to a summary** (e.g. "ENG:
   Manager · QA: Contributor · +2 more" as a chip row) with an "Edit
   memberships" affordance that opens a `Dialog`/side panel showing the full
   matrix for just that one user. This is the bigger win for the 15k-px
   problem specifically, independent of pagination.
3. **Both** — likely the right end state, but two separate, reviewable
   changes rather than one large one.
4. **Add search/filter by name, email, or department** to the user list —
   optional, but pairs naturally with pagination (#1) once the list is no
   longer "everything on one page" and admins need to find one person in it.

## Scope if approved

- Backend: `UserController`/`UserService` — add page/size params, matching
  the existing `DocumentController` pagination shape for consistency.
- Frontend: `web/src/pages/UsersPage.tsx` — pagination controls (#1) and/or
  the collapsed-membership-summary + edit dialog (#2).
- New backend tests for the paginated endpoint; `UserEndpointTests.java`
  already exists and is the natural home for them.

## Open questions for the owner

- Which direction(s) above, and page size default?
- Is name/email search wanted now, or later?
- Priority relative to the design redesign — before Phase 4, after it, or
  fully independent (my recommendation: independent, since it's functional
  and the redesign is explicitly visual-only)?
