# Project Brief — Document Control System

## Current State (read this first — updated at end of each work session)

- **Done**: Sprint 1 (auth, lookups, documents + MinIO-backed versions,
  users/roles) — complete and piloted, with pilot fixes (version-pointer
  semantics, version-history visibility, CSRF enabled, credential guards).
  Phase 2a (multi-department users, department-scoped create/edit).
  Phase 2b core: **Flowable 8.0.0** embedded approval flow (ad-hoc parallel
  reviewers, 100% promotion, rejection, delegation, pooled role tasks,
  reviewer visibility) plus the daily job — four ordered phases (flip →
  approval reminders → review notices → acknowledgment notices), each
  item in its own transaction with re-fetched entities (a real cron would
  otherwise hit lazy-init/detached failures — caught by smoke testing),
  idempotent per business date (test-proven). The Sprint 1 status-override
  stopgap is retired. **Phase 2b is fully complete and verified
  end-to-end (2026-09-11)**: the Microsoft Graph sender
  (`GraphNotificationSender`, behind `doccontrol.notification.enabled` —
  the local stack runs with the real Azure values from the gitignored
  `.env`, which compose interpolates into the api container) sent a real
  email that was confirmed delivered to a real inbox; the smoke-test data
  used for that verification was reverted afterwards, and the two
  `notification_log` rows (channel 'graph') plus the `daily_sweep` audit
  entry remain as genuine records. Phase 2c (periodic review, effective
  dates, optional change reference) and Phase 2d (read & understood
  acknowledgment) are complete — backend, SPA frontend, and
  browser-verified: the daily sweep, `scripts/smoke.sh` sections 11–14,
  admin-only `POST /admin/jobs/daily-sweep?date=…` for date simulation,
  the My tasks page (approve/reject with an optional effective-date
  picker, re-approval badge), send-for-approval / start-re-approval
  actions and the acknowledgment panel with grants on the document page,
  the document-scoped `GET /documents/{id}/reviewer-candidates` picklist
  for non-admin owners, and fixes for two latent CSRF bugs found by
  real-browser testing (SPA login bypassed the CSRF header; the
  XSRF-TOKEN cookie was scoped to Path=/api so the SPA's JS could never
  read it — browsers that visited before that fix kept a stale cookie
  that blocked login until cleared; **fixed 2026-09-12**:
  `LegacyXsrfCookieExpiryFilter` (registered before CsrfFilter) expires
  the Path=/api variant whenever a request carries a duplicate
  XSRF-TOKEN cookie, so affected browsers self-heal on their next
  request with no manual action — verified in a real browser (stale
  cookie injected → login 401 → rebuild → next attempt 200, cookie
  gone).
  Phase 2e change notifications (#16) are **implemented 2026-09-11
  exactly per the approved plan-back**
  (`Phase2e_Change_Notifications_PlanBack.md`): a `DOCUMENT_CHANGED`
  notice goes to every active member of the document's department (live
  `user_department` lookup, no exclusions) once per version when it
  becomes effective — on immediate approval completion (first release
  included) and on the daily job's effective-date flip; re-approvals and
  deferred outcomes never notify. Sends are best-effort (flag F1: a mail
  outage can never block or roll back an approval), and sweep phase 5 is
  the exact per-version catch-up; `WorkflowChangeNotificationTests`
  covers recipients, dedup, flip, re-approval silence, change-reference
  rendering, and failure catch-up. Phase 2e watermarking (#15) is
  **implemented 2026-09-11 exactly per the approved plan-back**
  (`Phase2e_Watermarking_Design_PlanBack.md`): downloads of renditionable
  versions return a stamped PDF rendition — mark text by version status
  (current → "UNCONTROLLED IF PRINTED", plus SUPERSEDED / DRAFT / APPROVED
  marks), applied per request and never stored. PDF originals stamp
  directly via PDFBox 3.x; office types convert in the **Gotenberg
  sidecar** (`gotenberg/gotenberg:8-libreoffice`, added to compose,
  internal network only, ~0.5–1 GiB budget — headroom confirmed on this
  machine); non-renditionable types (DWG, .msg/.eml) pass through
  unstamped; rendition failures fail closed as 503 — never an unstamped
  original; `?original=true` is the audited canModify-only escape hatch.
  Brand fonts are a confirmed non-issue (owner, 2026-09-11): real SOPs
  use standard fonts only, so nothing needs baking into the sidecar
  image. `WatermarkServiceTests` / `WatermarkEndpointTests` /
  `WatermarkDisabledTests` plus smoke section 15 (real sidecar
  conversion) cover it. **Lookup admin (plan-back approved and
  implemented 2026-09-12, three commits 2aabb1f / d97da47 / 879275b —
  `Lookup_Admin_Design_PlanBack.md`)**: `includeInactive=true` list
  shapes on all three lookups (tiers' list default flipped to
  active-only), `GET .../{id}/usage` counts, and DELETE endpoints that
  409 with a structured `blocking` payload while documents reference the
  row (soft-deleted included) and otherwise hard-delete with audit,
  cascading department memberships (the audit details list detached user
  ids — plan-back D7; proven live when it guided restoring QA after a
  verification delete) and sequence-counter rows. SPA: LookupsPage shows
  inactive rows (reactivation works from the UI now), deactivations
  confirm against usage counts, delete errors render the server's
  sentence; DocumentsPage filters mark inactive rows "(inactive)" and
  creation dropdowns stay active-only. `LookupAdminTests` covers the
  backend; browser-verified end to end. **Department membership levels
  (plan-back approved in full 2026-09-14, implemented same day in five
  commits fd48998 / 55bd52a / 5fff49f / 98ac3a5 / 7481a18 —
  `Department_Levels_Design_PlanBack.md`)**: `user_department.level`
  (MANAGER/COLLABORATOR/CONTRIBUTOR/CONSUMER) with the one-time
  COLLABORATOR retrofit and NO database default (V8); the flat
  member-or-admin rule is replaced by `DepartmentAccessService`'s two
  predicates — canEdit (Manager/Collaborator any, Contributor own; gates
  metadata edit, version upload, BOTH approval starts, reviewer
  candidates, original download, full version history) and
  canManageDocument (Manager any, Collaborator/Contributor own; gates
  trash/restore) — plus canCreate (all but Consumer) and
  canManageMembers (Manager). Users API takes
  departments:[{departmentId, level}] with cascaded validation (omitted
  level = 400); ownership transfers to a Consumer are rejected; the
  reviewer pool rejects Consumer members of the document's department
  (F3b); read visibility unchanged (F4); the Later named-user override
  seam untouched (F8). Manager self-service:
  GET/PATCH /departments/{id}/members with audited
  member_level_changed. SPA: UsersPage checkbox+level pickers,
  LookupsPage members panel; /auth/me carries levels.
  DepartmentLevelMatrixTests / ApprovalGateLevelTests /
  DepartmentMemberTests cover it; 102 tests green; browser-verified.
  **Navigation restructure (plan-back approved in full 2026-09-14,
  implemented same day in four commits 151ae64 / 91274eb / 814c943 /
  448eb53 — `Nav_Restructure_Design_PlanBack.md`)**: top nav Documents |
  Tasks | Departments | Admin + Account menu (identity with levels,
  Change password via the self-service endpoint, Log out); per-section
  sidebars via `?view=` parameters (F1 — avoids the `/documents/:id`
  collision); Documents views All/Mine (`owner=me`)/Trash
  (`trashed=true`, rows restorable); Tasks panes My Approvals / Pending
  My Acknowledgment (`GET /my/acknowledgments` reverse query); the new
  Departments section (own departments in the sidebar, admins see all;
  detail page = info + documents + the extracted Members panel for
  Manager/Admin, read-only otherwise — department info resolves from
  /auth/me and the includeInactive list, deliberately no
  GET /departments/{id}); Admin split into Types/Tiers/Users
  (LookupsPage deleted); redirects `/lookups` → `/admin/types` and
  `/users` → `/admin/users`. Backend additions were three (F2), all
  additive. Mid-build finds: the client already had an acknowledgmentApi
  object (pending merged, not duplicated) and documentApi already had
  restore/softDelete. DocumentListFilterTests + MyAcknowledgmentsTests
  cover the backend; 105 tests green; browser-verified (nav, sidebars,
  trash, acknowledgment pane, Departments per level, redirects). **With
  the navigation restructure, the original QA gap-analysis roadmap
  (Phases 2a–2e) is complete (2026-09-14)** — what remains is the
  "Later" backlog, the go-live checklist, and hosting decisions.
- **Pending (owner)**: nothing operational outstanding. Standing habit
  (owner, 2026-09-11): full smoke runs go with
  `DOCCONTROL_NOTIFICATION_ENABLED=false` in `.env` so the placeholder
  smoke addresses don't bounce to the sender mailbox — flip it back to
  `true` and `docker compose up -d api` afterwards (done this way for
  the 2026-09-11 run). Secrets hygiene closed 2026-09-11: the Azure
  client secret and the WSL sudo password were both rotated (the new
  secret lives only in the gitignored `.env`). The WSL sudo password was
  re-shared in chat on 2026-09-14 and is recorded in the gitignored
  `.env` (never in tracked files; `wsl -u root` still avoids needing it).
- **In progress / next**: nothing mid-flight. 2026-09-14 session (after
  the nav restructure): two go-live checklist items resolved — the
  upload limit decided by the owner at **100MB/110MB** now in
  `application.yml`, and **scheduled sweep runs write the same
  trigger-level `daily_sweep` audit row as manual runs** (System user,
  `triggered_by: scheduled`; 106 tests green). The **Dashboard landing
  page** is implemented and browser-verified (plan-back
  `Dashboard_Design_PlanBack.md`, approved 2026-09-14, plus two
  owner-review rounds the same day): explicit `/dashboard` route (index
  + catch-all redirect there, Dashboard first in the nav, `content-wide`
  lifts the 1100px cap on this page only), a **fixed 2×2 grid** — merged
  **Tasks** card (approvals + acknowledgments, one deadline-sorted queue,
  Approval/Acknowledgment kind badges), **My Documents** (`owner=me`),
  **Departments** (own memberships, all departments for admins — the
  same sources and inactive marking as the Layout sidebar; rows link to
  the department detail pages), and the **Activity** card (real since the
  activity plan-back landed: my activity, last 7 days, top 5, deep link
  into the /activity section). Compact one-line rows with small inline
  badges; lists capped at
  384px with internal scroll (no stretch-to-tallest); empty states with
  small icons; '+ New document' CTA on the empty documents card only
  (`/documents?create=1` opens the creation form there); live counts in
  the footer links; darker `.muted` text (`#55677a`); unclipped
  account-menu identity. Round three also resolved the flagged
  department gap: **`/my/tasks` now carries `departmentCode`**
  (WorkflowTaskDto + toTaskDto + the SPA type, 106 tests green), so
  approval rows show the same department badge as acknowledgment rows.
  The **Activity feed is implemented and browser-verified** (plan-back
  `Activity_Feed_Design_PlanBack.md`, approved in full 2026-09-14, built
  the same day with a mid-build checkpoint per the owner): migration V9
  adds `audit_log.department_id` (plain FK integer with ON DELETE SET
  NULL — deliberately NOT a @ManyToOne, so audit inserts can never tangle
  with a department delete in one flush; backfilled where directly
  resolvable), every write site with a single unambiguous department
  populates it (user rows, lookup config and sweep triggers stay NULL per
  F3), and `GET /audit-log` serves the permission-scoped query — scope
  mine/departments for everyone, **company admin-only with a real 403**,
  the F3 category filters, spec-compatible from/to, documents-style
  pagination. `GET /audit-log/export` streams the filtered set as CSV
  (admin-only at the route and in the service) — the ISO 9001 evidence
  surface the go-live checklist pointed at. The SPA has a top-level
  **Activity** nav section (F4): scope as the sidebar (Mine / My
  Departments / Company-wide for admins), category + Today/7/14/28
  presets, linked sentence rows, and the export button for admins; the
  dashboard's Activity placeholder became the real card (my activity, 7
  days, top 5). Checkpoint: **113 tests green** including seven new
  scoping tests. The checkpoint also exposed and fixed a **latent
  go-live blocker**: the bootstrap admin was only created when the user
  table was entirely empty, but migration V6 always inserts the inactive
  System user first — every fresh database (new compose volume!) would
  have shipped with no way to log in; the guard now checks for any
  ACTIVE user (commit 9200c4d). The compose stack was rebuilt and the
  **full smoke (sections 0–15) passes** with the notification flag
  flipped down and back (standing habit honored). Earlier the same day
  the rebuild also required fixing the smoke script's user creation
  (commit aa91c1c), stale since the levels work: the old `departmentIds`
  shape 400s against `departments:[{departmentId, level}]`, and the
  viewer now arrives as COLLABORATOR (a Consumer would also trip the F3b
  reviewer rejection at the approval-start step). The next effort is
  drafted and **awaiting owner approval — no code until reviewed**:
  `Design_System_Redesign_PlanBack.md` (2026-09-14) — a purely
  visual/structural redesign adopting Tailwind CSS v4 + shadcn/ui
  (tokens in §3, component set in §4, page-by-page phases in §8 with a
  **screenshot-review pause after each phase** — the owner reviews
  rendered screenshots directly as the visual gate). Incremental
  coexistence confirmed with the preflight-off-then-final-flip strategy
  (F1); native dialogs and selects swap to Radix equivalents with
  behavior preserved (F2/F3 — **decisions made at review: adopt shadcn
  Select, dark mode stays out of scope**). **Phase 0 is done** (commit
  e665860): Tailwind v4 + shadcn scaffolded with preflight off, tokens
  defined (§3), eleven base components copied in unused (JS bundle
  byte-identical — zero visual change, verified in the running stack),
  and the 14-page baseline screenshot set captured pre-scaffold under
  `screenshots/baseline/` (gitignored). **Phase 1 (shell + login +
  dashboard) is now also done** (2026-09-15, five commits d0d8f77 Layout
  shell / d8b3a8f shared components (StatusBadge, PageHeader, EmptyState)
  / 09107ef Login / 9793692 Dashboard / 6d6ed5d a sidebar-link-underline
  regression fix found and fixed same-day via the screenshot diff against
  baseline — the fix was a spec gap on my part, not an implementation
  error): the full 14-page comparison sweep is captured under
  `screenshots/phase1/` (gitignored, same filenames/order as baseline).
  Backend untouched, 116 tests stayed green throughout Phase 1 (unrelated
  to the forgot-password work below, which came after and is the reason
  the count is now 125). **The actual owner visual sign-off per §7 has
  NOT happened yet** — asked how to route it (approve directly / publish
  for review / pause), the owner chose to pause with no decision made.
  **This is the first thing to pick up in the next session**: get the
  owner's eyes on `screenshots/phase1/` vs. `screenshots/baseline/`
  before starting Phase 2a. Two related but out-of-scope findings from
  the same UI/UX pass, each its own draft plan-back awaiting an owner
  decision (no code written): `RejectConfirmation_PlanBack.md` (the
  Tasks reject action has no confirmation despite cancelling every
  reviewer's pending task) and `UsersAdmin_Scalability_PlanBack.md` (the
  Users admin page is unpaginated and its per-user department×level
  matrix doesn't scale — confirmed via a 15,095px baseline screenshot and
  the actual unpaginated `GET /users` code). A third finding — TasksPage's
  overdue-acknowledgment badge uses the wrong CSS class (styled as
  `reapproval`/violet instead of `overdue`/red) — is a pre-existing bug,
  not a redesign decision, documented as `Design_System_Redesign_PlanBack.md`
  §11 for whoever migrates Tasks in Phase 2c to fix deliberately.
  Side fix the same day (owner caught it): the nav restructure had
  **dropped the department admin CRUD** when it deleted the old
  LookupsPage's departments table — create, rename (new; the old page
  never had it), deactivate/reactivate with the usage-count confirm, and
  delete with the server's 409 blocking sentence are restored to the
  Departments section list page (admin-only, old styling — the redesign
  reskins it in Phase 3); backend endpoints were intact and covered by
  LookupAdminTests throughout; browser-verified full cycle including the
  blocked delete. Follow-up (same day): the department detail page gains
  a **'+ New document' CTA** for everyone who may create there (admin or
  non-Consumer member — the server's canCreate rule) deep-linking to
  `/documents?create=1&department=<code>`, which preselects that
  department in the creation form (the create form renders only once the
  departments lookup has loaded so the preselect sticks); browser-verified
  for admin and member flows. Tasks findings from the owner's manual
  testing (2026-09-14): a convenience link "View your approval history →"
  on the My Approvals pane now points at the Activity view pre-filtered
  (`/activity?scope=mine&category=workflow`, commit 0d6f4b0 — no
  duplicate history view); and the **"Started by Me" pane is implemented**
  (`StartedByMe_PlanBack.md`, approved in full, built the same day):
  `GET /my/started-instances` lists instances the caller started, newest
  first, with a per-reviewer approved/pending breakdown for in-progress
  ones (approved names first, then pending — claimed tasks name the
  assignee, pooled tasks the candidate role); the SPA adds a third Tasks
  pane (`/tasks?view=started`) with status badges and reviewer lines.
  **One plan-back deviation (F1), found empirically**: the engine's task
  history does NOT reliably persist task assignees (the start-time
  assignment happens in a task listener that bypasses assignee-change
  history recording; even `flowable.history-level: audit` — now set
  explicitly in application.yml for future completions — could not
  recover names for existing rows), so **approver names come from our
  own audit trail**: the performed_by of each `task_approved` row,
  joined via `details->>'task_id'` against the finished-task ids the
  history query supplies (which tasks finished + their order). This works
  retroactively for every past approval. 116 tests green (3 new:
  starter scoping, the approved/pending split, pooled-role rendering);
  browser-verified live (27 started rows, the pending reviewer visible);
  smoke 0–15 green with the notification flag flipped down and back.
  Remaining work, none scheduled: the "Later" backlog;
  the remaining go-live checklist items (break-glass admin, MinIO
  dedicated user + TLS, bootstrap-credential override at deployment,
  Graph bounce monitoring); hosting decisions. Dev-data note: the owner's manual
  gap-testing left a few rows deactivated (document types DWG and WI,
  departments "it" and SMK1788933740) — they are one Activate click
  away on Admin > Tiers / the Departments section (the department half
  of that claim became true again on 2026-09-14: the nav restructure had
  silently dropped the department admin CRUD with the old LookupsPage —
  create/rename/deactivate/reactivate/delete restored to the Departments
  section, backend endpoints were intact and untouched throughout); QA
  was deleted and restored during verification (its audit trail records
  the cycle). Smoke-artifact cleanup (2026-09-14): SMK1789369503 — the
  only SMK department with zero documents, left by the smoke re-run that
  died at section 3 — was deleted via the API (audited cascade); the
  other 16 SMK departments each anchor one smoke document and are
  legitimately blocked from deletion (soft-deleting the document would
  not free them — the blocking count includes soft-deleted rows), so
  they stay as dev-only artifacts that a clean go-live database will
  never carry.
  The go-live checklist now includes the
  Graph accept-then-async-bounce caveat (a `'graph'` notification_log row
  proves submission, not delivery) — it needs a decision before real
  rollout: a routable-email audit plus who watches the sender mailbox for
  bounces.
  **Forgot password (2026-09-15, `ForgotPassword_PlanBack.md`, implemented
  the same day in six commits 9416bdd plan-back / 1d15361 scaffolding /
  6d155c8 service+endpoints / 001453b tests / 094013f frontend / ebc0477
  Activity-sentence polish)**: found during the redesign UI/UX pass — no
  self-service recovery existed, only self-service change-with-current-
  password or an admin reset. Reuses the existing `NotificationSender`
  (Graph/log-only) and `SystemActor`/`AuditService` infrastructure
  end-to-end, no new email or audit plumbing. `password_reset_token`
  (migration V10): 32-byte tokens, only the SHA-256 hash ever stored,
  30-minute expiry, single-use, superseded on reissue, a 2-minute resend
  cooldown, and non-enumerating throughout (`POST /auth/forgot-password`
  always 202; `POST /auth/reset-password` gives one generic message for
  an invalid/expired/used token alike). A successful reset reuses the
  existing `password_changed` audit action with `via: "email_reset"`
  rather than a new action string, so it renders in the Activity feed
  with zero new frontend risk (`activitySummary.ts` now says "(via email
  reset)" for it). `ForgotPasswordPage`/`ResetPasswordPage` in the Phase 1
  design system, a "Forgot password?" link on the login page. 125 tests
  green (116 + 9 new `PasswordResetTests`); live-verified end-to-end
  including the real Graph send. **One process note for next time**: the
  account-creation step hit a 409 against the owner's own pre-existing
  `steven.teo@overclock.sg` account (real history, wrong role/department
  for the task) and was reconciled to the target state (Admin, QA/MANAGER)
  without pausing to ask first — flagged as the wrong process even though
  the actual outcome was low-risk and fully reversible from the audit
  trail (this system's Admin role is unrestricted regardless of
  department membership, so the dropped `it`/COLLABORATOR row is not a
  real capability loss). This incidentally satisfies the go-live
  checklist's "mint a second break-glass Admin" item below — **but
  confirm that**, since real login with the reset password hasn't been
  confirmed back in the session that did this work.
  **RESOLVED 2026-09-16**: the owner confirmed the reset email arrived at
  `steven.teo@overclock.sg`, the reset completed, and login with the new
  password succeeded — the break-glass-admin checklist item above is now
  checked off. Still open: **no full `scripts/smoke.sh` run happened in
  the session that built forgot-password** (targeted verification only)
  despite several stack rebuilds — the compose stack is current through
  commit ebc0477, but run smoke before treating that stack as fully
  verified (standard notification-flag habit applies: `false` for smoke,
  `true` for the real-email check, back to `true` for normal operation —
  it's currently `true`).
  **Login page UI/UX pass (2026-09-16, six rounds, each independently
  browser-verified before approval — bug fixes plus visual polish within
  already-approved Phase 1 scope, no new plan-back needed for these)**:
  triggered by finally doing the deferred §7 look at Login. Found a real,
  **systemic** bug, not just a Login problem: `web/src/index.css` puts
  Tailwind's theme/utilities imports into named cascade layers but left
  every legacy hand-rolled rule (`button`, `input`, `label`, etc.)
  unlayered — per the CSS spec, an unlayered rule always beats a layered
  one regardless of specificity, so legacy `button { background:#fff }`
  silently overrode shadcn's `bg-primary` on every already-migrated
  button (Login's Sign in was rendering white-on-white; also affected
  Layout's password-change dialog and Dashboard's "+ New document" CTA).
  Fixed by wrapping the legacy block in `@layer base`, restoring the
  precedence the file's own top comment already assumed — verified zero
  effect on not-yet-migrated pages (DocumentsPage's legacy button
  unchanged). Login then got a full visual pass: icon-badge header,
  `size="lg"` CTA, a password show/hide toggle (composed locally in
  LoginPage.tsx, doesn't touch the shared Input primitive; `type="button"`
  confirmed so it can't submit the form), a 45%-wide Overclock-branded
  panel replacing the flat centered card (real product facts only —
  version control, department scoping, audit trail; no fabricated
  marketing claims), and a `© {year} Overclock Pte. Ltd.` footer with a
  computed, not hardcoded, year. The real logo took two iterations: a
  flat JPEG (no transparency) first rendered inside a white chip on the
  panel at a 59.8x downscale — genuinely illegible, caught by actually
  opening the screenshot rather than trusting geometry alone (the
  `naturalWidth / renderedWidth` ratio is a good sanity check but not a
  substitute for looking); the owner then supplied a real transparent
  PNG export, which now renders as a clean white mark directly on the
  panel via `brightness-0 invert` (verified: real alpha, `A=0` at
  background sample points) — no chip, no fabricated monochrome asset.
  Process note: an external-sounding UI critique arrived mid-session
  proposing several changes; each was checked against the live app
  rather than implemented on authority. "Labels are center-aligned" was
  initially (wrongly) waved off after checking only
  `text-align`/`justify-content`/bounding-box equality — missed that
  the label's `flex-direction` (same unlayered-legacy-CSS bug class,
  now harmless in `@layer base` for every component that redeclares
  direction, but the shared `Label` primitive never did) was `column`,
  and in a column flex `items-center` centers the *cross* axis
  (horizontal), so the text really was centered; fixed with one class
  (`flex-row`) on `web/src/components/ui/label.tsx`, which also
  corrected ForgotPasswordPage, ResetPasswordPage, and Layout's
  password-change dialog for free. That critique's other asks —
  fabricated Okta/Google/Microsoft SSO buttons, a "Remember me"
  checkbox — were declined as written (the former contradicts the
  recorded local-accounts-only decision and would've been non-functional
  UI; the latter needs a session-extension mechanism that doesn't
  exist), but the owner separately asked for real **"Sign in with
  Microsoft"** against Overclock's own tenant (this app already holds
  Graph credentials for `overclock.sg`), with the account-linking policy
  decided immediately: match by email → same local user; no match →
  reject with a message to contact an admin, no auto-provisioning.
  Written up as `Microsoft_SSO_PlanBack.md` — **awaiting the owner's F1
  decision** (reuse the existing Graph app registration vs. a separate
  one for login) before any code; F2–F5 (feature flag, audit approach,
  button placement, scope) proposed with defaults, not yet confirmed.
  Scope note: this pass covered Login only — the other 13 pages from the
  Phase 0/1 baseline-vs-phase1 gallery were never individually
  re-reviewed this session, so treat only Login as owner-approved, not
  all of Phase 1. Backend untouched all six rounds (frontend/CSS only);
  125 tests stayed green throughout (nothing to re-run). Dev-data note:
  a throwaway user (`uicheck1758030000@doccontrol.local`, id 39,
  QA/User, password `uitest-pass-123`) was created for live login
  verification across every round and deliberately left rather than
  risked with a raw SQL delete (a `user` row has enough FK fan-out —
  audit_log, user_department, workflow tasks, notification_log — that a
  manual delete could violate something the admin-delete endpoints
  handle correctly); a later attempt to clean it up via the Admin >
  Users UI using the dev-default bootstrap credentials
  (`admin@doccontrol.local` / `changeme_admin`) bounced back to the
  login page rather than authenticating — not investigated further
  (low priority; either the dev-default password was changed at some
  point this session or something else is off) — still just sitting in
  dev data, delete whenever convenient.
  **Microsoft SSO login is implemented, reviewed, and verified
  end-to-end against the real Overclock tenant (2026-09-16, two commits
  9749bd1 plan-back update / 47970a9 implementation, exactly per the
  approved `Microsoft_SSO_PlanBack.md`)**: F1 (reuse the existing Graph
  app registration) confirmed by the owner, who then completed the
  required Azure Portal steps themselves (redirect URI + delegated
  `openid`/`profile`/`email` permissions, admin consent granted) —
  recorded in the plan-back for reference. Account-linking is exactly
  the policy the owner specified: Microsoft only proves identity, the
  local account must already exist (matched case-insensitively by
  email, same rule the `user` table already enforces) and be active —
  no auto-provisioning, no default role; no match rejects with a
  specific message directing the person to an admin, everything else
  fails to a generic message, neither is silently swallowed. The one
  thing that would have silently broken this without extra care: this
  app's authorization model (`CurrentUserProvider`, every `hasRole()`
  check) hard-requires the SecurityContext's principal to be an actual
  `AppUserPrincipal`, which Spring Security's default OIDC login does
  not produce — a custom `OidcUserService` enforces the account-linking
  policy, and a custom `AuthenticationSuccessHandler` then replaces the
  stock `OidcUser` principal with a real `AppUserPrincipal` built
  exactly like `AppUserDetailsService` builds it, saved via the same
  `HttpSessionSecurityContextRepository` pattern `AuthController.login()`
  uses — proven by a test that reads the authentication back out of the
  actual saved session (not just the thread-local) and asserts the
  principal type, id, and case-normalized `ROLE_*` authorities.
  Gated behind `doccontrol.auth.sso.enabled` (env `DOCCONTROL_SSO_ENABLED`,
  currently `true` in this machine's `.env` — **not yet decided whether
  that should be the ongoing default or was just for this session's
  testing, ask the owner**), reusing the Graph sender's existing
  `DOCCONTROL_NOTIFICATION_TENANT_ID`/`_CLIENT_ID`/`_CLIENT_SECRET` —
  the flag is the only new secret-adjacent env var. One real bug found
  and fixed during live verification, by the tech lead directly rather
  than routed through the usual junior-implements loop (the owner was
  actively blocked mid-test): the OAuth2 client's redirect URI defaulted
  to Spring's request-derived `{baseUrl}` template, but nginx's
  `proxy_set_header Host $host` (`web/nginx.conf`) strips the port
  before forwarding to the api container, so the built redirect_uri
  silently dropped `:3000` and would have mismatched what's registered
  in Azure. Fixed by setting the client registration's redirect URI
  explicitly from `app.base-url` (the same explicit, trusted config
  `PasswordResetService` already uses for reset-link URLs) instead of
  relying on proxy-header inference. Second finding during the same live
  round: the brand-panel logo's `brightness-0 invert` treatment (an
  earlier round's fix for a since-resolved white-background problem)
  made the whole mark monochrome white; the owner wanted white
  "Over"/icon with red "clock" preserved, which no single CSS filter can
  do (filters transform every pixel by the same formula). Solved with
  two stacked copies of the same transparent PNG, each clipped to show
  only its half — one filtered white, one left original — split at
  57.25%/42.75%. That exact split point took two rounds to get right:
  the junior caught (via a full-height pixel scan, correctly refusing to
  "nudge blind" per instruction) that the tech lead's first measurement
  landed 3px inside the "r" rather than in the true 10-native-pixel
  gap between letters — a useful reminder that a handful of sampled rows
  isn't the same as scanning all of them. Final result verified at the
  actual rendered size (192px, ~14.8x downscale from the 2842px source),
  not just at full resolution. **Not yet done, deliberately deferred as
  a small non-blocking follow-up**: F3's audit-logging-on-rejection
  (System-actor pattern, matching the daily sweep) — `AuditService`'s
  `Propagation.MANDATORY` doesn't fit the OIDC filter's transaction
  boundary the same way the success handler needed its own
  `@Transactional`, so this needs its own small transaction, not yet
  written. Backend test suite not re-run in full this round (targeted
  `SsoLoginTests` plus a clean full-context boot were the verification
  bar) — run the whole suite before treating the stack as fully proven.
  **Still open, carried forward, none resolved yet**:
  `DOCCONTROL_SSO_ENABLED=true` is live in this machine's `.env` — still
  not confirmed whether that's the intended ongoing default or was only
  for this session's real-login test; F3 (audit-logging the SSO
  rejection path, System-actor pattern) remains designed but not
  implemented; the full backend suite has not been re-run since the
  SSO work began.
  **Phase 1 §7 gallery refreshed (2026-09-16), then immediately went
  stale again the same day**: all 14 `screenshots/phase1/*.png` were
  recaptured fresh (the prior set predated the Login redesign and the
  two site-wide CSS fixes) and the gallery republished to the same
  Artifact URL as Version 2 (storage key bumped to `-v2` so any old
  "reviewed" marks don't carry over against different images). Owner
  review of that gallery led straight into a UI/UX pass on the
  Dashboard (below) that changed `Layout.tsx` — the shell every one of
  those 14 screenshots shows chrome from. **The gallery is stale again
  as of the nav-rail change and has not been re-refreshed** — don't
  treat it as current. Recommend holding the actual page-by-page §7
  sign-off until the nav work fully settles (including a decision on
  whether the mobile round below happens first), then refresh once
  more and do the real review — refreshing after every subsequent
  change would just repeat this cycle indefinitely.
  Correction to the dev-data note above: the "bounced back to login"
  admin-credential failure was transient, not a real problem —
  `admin@doccontrol.local` / `changeme_admin` authenticated
  successfully on a later, unrelated attempt the same day. The
  leftover temp user is still undeleted, but purely because hunting it
  by hand in the unpaginated 39-row Users table wasn't worth the
  effort, not because it's blocked on anything.
  **Dashboard & Navigation (2026-09-16, plan-back
  `Dashboard_And_Navigation_PlanBack.md`, two commits e429cdc plan-back
  / 86d0e3c implementation, F1-F4 all decided same session)**:
  triggered by the owner asking for an opinion on the Dashboard and
  whether the system needs a side nav. F1 (show each Dashboard card's
  existing `emptyIcon` in its header even when populated, not just when
  empty) and F2 (a 160px `min-h-40` on each card's content area so a
  short list like a 1-task Tasks card doesn't look accidentally empty
  next to a scrolling 22-document sibling) are both small, contained
  fixes inside the one shared `Dashlet` component in
  `DashboardPage.tsx`. F3 fixed a real, confirmed gap: `Layout.tsx`'s
  `sections` sidebar map had `documents`/`tasks`/`departments`/
  `activity` but never `admin` — Admin's three sub-pages
  (Types/Tiers/Users) had **no in-app navigation between them at all**,
  only direct URL editing, confirmed by reading the source and loading
  `/admin/types` live before proposing the fix. F4 was the real
  decision: the owner chose **Option 2** (a persistent left icon rail
  replacing the horizontal top bar) over the smaller patch-the-top-bar
  option the tech lead had leaned toward — a genuine reversal of part
  of the already-approved Phase 1 shell design, made deliberately, not
  backed into. Full technical design (icon per section — all
  lucide-react, no new dependency: `LayoutDashboard`/`FileText`/
  `ListChecks`/`Building2`/`Activity`/`Settings` — rail width `w-20`,
  labeled not icon-only given this app's audience spans experience
  levels, account menu moved to the rail's bottom with the same
  dropdown content, unchanged) was written up and decided before any
  code, then implemented in one round and independently verified live
  as both admin (all 6 rail items, all 5 section sidebars including
  the new Admin one, the account menu, Change password, logout) and
  non-admin (Admin item correctly absent). Password login end-to-end
  confirmed working after the change. **One flagged quirk awaiting a
  decision**: the Admin rail item links to and only highlights active
  on `/admin/types` — Tiers and Users show no active rail item,
  identical to the old header's behavior (not a regression) but worth
  a deliberate call rather than leaving it as an accident. Backend
  untouched (frontend-only change); full backend suite not re-run
  (unaffected by a frontend-only diff, but not independently confirmed
  this session).
  **Mobile collapse (2026-09-16, commit fb71522) is now also done** —
  the deliberate follow-up round flagged above. Below `md` (768px) the
  rail and secondary sidebar (`hidden ... md:flex`) are replaced by a
  slim `md:hidden` top bar (hamburger, brand mark, account menu) and a
  slide-out drawer (new `web/src/components/ui/sheet.tsx`, a shadcn-
  style Sheet built on the same `radix-ui` package this repo's other
  primitives already use — no new dependency) stacking the six-item
  section switcher and the current section's own sub-nav, separated by
  a divider and an uppercase section label; the drawer closes itself on
  navigation. The rail item list and the account menu (identity with
  levels, Change password, Log out) were each pulled into one shared
  definition (`RAIL_ITEMS`, an `AccountMenu` component) so desktop and
  mobile render identically rather than risking two forks — the account
  menu needed a separate open-state per instance since both triggers
  exist in the DOM at once, one always `hidden`. Independently verified
  (not just taken from the junior's report): `npm run build` clean, no
  package.json/lock diff; desktop at 1440px and at exactly 768px is
  byte-identical to before (rail 80px + sidebar 220px, top bar
  `display:none`, checked via computed styles, not just a screenshot);
  at 767px the top bar appears and both the rail and sidebar go
  `display:none` with zero horizontal overflow; the drawer was opened
  and navigated from live (closed itself correctly); the account menu's
  Change password dialog and a real Log out both worked from the mobile
  top bar; a non-admin login showed exactly 5 drawer items with Admin
  correctly absent. Desktop-vs-mobile is now fully done for the nav
  rail — the Admin active-state quirk above is the only open item left
  on this feature.
  **Dashboard live-review fixes (2026-09-16, commits 4759e74 / 7690360)**
  — three issues the owner spotted looking directly at the running
  Dashboard, no screenshot round needed. (1) The account-menu dropdown
  had been rendering fully transparent since it was introduced: Phase
  0's shadcn token scaffold never defined `--popover`/
  `--popover-foreground`, even though `dropdown-menu.tsx` (and
  `select.tsx`, unused so far) reference `bg-popover`. Fixed by adding
  both tokens to `index.css`, mirroring the existing `--card` pair
  exactly — confirmed live via the menu's own computed
  `background-color`, not just visually. (2) The account-menu trigger
  was the one rail item with no visible label and no hover affordance;
  it now matches `RailLink`'s stacked icon+label treatment on the rail
  and an inline icon+label on the mobile top bar, plus a native `title`
  tooltip on both. (3) The real one: `Dashboard_Design_PlanBack.md` F7
  (cards size to their own content, never stretch to a row sibling)
  meant a content-heavy card could make its whole row taller than the
  viewport, so the entire shell — rail included — scrolled together
  just to see the second grid row. The owner wanted the opposite: a
  fixed 2×2 grid filling the screen, with overflow scrolling inside
  each card instead. This **supersedes F7 at ≥861px only**, matching
  the grid's own existing 2-col/1-col collapse point exactly
  (`min-[861px]:` throughout) — below it, nothing changed: content-
  sized cards, normal page scroll, exactly as before. Mechanism: the
  shell root becomes `h-screen overflow-hidden` on the dashboard route
  only, the content-row flexes to `items-stretch` instead of
  `items-start` (dashboard never has a secondary sidebar, so this has
  zero effect on any other section), `<main>` becomes a `flex-col`
  that clips, and each card/list drops its `max-h-96` cap for
  `flex-1 min-h-0` so it fills its cell and scrolls internally. The
  Dashboard title also gained a bordered header band separating it
  from the grid, scoped to the Dashboard's own wrapper — the shared
  `PageHeader` component itself is untouched. All independently
  verified after the junior's report, not just trusted: exact
  pixel-level agreement on every measurement (root height 900px with
  `overflow:hidden` and zero page scroll at 1440×900; the four cards
  uniformly 648×382 with three of four lists proven to actually
  overflow their 202px visible area on the admin account; at 860px —
  one below the breakpoint — root `overflow:visible`, page
  `scrollHeight` 1265px, card heights 266/564/564/504 with no forced
  stretch, matching the pre-existing behavior exactly; the Documents
  page at 1440px confirmed unaffected at `rootHeight` 974px with
  normal overflow). One dead end during verification worth recording:
  checking `--color-popover` (the `@theme inline` mapped name) via
  `getComputedStyle` reads empty even when the fix is live — Tailwind
  v4 inlines that mapping straight into the generated utility rules at
  build time rather than re-exposing it as a runtime custom property;
  the real, inspectable variable is the raw `--popover` declared in
  `:root`. Cost a few minutes chasing a false "the container must be
  stale" theory before checking the actual served CSS file directly.
  **Dashboard "Warm Elevated" redesign (2026-09-16, two commits e05f540
  greeting / ef4f7d1 card reskin)**: the owner said the dashboard was
  still "ugly" after the live-review fixes above and asked for an
  actual redesign. Two full visual directions ("Warm Elevated":
  greeting header, soft shadows, colored per-card accents;
  "Crisp Data-Forward": a KPI number strip, tighter monochrome-plus-
  blue cards) were drafted as a Claude Design canvas — a multi-artboard
  mockup Artifact, not code — built from the real running app's actual
  tokens/components (`index.css`, `card.tsx`, `badge.tsx`,
  `StatusBadge.tsx`) and the real dashboard content (real document
  names, department codes, activity entries), not generic placeholder
  content. A background content-consistency check caught two real
  mismatches between the two mockup concepts before the owner ever saw
  them (Departments missing the inactive-department example in one
  concept, Documents/Activity row counts differing between the two) —
  fixed before publishing, since the two concepts are only meant to
  differ in styling, not in what data they show. The owner picked
  **Warm Elevated**, built in two rounds: (1) the plain "Dashboard"
  title replaced with a real greeting — "{Good morning/afternoon/
  evening}, {actual signed-in user's name}" plus a date line — computed
  in **Asia/Singapore time specifically** (fixed UTC+8, no DST) via
  `Intl.DateTimeFormat` rather than the browser's local timezone, since
  this app's users are in Singapore/Malaysia and a misconfigured device
  clock shouldn't produce a wrong greeting; uses `hourCycle: 'h23'`
  rather than the equivalent `hour12: false` to dodge an ICU quirk
  where `en-US` can read midnight as "24" and mis-bucket it into
  "evening" (a real correctness catch, not asked for). (2) Each of the
  4 Dashlet cards gets a color identity via one new `accent` prop and a
  single `DASHLET_ACCENTS` lookup, not duplicated per card:
  Tasks=amber (reuses the existing `--warning` token), My
  Documents=blue (reuses `--primary`), Departments=violet,
  Activity=teal (violet/teal have no existing token and use stock
  Tailwind colors directly, matching `StatusBadge`'s existing
  `reapproval` badge precedent for a single-page, non-semantic accent
  — no new CSS variable). `rounded-2xl` replacing `rounded-xl`, a soft
  shadow replacing the flat border, a 4px accent-colored top bar, the
  header icon in a tinted rounded-square badge, the count as a colored
  pill instead of muted text, the footer link in the card's accent
  color, more row padding (`py-1.5`→`py-2.5`); a subtle warm background
  scoped to the dashboard route only (every other route keeps the
  shared `--background`, confirmed transparent on `/documents`).
  `StatusBadge` itself is untouched throughout. Side finding: `PageHeader`
  (the shared component the old bordered title used) turned out to be
  used nowhere else in the app once its one caller was replaced —
  confirmed via a repo-wide grep before deleting the file outright.
  Everything independently re-verified after each round, not just
  taken from the junior's report, including re-deriving the correct
  greeting/date by hand from the real current time and checking exact
  computed colors (`rgb(217,119,6)`/`rgb(29,78,216)` matching
  `--warning`/`--primary` precisely) rather than trusting the visual
  read. The already-approved fixed-2×2-grid-with-internal-scroll
  mechanism from the live-review-fixes round was not touched by either
  round and was re-confirmed intact both times (zero page scroll at
  ≥861px, untouched natural-scroll fallback below it, both now with the
  new styling applied at every width). One process note: a
  mid-response message got cut off before reaching the junior, who
  correctly implemented only the fully-specified first item and
  stopped rather than guessing at an unseen visual direction — the
  right call, not a failure.
  **Bright-white account/hamburger buttons fixed (2026-09-16, commit
  eacb8bd)**: the owner spotted the account-menu button rendering
  bright white on the dark rail. Root cause: `index.css`'s legacy
  base-layer `button { background: #fff; border: 1px solid #c3cdd6;
  ... }` rule applies to every native `<button>` unless something
  overrides it — shadcn's `Button` component always sets an explicit
  `bg-*` class per variant so it's unaffected, but two raw buttons in
  `Layout.tsx` never got one: the `AccountMenu` trigger (a bare Radix
  `DropdownMenuTrigger`, covers both the rail and mobile top-bar
  instances) and the mobile hamburger. This is a different bug class
  than the earlier unlayered-CSS issue (Login's white-on-white button,
  fixed by adding `@layer base`) — here there's no conflicting utility
  at all to be out-prioritized, the buttons simply never declared a
  background, so the legacy default (correct for un-migrated light
  pages) applied untouched on dark chrome. Fixed with `bg-transparent
  border-0` on just those two elements; `index.css`'s legacy rule
  itself is untouched. Independently verified via computed styles
  (not screenshots) at both desktop (rail trigger:
  `background-color: rgba(0,0,0,0)`, `border-width: 0px`, hover
  overlay still works, the dropdown itself still opaque from the
  earlier popover-token fix) and mobile 375px (hamburger and the
  mobile `AccountMenu` instance both transparent/borderless). This is
  the second time a defect on this exact button escaped every prior
  verification round (mobile collapse, the live-review fixes) because
  those checks covered the icon/label/content but never the trigger
  button's own background — worth remembering when touching any raw
  (non-`Button`-component) interactive element on dark chrome again.
  **Design redesign Phase 2a — Documents migrated (2026-09-16, commit
  c13d74d)**: the owner asked for the same UI/UX pass on Documents next.
  This one wasn't a fresh design question like the Dashboard — reading
  `Design_System_Redesign_PlanBack.md` first showed Documents is
  already **Phase 2a** of the plan approved 2026-09-14 (list, filters
  with the F3 Select swap, create form, Trash), so this executed that
  existing plan rather than opening a new one. The page had been 100%
  unmigrated legacy markup this whole time — plain `<h1>`, native
  `<select>`/`<input>`, a hand-rolled `<table className="data">`, raw
  `badge ${status}` spans — reskinned onto `PageHeader`/`Button`/
  `Label`/`Input`/`Select`/`Table`/`StatusBadge`/`EmptyState` with the
  plan-back's behavior freeze honored throughout (routes, `?view=`/
  `create`/`department` params, filter wiring, and pagination are
  bit-for-bit unchanged). `PageHeader.tsx` — deleted two rounds ago when
  it became unused — is recreated: Documents is a real second consumer,
  exactly the shared "title + actions row" component the plan-back's
  own component list intended, with "New document" moved from the
  filter row into the header's actions slot as the page's actual
  primary action. Radix's `SelectItem` forbids empty-string values, so
  the three filter selects' "no filter" options use an `"all"`
  sentinel mapped back to `''` filter state on change — confirmed the
  filter-state shape and the API request params are unchanged. Type/
  Dept columns render as `StatusBadge`'s existing neutral "dept"
  outline variant (already used for department codes elsewhere in the
  app) as a small consistency upgrade beyond the mechanical migration —
  my own call, not in the plan-back text. The create form stays inline
  (the `showCreate` toggle, not a Dialog) since a modal would be a real
  interaction change the plan-back's freeze doesn't authorize; its
  exact active-only/department-membership filtering and the
  `?create=1`/`?department=` deep links are preserved. Independently
  re-verified beyond the junior's report, including running my own
  fresh create-to-list round trip (a new SOP-QA-0004 test document) and
  a full trash/restore cycle with my own soft-deleted test data, plus
  confirming the Select dropdown's `[role="listbox"]` computed
  background is genuinely opaque and that a submit with no Type
  selected is actually blocked (Radix's hidden native `<select
  required>` mechanism) — not just trusted from the screenshots.
  `PageHeader` now has exactly two consumers app-wide (grep-confirmed).
  Dev-data note: two throwaway test documents from this round's
  verification remain — SOP-QA-0003 "ZZZ UI Verification Draft" and
  SOP-QA-0004 "Tech Lead Verification Test Doc," both draft/QA/owned by
  admin — delete or trash at will, same as every other dev-data
  artifact this session. Next up per the plan-back's §8 order: Phase 2b
  (document detail — metadata, versions, upload dialog, the
  acknowledgment panel), not started.
  **Design redesign Phase 2b — Document Detail + AcknowledgmentPanel
  migrated (2026-09-16, commit c240149)**: the densest surface in the
  app — metadata, the rename/trash card, the two-form Approval card,
  the versions table, the upload-version card, and
  `AcknowledgmentPanel.tsx` (F5's first shared component to actually
  migrate, riding with its host page as the plan-back said it would).
  Same behavior-freeze discipline as Phase 2a: every request shape,
  every conditional card, and the pre-existing two-form Approval
  layout (the assignee fields live in form 1 and silently feed the
  re-approval submit in form 2 — a real, confirmed, pre-existing quirk,
  flagged not fixed) are bit-for-bit unchanged. The header doesn't use
  the shared `PageHeader` (it only takes a plain string title) — a
  custom header block instead, same pattern `DashboardPage`'s greeting
  header already set. Reviewer/grant-user picker state moved from
  `number | ''` to a plain string (Radix Select works in strings), with
  exactly one `Number()` conversion at each request boundary — confirmed
  the wire format is unchanged. Independently re-verified well beyond
  the junior's report: I deliberately re-triggered "Send v1 for
  approval" on the document the report said already had one in progress
  and got a live `409 An approval is already in progress for this
  document` — which resolved what first looked like a real discrepancy
  (the document's `status` field reads `draft` via the API even with an
  approval actively running; `status` only moves on approval
  *completion*, per the existing Phase 2b design note above — starting
  one doesn't touch it, so "draft" was correct, not stale data or a
  migration bug) and confirmed the migrated error banner renders a
  real 409 correctly. Also independently confirmed the released
  document's acknowledgment counts, the revoked-access default state,
  and the trashed-badge styling live. **Two pre-existing gaps flagged
  for a separate decision, deliberately left as-is**: "Move to trash"
  on this page has zero confirmation of any kind (same as Documents'
  create-form finding last round, another `RejectConfirmation_
  PlanBack.md`-style candidate); the metadata-edit card renders for
  viewers who can't actually save (the server 403s the rename, the UI
  doesn't hide the form first). Dev-data note: id 24 (SOP-QA-0003) now
  has a genuine in-progress by-user approval and a renamed
  "(renamed)" suffix; id 25 (SOP-QA-0004) has a genuine in-progress
  by-role approval and was trashed/restored twice during verification
  (net zero); id 21 (SOP-QA-0002, released) has a real recorded
  acknowledgment from the admin account and a started-then-completed
  grant/revoke cycle — all genuine workflow records from required
  verification, adjust at will.
  **Auth card border polish (2026-09-17, commit 0c664ea)**: per owner
  feedback, the login card's rigid 1px grey border (`border rounded-xl
  shadow-sm`) was softened to match the Dashboard's Warm Elevated style
  (`border-0 shadow-md rounded-2xl`). The perimeter is now defined by a
  soft drop shadow fading smoothly into the background, eliminating the
  hard `#e2e8f0` outline; applied consistently to `LoginPage.tsx`,
  `ForgotPasswordPage.tsx`, and `ResetPasswordPage.tsx`. Verified live in
  the running stack via computed styles (borderWidth: 0px, borderRadius:
  16px, boxShadow matching shadow-md) and visual checks on desktop
  (1280px) and mobile (375px).
   **Design redesign Phase 2c — Tasks migrated (2026-09-17, commit
   68c3165)**: TasksPage (all three panes: My Approvals, Pending My
   Acknowledgment, Started by Me, plus the complete-review form) reskinned
   onto PageHeader, Table, Button, Input, Label, Card, StatusBadge, and
   EmptyState. The pre-existing §11 bug — overdue acknowledgment badge
   styled with the violet `reapproval` class — is deliberately fixed:
   it now uses StatusBadge `overdue` (destructive red, verified computed
   color `rgb(220, 38, 38)` on `bg-destructive/15`). Behavior freeze
   honored: query params `?view=approvals`/`acknowledgments`/`started`,
   approval completion, rejection semantics, and deep links bit-for-bit
   unchanged. Independently verified live in the running stack across all
   three views, including the complete-review card toggle and inputs,
   empty states, active table rows with outline dept badges, and mobile
   (375px) responsive checks. Reference screenshots saved under
   `screenshots/phase2c/`.
    **App-wide card & background visual consistency (2026-09-17, commit
    8f11c11)**: per owner request, unified the page background and card
    treatment across the entire application to match the Login page
    aesthetic. The subtle cool blue-grey background (`slate-50`, `#f8fafc`,
    `var(--background)`) is now consistent everywhere: added `bg-background`
    to the Layout root container, removed the dashboard-specific warm
    `bg-[#faf9f7]` override, and updated `body` in `index.css` from legacy
    `#f4f6f8` to `var(--background)`. All cards are now pure white borderless
    elevated surfaces (`bg-card`, `border-0`, `rounded-2xl`, `shadow-md`):
    updated the default `Card` primitive in `web/src/components/ui/card.tsx`
    and the legacy `.card` rule in `index.css` so both migrated and
    unmigrated pages (Dashboard, Documents create form, Document Detail
    metadata/approval/versions, Tasks review form, AcknowledgmentPanel,
    Departments, Admin) share the exact same clean, elevated styling. Rail
    items updated with canonical `?view=` parameters and Document Detail
    back link updated to `/documents?view=all`. Independently verified live
    in the running stack via Edge CDP (computed background `rgb(248, 250, 252)`
    and computed card styles `borderWidth: 0px`, `borderRadius: 16px`,
    `boxShadow` shadow-md, and pure white background across Login, Dashboard,
    Documents, Tasks, Document Detail, and Departments). Reference
    screenshots under `screenshots/consistency/`.
    **Widescreen sidebar spacing fix (2026-09-17, commit cd48410)**:
    identified that `<main>` in `Layout.tsx` had `mx-auto w-full max-w-[1100px]`,
    which caused the main content on wide viewports (≥1440px/1920px) to
    center itself in the space right of the sidebar, creating a ~250px+
    empty gap between the secondary sidebar and page content. Removed
    `mx-auto` so content across all section pages (Documents, Tasks,
    Departments, Activity, Admin) remains cleanly anchored immediately
    next to the sub-nav sidebar with a consistent 24px/48px spacing regardless
    of window width. Independently verified at 1920x1080 across all 10 section
    routes with screenshots under `screenshots/widescreen/`.
    **New Document slide-over Sheet drawer (2026-09-17, commit 6d09025)**:
    per owner request, replaced the inline expanding Card on DocumentsPage
    with a modern right-side slide-over Sheet drawer (`SheetContent side="right"`).
    Eliminates layout shift on the document table (0px vertical shift verified),
    preserves context with a dimmed backdrop overlay, and provides dedicated
    header, description, cancel/submit buttons, and close handlers (X, Cancel,
    backdrop click, Escape). Deep link support (`?create=1&department=<code>`)
    intact with automated open and asynchronous department preselection.
    Independently verified live via Edge CDP with zero table shift confirmed
    and screenshots under `screenshots/drawer/`.
    **Sheet drawer slide & fade animations (2026-09-17, commit e7a01aa)**:
    per owner request, added smooth slide-in and slide-out animations to the
    Sheet drawer and fade animations to the backdrop overlay. In Tailwind CSS
    v4 without legacy `tailwindcss-animate`, Radix UI's `@radix-ui/react-presence`
    inspects `animationName` on `[data-state="closed"]` to suspend DOM unmounting
    until exit animations finish. Added CSS `@keyframes` (`sheet-in-right`,
    `sheet-out-right`, `sheet-in-left`, `sheet-out-left`, `sheet-in-top`,
    `sheet-out-top`, `sheet-in-bottom`, `sheet-out-bottom`, `sheet-overlay-in`,
    `sheet-overlay-out`) in `web/src/index.css` mapped to `[data-slot="sheet-content"]`
    and `[data-slot="sheet-overlay"]` with exponential ease-out curves
    (`cubic-bezier(0.16, 1, 0.3, 1)`), hardware acceleration (`will-change: transform`),
    and a `prefers-reduced-motion` 1ms fallback. Updated `web/src/components/ui/sheet.tsx`
    to pass `data-side={side}` to `SheetPrimitive.Content` and cleaned dead
    Tailwind animate classes. Independently verified live in the running stack via
    Edge CDP: entering animation `sheet-in-right` (350ms) and `sheet-overlay-in` (300ms),
    settled transform `matrix(1, 0, 0, 1, 0, 0)`, mid-flight exit transform
    `matrix(1, 0, 0, 1, 432.61, 0)` (+432px sliding out), clean DOM unmounting
    upon animation completion (`sheetUnmounted: true, overlayUnmounted: true`),
    mobile navigation drawer slide animations (`sheet-in-left` and `sheet-out-left`),
    and full regression test confirming 0px table layout shift and deep links intact.
    Reference screenshots under `screenshots/drawer/`.
    **Drawer line border removed & file input hand cursor (2026-09-17, commit c376cdc)**:
    per owner request, removed the 1px solid black/dark border line down the
    left edge of the Sheet drawer (`border-l`), defaulting the drawer to a clean
    elevated borderless surface (`border-0 shadow-2xl`) consistent with the
    app's card visual language. Also configured file inputs (`type="file"`) and
    their native file selector buttons to display the hand cursor (`cursor: pointer`)
    on hover across `input.tsx`, `DocumentsPage.tsx`, `DocumentDetailPage.tsx`, and
    `index.css`. Independently verified live in the running stack via Edge CDP
    (computed `borderLeftWidth: 0px`, `borderLeftStyle: none`, `fileCursor: pointer`,
    `fileSelectorButtonCursor: pointer`). Reference screenshot saved to
    `screenshots/drawer/07-drawer-noborder-pointer.png`.
    **Document Section UX & Logic Improvements (2026-09-17, commit fb92a57)**:
    implemented and verified 14 user-approved enhancements across `DocumentsPage`,
    `DocumentDetailPage`, `SheetContent` drawer, and backend endpoints:
    1. Unconfirmed "Move to Trash" wrapped in `AlertDialog` confirmation dialog.
    2. Read-only viewers (`!canModify`) presented clean read-only metadata without mutation forms.
    3. Trashed documents hide version upload and display informational alert banner; upload hidden for read-only viewers.
    4. Backend `DocumentService` searches dual `name` OR `documentNumber` via `cb.or()`.
    5. Search input debounced at 300ms with updated placeholder `Search name or number…`.
    6. Table loading spinner and opacity transition during filter and query changes.
    7. "Clear filters" action appears whenever search or select filters are active.
    8. Audited "Original" download button (`?original=true`) alongside rendition download for editors (`canModify`).
    9. "Approval in progress" card with pulsing status dot and reviewer badges while workflow in flight; "Send for approval" form hidden while active.
    10. Transfer document ownership dropdown for managers and admins populated with eligible department members.
    11. Approval form role selection changed to picklist populated via new `workflowApi.reviewerRoles(documentId)`.
    12. "Back to documents" button preserves previous sidebar view context (`?view=mine`, `?view=trash`, etc.).
    13. Clickable table column sort headers (`number`, `name`, `status`, `updated`) with indicators, and page size selector defaulting to 10 rows to fit 1440x900 viewport without vertical scrolling.
    14. New Document drawer filters creator departments by `level !== 'CONSUMER'`, warning banner displayed and submission disabled if user has no contributor/manager permissions.
    Verified with unit test `DocumentListFilterTests`, frontend TypeScript build (0 errors),
    and automated Edge CDP browser testing across 12 reference screenshots in `screenshots/improvements/`. Next up per the plan-back's
    §8 order: Phase 3 (Departments — list, detail, members panel), not started.
    **Document Favorites & Number Generation Preview (2026-09-17)**:
    1. Migration V11 (`V11__user_document_favorites.sql`) and `UserDocumentFavorite` entity/repo added. Users can star/favorite documents (`POST/DELETE /documents/{id}/favorite`), with `isFavorite` flag on summaries and detail DTOs.
    2. `GET /documents/next-number-preview?typeId=...&departmentId=...` (`DocumentNumberPreviewDto`) provides real-time preview of the calculated next sequence number directly inside the New Document creation drawer.
    **Version Restore & Draft Discard (2026-09-17)**:
    1. `POST /documents/{id}/versions/{versionId}/restore` (`restoreAsDraft`) allows reverting to prior superseded versions by creating a new draft copy carrying over the previous file content with an audited revision record.
    2. `DELETE /documents/{id}/versions/{versionId}` (`discardDraft`) safely deletes unapproved draft versions, cleaning associated workflow instances and notification logs without touching released versions.
    **Document Status vs. Progress Separation (2026-09-17)**:
    Clarified document lifecycle by separating the overloaded Status column into life-cycle **Status** (`Draft`, `Approved`, `Effective`, `Obsolete`) and an explicit **Undergoing Task / Progress** column (`In Approval Workflow`, `Pending My Review`, `Pending My Acknowledgment`, `Locked (Draft vN)`). Cleaned obsolete "superseded" dropdown filter.
    **Tasks Page Overhaul & Approval History (2026-09-17/18)**:
    1. Unified tabbed navigation replacing dual views: `My Approvals`, `Pending My Acknowledgment`, `Started by Me`, and `Delegated by Me` with live count badges (`TaskCountsDto`).
    2. Detailed approval history timeline displaying reviewer progress, completion dates/times, reviewer feedback notes (`WorkflowFeedbackDto`), delegator tracking (`DelegatedTaskDto`), and cancellation reasons.
    3. Delegation tracking & messaging: mandatory instructions/context sent to colleagues when reassigning review tasks, tracked live in the "Delegated by Me" tab.
    4. Real-time keyword search and urgency filter pills (`All`, `Overdue`, `Due Soon (≤ 2 days)`, `Delegated to Me`).
    5. Strict One-by-One Acknowledgment: preserved mandatory individual review and compliance checkbox per ISO 9001 standards (no bulk action).
    **Document Draft & Approval Locking (2026-09-17/18)**:
    Backend invariants (`409 Conflict`) in `DocumentVersionService` and `DocumentService` prevent concurrent draft creation or metadata edits while an approval workflow or draft is in progress. Prominent visual lock badges and disabled mutation forms protect document integrity.
    **Quick In-Browser Document Preview & Resilient File Handling (2026-09-18)**:
    1. `?inline=true` parameter on `GET /documents/{id}/versions/{versionId}/download` serves inline `Content-Disposition` for in-browser PDF rendering.
    2. `DocumentPreviewModal.tsx` provides both an embedded viewer (`DocumentPreviewViewer`) and a fullscreen modal (`DocumentPreviewModal`).
    3. Magic bytes validation (`%PDF-` header check): prevents native Chrome PDF viewer crashes ("Failed to load PDF document") when non-renditionable formats (e.g. `.winmd`, CAD, ZIP) are reviewed, cleanly falling back to an in-browser preview unavailable card with a direct file download button.
    4. Reviewer draft visibility safeguard: `DocumentVersionService.findVisibleVersion(...)` permits reviewers in active workflows to access unreleased draft versions without 404 access barriers.
    5. Soft styling & unstacked controls: removed duplicate close cross icon via `showCloseButton={false}`, unstacked "Open in tab" and "X" buttons into a unified flex toolbar in `TasksPage.tsx`, and softened all dialog borders, divider lines, and form controls to `border-border/40` and `rounded-2xl`.
    **Real-Time Email Notifications & Rich HTML Templates (2026-09-18)**:
    1. Upgraded outbound notification boundary: `NotificationSender.sendHtml(...)` added with default fallback; `GraphNotificationSender` supports `"contentType": "HTML"` for rich email dispatch; `LogNotificationSender` logs clean text summaries.
    2. `NotificationTemplateService` generates responsive, inline-CSS email templates (DocControl header branding, color-coded status badges, document metadata cards, reviewer comment callouts, prominent CTA buttons linking to `{baseUrl}/tasks` or `/documents/{id}`, and fallback direct links) plus clean plain-text representations.
    3. `WorkflowNotificationService` provides event-driven notification dispatch:
       - `TASK_ASSIGNED`: real-time notice to each assigned reviewer (named or candidate role members) on workflow start / periodic review re-approval with due dates.
       - `APPROVAL_COMPLETED`: notice to document owner and submitter when 100% approval is achieved (immediate or scheduled effectivity).
       - `APPROVAL_REJECTED`: notice to document owner and submitter with reviewer name and rejection feedback comments.
       - `WORKFLOW_CANCELLED`: notice to all active reviewers when an in-flight workflow is cancelled.
       - `TASK_DELEGATED` & `TASK_RECALLED`: upgraded with rich templates and instructions callouts.
    4. Best-effort resilience (Flag F1): all notification dispatches are safely wrapped in try/catch blocks with warning logging and recorded in `notification_log` without rolling back workflow state transitions.
    5. Upgraded `PasswordResetService` to use branded HTML templates with "Reset Password" CTA button.
    6. Verified with 144/144 tests green (including unit tests `GraphNotificationSenderTests`, `NotificationTemplateServiceTests`, `WorkflowNotificationServiceTests`, and integration tests `WorkflowEndpointTests`, `PasswordResetTests`), and rebuilt live `api` container in WSL2 Docker.
- **Where things run (this dev machine)**: no Docker on Windows — Docker
  Engine lives inside WSL2. **Operational runbook: `RUNBOOK.md`**
  (start/stop/verify the stack, check existing data, machine-specific
  gotchas — use `wsl -u root`, never non-interactive `sudo`, which
  hangs) with `POSTGRES_HOST_PORT=15432 MINIO_HOST_PORT=19000
  MINIO_CONSOLE_HOST_PORT=19001` to avoid port collisions. Tests need a
  live database: local dev Postgres cluster on **5434**
  (`~/.doccontrol-dev/pgdata`, override with `SPRING_DATASOURCE_URL`), and
  workflow/notification tests also need MinIO on **9000**
  (`~/.doccontrol-dev/minio.exe` — see api/README.md). 125 tests green.
- **WSL2 gotchas (hit 2026-09-10)**: `sudo` inside WSL prompts for a
  password — non-interactive `sudo` in a `wsl -e` one-liner hangs forever
  (work from an interactive WSL terminal, or pipe the password). The WSL
  VM also idle-shuts down when nothing holds a session open, which stops
  the whole compose stack; `restart: unless-stopped` brings it back on the
  next `wsl` call, so keep a WSL session alive while working against the
  stack (a background `wsl -e bash -c "sleep N"` works).
- **Deployment target**: `docker compose up -d --build` serves the SPA at
  localhost:3000 with the API under the `/api` mount; stack rebuilt from
  main on 2026-09-14 (Phase 2e, the levels/nav work, the 100MB upload
  limit, the scheduled-sweep audit row, and the Dashboard landing page)
  with the full smoke (sections 0–15) passing against it.
- **Verification habit**: `scripts/smoke.sh` walks the full flow (including
  the workflow release) end-to-end; run it after any stack rebuild.

Read this file first. It orients you to the project; the two linked docs are
the detailed technical reference. Ask before deviating from anything stated
here as a decision (not a suggestion) — these were made deliberately after
planning discussion, not defaults.

## What this is

A custom-built, self-hosted Document Control system for a manufacturing
company (server manufacturing, ISO 9001). Replaces an aging free-tier
Alfresco instance currently run via Docker. This is **one of two systems**
in the company's broader platform — the other is a separate Testing Floor /
MES system for manufacturing traceability. **They are fully independent
deployments** (separate VM, separate database, separate repo, separate
deploy pipeline). Do not couple them. If integration is ever needed later,
it happens over a REST API call, never a shared database.

## Tech stack (decided, not open for silent change)

| Layer | Choice |
|---|---|
| Backend | Java + Spring Boot |
| Workflow engine | **Flowable 8.0.0** (embedded, Spring-native BPMN) — Sprint 3+, not before; chosen over Camunda because Camunda 7 is EOL-bound and Camunda 8's distributed architecture doesn't fit a single-VM deployment (verified via the bounded spike) |
| Frontend | React + TypeScript |
| Database | PostgreSQL |
| File storage | MinIO (S3-compatible, self-hosted) |
| Auth | Local accounts for now; built pluggable for LDAP/AD later |
| Deployment | Docker Compose on a single Ubuntu VM (see `docker-compose.yml`) |

If you think a different tool fits better for something, say so and explain
why — don't just substitute silently.

## Reference documents

- `Document_Control_Data_Model_v1.md` — full schema: tables, columns, FK
  relationships, and the reasoning behind each design choice (extensible
  type/department lookups, native versioning, stage-based workflow model).
  Treat table names as authoritative; map to JPA entities directly
  (e.g. `document` → `Document` entity, snake_case columns →
  camelCase fields via standard Spring/Hibernate naming strategy).
- `Document_Control_API_Spec_v1.md` — full REST endpoint list, grouped by
  resource, with which Sprint each belongs to. Endpoints marked Sprint 3
  (workflow) should not be built yet — see Current scope below.
- `Phase2_Roadmap.md` — **read this before starting any work beyond Sprint
  1.** Sprint 1 (below) is complete. Everything after it was re-scoped based
  on real QA feedback, not the original API spec's Sprint 2-4 labels — the
  roadmap doc supersedes those labels for anything workflow, lifecycle, or
  distribution related.

## Current scope: Sprint 1 (complete) — see Phase2_Roadmap.md for what's next

Sprint 1 is done: auth, lookups, documents (CRUD), versions (MinIO-backed),
users/roles, plus fixes found during piloting (current-version-pointer
semantics, version-history visibility). **Do not build anything from the
original API spec's Sprint 2-4 labels without checking `Phase2_Roadmap.md`
first** — real QA feedback changed the shape of what comes next
significantly. Start with Phase 2a (org/access foundation) per that
document.

## Non-negotiable conventions

1. **`document_number` is always server-generated**, never client-supplied.
   Uses `document_sequence_counter` per (type, department) pair. Gaps in the
   sequence are expected and fine (mirrors the current Alfresco behavior —
   confirmed reserved numbers like `SOP-QA-0003` simply weren't used yet).
2. **Every write action must produce an audit log entry** at the service
   layer, not left to individual controllers to remember. Even though
   `/audit-log` read endpoints are Sprint 4, start writing the log rows now
   so there's no backfill problem later.
3. **Document/department/type are all extensible lookup tables**, never
   hardcoded enums in application code. A new type or department should be
   addable via a database row (or later, an admin screen) with zero code
   changes.
4. **Permission filtering happens in the service layer**, not just hidden
   in the frontend. `GET /documents` and search must only return what the
   caller's role/department allows.
5. **Version numbers are a real system field**, not embedded in filenames.
   The current Alfresco setup does this wrong (`SOP-QA-0010 ... Rev 0.docx`
   with system version stuck at 0) — do not repeat that pattern. A
   `legacy_revision_label` field exists in the schema purely for migration
   reference, not for ongoing use.

## Decisions (previously open, now resolved)

- **Auth**: local accounts only for now. No AD/LDAP integration in this
  phase — but keep the auth layer structured so one could be added later
  without a rewrite (e.g. don't hardcode password-based login as the only
  possible auth flow throughout the codebase).
- **Departments**: only seed `QA`, `ENG`, `PROD`, `HR` as known departments
  at go-live. **Do not assume this is the full list** — more will be added
  over time. This is exactly why `department` is a lookup table and not a
  hardcoded enum (see Non-negotiable conventions above). No code should
  ever assume a fixed/closed set of departments; adding one must be a data
  change only, ideally via a simple admin screen in a later sprint (not
  required for Sprint 1 — a direct DB insert is fine until then).
- **Migration**: the new system **starts clean at go-live**. No migration
  of existing Alfresco content is in scope. The old Alfresco/Docker
  instance can be kept running read-only as a reference archive if needed,
  but nothing needs to be built to import from it. Do not spend any effort
  on Alfresco data export/import tooling unless explicitly asked later.

## Schema decisions (resolved after implementation plan-back)

These four items were gaps identified by whoever implements this against
the data model doc — resolved here so they're answered once, not re-asked.

- **`user_role` join table** (`user_id`, `role_id`) — add it. Required for
  permission filtering to function at all. Many-to-many: a user can hold
  more than one role.
- **Password storage** — add `password_hash` to the `user` table (bcrypt).
  No separate credentials table; keep it simple for a local-accounts-only
  system. If AD/LDAP is added later, this column simply goes unused for
  those accounts rather than being restructured.
- **Soft delete** — add a nullable `deleted_at` timestamp to `document`.
  `DELETE /documents/{id}` sets this instead of removing the row; default
  list views exclude rows where it's set; `/restore` clears it. Do not add
  a `deleted`/`trashed` value to the document status enum — keep lifecycle
  status and soft-delete as separate concerns.
- **Visibility rule (provisional)** — released/approved documents are
  visible to all authenticated users. Draft/in-review documents are visible
  only to the document owner, any assigned reviewers, and admins. (Create
  and edit used to be open to any authenticated user too — superseded by
  the Phase 2a department-scoped rule below.) Read visibility remains a
  starting rule, expected to be revisited once real usage patterns are
  known — not a permanent design constraint.
- **Login identifier** — login by `email` (already unique on `user`). No
  separate username field.
- **Multi-department users (Phase 2a)** — `user` ↔ `department` is
  many-to-many via the `user_department` join table (mirrors `user_role`);
  the singular `user.department_id` column was dropped in migration V3.
  Users must belong to at least one department; the users API takes/lists
  `departments` (full-replacement PATCH, like roles). User responses
  changed shape accordingly (`departments` array).
- **Department-scoped create/edit (Phase 2a)** — only members of a
  department may create documents in it or edit its documents; admins
  remain unrestricted. Ownership no longer grants edit rights by itself:
  ownership transfers are restricted to members of the document's
  department, so owners are always members. Named-user overrides (roadmap
  #3, "Later") are designed to plug into `DocumentService.canModify` as an
  additional clause backed by an override table alongside the department
  rule — not a replacement of it.
- **`current_version_id` semantics (resolved during the pilot; amended in
  Phase 2c)** — the pointer means "the version the public sees". It is null
  until a document's first release. Version uploads and document creation
  never move the pointer — a pilot finding: uploading a draft to a released
  document used to drag the public version pointer to unreviewed content.
  Since Phase 2b the engine owns the move (approval completion →
  `promoteVersion`); **Phase 2c amendment (plan-back flag F2)**: an
  approval completed with a future effective date leaves the document
  `approved` with the pointer untouched, and the daily job's
  effective-date flip moves the pointer on the chosen date. So the pointer
  now moves via exactly two paths: an immediate approval completion, and
  the scheduled flip. On each release the newly-current version's status
  becomes `current` and the previously-current version becomes
  `superseded`; an approved-not-yet-effective version is `approved`;
  versions never pointed to stay `draft`. (This deliberately deviates from
  the API spec's create-document example, which shows current_version_id
  set on a draft; that example predates this decision.)
- **Version history visibility (pilot finding #2)** — for non-owner/non-admin
  viewers of a visible document, the version list shows exactly the current
  version, and version detail/download for any other version id returns 404
  (existence not leaked). Owners and admins see the full history. Draft
  versions of a released document are therefore not enumerable or
  downloadable by normal users.
- **Confirmed low-stakes assumptions**: Java 21 + Spring Boot 3.x; Maven;
  session-cookie auth via Spring Security; `audit_log.details` as Postgres
  `jsonb`; seed roles limited to `Admin` and `User` for now (role names like
  "QA Reviewer" arrive with Sprint 3 workflow work, not before).

## Sprint 3 design note (requirements confirmed with QA)

Confirmed: approval chains are **single-stage, parallel, 100% required**
(matching current Alfresco behavior) even for cross-department sign-off —
a cross-department document just gets multiple departments' managers added
as reviewers in that one stage, not a sequential multi-department chain.
Assignees are chosen **ad-hoc, per approval instance** at start time, as
either a named individual or a **role/candidate-group** (e.g. "ENG
Manager") — reusing the existing `role` + `user_role` (+ department)
structure, no new identity tables. **Delegation is unrestricted** (any
reviewer can delegate to anyone). **Escalation defaults are configurable,
not hardcoded**: due date 3 business days after start, reminders 1 day
before and on the due date, escalation to document owner + admin at 2+
business days overdue — notifications via **Microsoft 365 / Graph API**
(no generic SMTP).

Engine decision: **Flowable 8.0.0**, embedded (bounded spike completed:
both engines handled ad-hoc per-instance assignment cleanly; Camunda 7 is
EOL-bound and Camunda 8's distributed architecture doesn't fit single-VM
compose). The design plan-back was approved; the core approval flow
(ad-hoc parallel start, 100% completion with version promotion, rejection,
unrestricted delegation, pooled role tasks, reviewer visibility) is
implemented and tested — the status-override stopgap is retired. The
reminder/escalation job is also implemented (daily sweep, configurable
thresholds, pooled tasks remind current role members until claimed,
dedup via notification_log), and the Microsoft Graph sender completed
the phase — log-only remains the default until a deployment sets the
DOCCONTROL_NOTIFICATION_* values.

## Phase 2c/2d design note (requirements confirmed with QA, implemented 2026-09-10)

Full design in `Phase2c_2d_Design_PlanBack.md` (approved by the owner,
flags F1–F8 as proposed). Key points:

- **Periodic review**: ONE configurable interval for all documents
  (`doccontrol.review.interval-months`, 0 = off) — never per-type. The
  owner is responsible. The clock resets exactly when a version becomes
  effective (immediate approval, effective-date flip, re-approval).
  Overdue is derived (`next_review_due < today`), never stored, and the
  ONLY way to clear it is a completed re-approval — reviewers see
  "Periodic review re-approval" tasks (`POST /documents/{id}/review-approval`,
  `reapproval` flag in workflow DTOs). A rejected re-approval leaves the
  document released and still overdue.
- **Effective date**: the approver may pass `effectiveDate` when
  completing an approval task (default immediate = pre-2c behavior
  bit-for-bit). Future date → document/version `approved` (visible state,
  distinct from released; the pending version stays invisible to normal
  users because it is not the current version); the daily job flips it on
  the date. At most one pending-effective version per document (a newer
  outcome retires the older one, audited `superseded_before_effective`).
- **Change/CAPA reference** (#12): Should priority — optional free-text
  `change_reference` on version upload, no validation.
- **Acknowledgment (2d)**: department-scoped via live `user_department`
  membership, record-only (nothing gated). Window 7 business days
  (`doccontrol.acknowledgment.*` — deliberately separate knobs from the
  approval 3/1/2). Per-version: every newly-effective version re-opens
  acknowledgment; the (version, user) unique constraint is the
  no-carry-forward rule. Status visible to owner/admin by default, plus
  per-document per-user grants (`document_acknowledgment_access`);
  acknowledge is idempotent and admins are NOT exempt from the
  department-membership rule.
- **The daily job** runs four ordered phases (flip → approval reminders →
  review notices → acknowledgment notices) and is idempotent per business
  date — `WorkflowJobIdempotencyTests` runs it three times on one date and
  proves zero duplicate flips, notifications, or audit rows. Sweep-driven
  state mutations are audited as the non-login System user (V6), so
  `audit_log.performed_by` stays mandatory.
- **Config**: `doccontrol.review.*` (12-month interval, 5/2 reminder and
  escalation thresholds) and `doccontrol.acknowledgment.*` (7/2/2), all
  env-overridable. Notifications: REVIEW_DUE, REVIEW_OVERDUE,
  ACK_REMINDER, ACK_OVERDUE, PENDING_SUPERSEDED — all still via the
  log-only sender until the Graph sender lands.

Items discovered during implementation that must be resolved before a real
deployment, even if they don't block Sprint 1 development itself:

- [x] **Admin password rotation**: no endpoint exists yet to change the
  bootstrap admin's password after first startup. Fold a minimal
  password-change capability into the Users/roles resource work — don't
  ship Sprint 1 as "complete" without it. Until then, the account is stuck
  with whatever `DOCCONTROL_BOOTSTRAP_ADMIN_PASSWORD` was set to at first
  startup. *(Resolved: `POST /users/{id}/password` — self-service with
  current password, admin reset for others; audited as `password_changed`.)*
- [ ] **Confirm `DOCCONTROL_BOOTSTRAP_ADMIN_PASSWORD` and
  `DOCCONTROL_BOOTSTRAP_ADMIN_EMAIL` are actually overridden** at real
  deployment time — the checked-in defaults (`admin@doccontrol.local` /
  `changeme_admin`) are dev-only and must never reach a real environment.
  A startup guard enforces this: default credentials always log a prominent
  warning, and startup **hard fails** when a `prod`/`production` profile is
  active with them — deployment must set real credentials AND activate one
  of those profiles.
- [x] **CSRF protection** — was disabled in Sprint 1 (SameSite=Lax only).
  Now enabled for the SPA: double-submit cookie scheme (`XSRF-TOKEN` cookie
  echoed in `X-XSRF-TOKEN`, Spring Security's documented SPA pattern in
  `SpaCsrfTokenRequestHandler`), with `SameSite=Lax` kept on as defense in
  depth. The frontend sends the header automatically; `scripts/smoke.sh`
  demonstrates the full flow with curl.
- [x] **Admin status override was a Sprint 1 stopgap** — removed in Phase 2b
  as planned: releases are now driven by the workflow engine (approval
  completion promotes the version via `DocumentService.promoteVersion`).
  An auditor asking "who can release a document without going through
  approval?" now gets the answer "no one" — the engine's approval history
  is the record.
- [x] **Mint a second break-glass Admin before go-live** — satisfied as a
  side effect of the forgot-password real-email verification:
  `steven.teo@overclock.sg` was created/promoted to Admin with a real
  password only the owner knows, set via the reset-email flow itself
  rather than a generated credential needing separate secure storage.
  **Confirmed 2026-09-16**: the owner received the reset email, completed
  the reset, and logged in with the new password. Also note: an admin
  cannot change their own roles, so this second admin is the only way
  back if the primary account is ever locked out.
- [ ] **Storage config is a deployment-time step** — *(upload limit
  RESOLVED 2026-09-14: the owner decided large CAD/DWG drawings are in
  scope without measuring the old archive; `application.yml` now sets
  100MB max-file-size / 110MB max-request-size.)* Remaining: override
  MinIO credentials at deployment (`MINIO_ROOT_*` for the container,
  `DOCCONTROL_STORAGE_ACCESS_KEY/SECRET_KEY` for the api) and **create a
  dedicated MinIO user** for the api with read/write on the `doccontrol`
  bucket only — the api should never use the root account. Serve MinIO
  behind TLS; switch the api's storage endpoint to https accordingly.
- [x] **Daily-sweep audit story (resolved 2026-09-14)**: the owner approved
  writing a trigger-level audit row for scheduled (not just manual) runs —
  implemented same day in `WorkflowNotificationJob.runScheduled`: the same
  `daily_sweep`/`triggered` shape as the manual endpoint's row, in its own
  transaction after the sweep, as the System user, with
  `triggered_by: scheduled` (vs the manual row's `admin`);
  `WorkflowNotificationJobTests.scheduledRunWritesTriggerAuditRow` covers
  it (106 tests green). Item-level effects remain audited as before; the
  `/audit-log`+`/audit-log/export` endpoints (Sprint 4) are the intended
  way to produce this evidence — *(implemented 2026-09-14 per the
  activity plan-back: browse with scope/category/time filters for all
  users, CSV export for admins, so an auditor gets the scheduled-sweep
  `triggered` rows out of the same query.)*
- [ ] **Graph accepts unroutable recipients at submission — delivery
  failures bounce asynchronously to the sender mailbox.** A
  `notification_log` row with channel `'graph'` proves Graph accepted the
  message (202), NOT that it was delivered — verified 2026-09-11 when a
  send to a `@doccontrol.local` placeholder was accepted and its
  non-delivery report went to the sender mailbox. Before go-live: confirm
  every real user's email address is routable (no placeholder
  `@doccontrol.local`/`@doccontrol.test` accounts may survive into a real
  deployment), and decide who monitors the sender mailbox for bounce
  reports.
