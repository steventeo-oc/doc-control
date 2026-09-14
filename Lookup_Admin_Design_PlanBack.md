# Lookup Admin — Design Plan-Back (types, departments, tiers)

Companion to `CLAUDE.md`. Gap found during manual testing on 2026-09-12:
deactivating a document type or department hides it from **all** lists —
including the search filters and the admin page that would reactivate it —
with no warning about how much references it, no way back from the UI, and
no delete path with a meaningful error. This plan-back walks the fix
through the existing design for owner approval. **No code has been
written.** Implementation starts only after approval, same discipline as
the phase plan-backs.

Everything below is grounded in the code on main plus a **live API
experiment** run against the dev stack on 2026-09-12 (a throwaway
department and type were created, deactivated, reactivated, DELETEd, and
then fully removed — no artifacts left).

---

## 0. What the investigation established (facts, not opinions)

1. `GET /departments` and `GET /document-types` are **active-only**
   (`findAllByActiveTrueOrderByCodeAsc`), with no query parameter to
   include inactive rows. Every consumer — the Lookups admin page, the
   documents-page filter dropdowns, and the creation dropdowns — shares
   these two endpoints.
2. **Reactivation via PATCH already works.** Experiment-proven:
   `PATCH /departments/{id} {"active": true}` persisted and the row
   reappeared in the list. The user-facing "can't be reactivated" is a
   **UI-reachability bug**: `LookupsPage` renders its Activate button only
   on `active: false` rows, but inactive rows can never appear in the
   table it loads — the button is unreachable dead code.
3. The documents-page **filter dropdowns and creation dropdowns share the
   same active-only source** (`lookupApi.types()/departments()`), so a
   deactivated type/department vanishes from search filters too. The
   backend search itself filters by type/department **code** and never
   checks `active` — filtering by an inactive code works fine once the UI
   can offer it. The gap is purely dropdown supply.
4. **No DELETE endpoints exist for any lookup** — `DELETE
   /departments/{id}` returns **HTTP 405** (experiment). There is no
   server-side "silent failure"; there is no server-side anything. From
   the UI there is no delete affordance either.
5. `DocumentTier` already has an `active` column (comment: "Soft-disable
   instead of deleting") that nothing reads or writes, and its GET returns
   **all** tiers unfiltered — the opposite convention from the other two
   lookups. It has no write endpoints at all.
6. Document creation **already rejects inactive lookups with clear 409
   messages** (`requireActiveType` / `requireActiveDepartment`: "Document
   type 'X' is inactive." / "Department 'X' is inactive."). The error
   voice item 4 asks for already exists in the codebase to copy.
7. All three lookup DTOs already carry `active`, so the SPA has the data
   it needs to mark rows once it can see them.

Referential reality (drives the delete rules and usage counts):
`document_type` is referenced by `document.type_id` and
`document_sequence_counter.type_id`; `department` by `document.department_id`,
`user_department`, and `document_sequence_counter.department_id`;
`document_tier` by `document_type.tier_id`. Soft-deleted documents still
hold their FKs — a hard delete is physically impossible while any
referencing row exists, deleted or not.

---

## 1. Flags — decision points for the owner

### F1 — Deactivation gets a confirmation showing affected-record counts

New read endpoints: `GET /departments/{id}/usage` and
`GET /document-types/{id}/usage` (admin-only, same as writes), returning:

- department → `{ "documents": N, "users": M }` — non-soft-deleted
  documents referencing it, and `user_department` memberships (active
  users);
- document type → `{ "documents": N }`.

The SPA's Deactivate click calls usage first and confirms with the real
numbers before PATCHing — e.g. "Department 'IT' is used by 3 document(s)
and 5 user(s). Users keep access to existing documents but will not be
able to file new ones here. Deactivate?" Recommendation: a plain
`window.confirm` for v1 (the SPA has no modal component yet); a proper
dialog can come later without touching the API. The usage endpoint is
also the data source for the delete flow (F4), so it is built once.

### F2 — Two list shapes: active-only for creating, everything for admin/filtering

`GET /departments` and `GET /document-types` gain
`?includeInactive=true` (default unchanged: active-only — no existing
consumer breaks). `GET /document-tiers` gains the same parameter **and
flips its default to active-only** to match the other two lookups — a
deliberate behavior change, since today it returns everything (flagged
separately in F5; the only current consumer is the LookupsPage, which
moves to `includeInactive=true` anyway).

SPA consequences:

- **LookupsPage** loads with `includeInactive=true`: inactive rows appear
  with their Activate button finally reachable — this *is* the
  reactivation fix (F3). Deactivated rows render greyed/marked.
- **DocumentsPage filters** load with `includeInactive=true` and render
  inactive options suffixed "(inactive)" — so documents of a deactivated
  type/department stay searchable, which the backend already supports.
- **Creation dropdowns** (New document, and the LookupsPage create forms)
  filter `active === true` client-side from the same fetch — active-only
  without a second request.

### F3 — Reactivation: confirmed working; the fix is F2

The experiment answered the owner's question 3 directly: the API accepts
`PATCH {"active": true}` on a deactivated department and type and the
rows return to the active list. **No backend change is needed for
reactivation.** The defect is that the admin UI cannot see inactive rows;
F2 fixes that. Both PATCH services already audit the toggle with
before/after values.

### F4 — DELETE endpoints with precise blocking errors

Add `DELETE /departments/{id}`, `DELETE /document-types/{id}` (tiers in
F5). Semantics:

- **Block when documents reference the row** — counting **all** documents
  including soft-deleted (the FK does not care about `deleted_at`, so
  blocking on the visible-only count would produce raw FK errors later).
  Response: **409** ProblemDetail in the existing voice, with a
  structured `blocking` property the SPA can render:

  ```
  detail: "3 document(s) (including 1 soft-deleted) reference department 'IT'
           — deactivate it instead of deleting."
  blocking: { "documents": 3 }
  ```

- **Department delete also removes membership rows and sequence-counter
  rows** once no documents block it — memberships are what deleting a
  department means (the confirm dialog already showed the user count),
  and counters for a type/department with zero documents are private
  bookkeeping (convention 1: gaps are expected). Both cascade in the same
  transaction and land in the audit details (the deleted membership user
  ids are listed).
- **Type delete removes its sequence-counter rows** the same way.
- **Unreferenced rows hard-delete cleanly** (204) with an audited
  `deleted` action carrying code and label — so a mistyped "PLNB" row
  from five minutes ago can actually be removed instead of cluttering the
  inactive list forever.
- The SPA gets a Delete button beside Deactivate. Click → DELETE → the
  409's `detail` lands in the existing error banner (the `run()` helper
  already renders `err.message`). Recommendation: let the server be the
  single source of truth for blocking rather than pre-checking with the
  usage endpoint — one code path, no TOCTOU gap; the usage call stays
  dedicated to the deactivate confirmation.

### F5 — document_tier gets the same admin CRUD pattern

Once types/departments are consistent, extend to tiers — the entity is
already shaped for it (`active` column, DTO carries it, the LookupsPage
renders an Active column today):

- `POST /document-tiers {tierNumber, label}` — tierNumber is display
  ordering only (it prefixes nothing; document numbers are built from the
  type code), so any positive integer is acceptable; duplicate tierNumber
  → 409.
- `PATCH /document-tiers/{id} {label, active}` — same partial-update
  shape and audit as the other two.
- `DELETE /document-tiers/{id}` — blocked with 409 +
  `blocking: {documentTypes: N}` when any type references the tier
  (including inactive types); otherwise 204 + audit.
- `GET /document-tiers` default flips to active-only (F2) with
  `includeInactive=true` for the admin page.
- Security needs no changes: `/document-tiers/**` writes are already
  admin-only in `SecurityConfig`; reads are already authenticated.
- Deactivating a tier does **not** affect types referencing it (they keep
  working; the confirm dialog shows "N document type(s) reference this
  tier" so the admin knows nothing cascades).

## 2. API summary

| Method & path | Change |
|---|---|
| `GET /departments?includeInactive=true` | list includes inactive rows (default unchanged) |
| `GET /departments/{id}/usage` | **new** — `{documents, users}` |
| `DELETE /departments/{id}` | **new** — 409 with `blocking`, or 204 + audit (memberships/counters cascade) |
| `GET /document-types?includeInactive=true` | same list change |
| `GET /document-types/{id}/usage` | **new** — `{documents}` |
| `DELETE /document-types/{id}` | **new** — 409 with `blocking`, or 204 + audit (counters cascade) |
| `GET /document-tiers[?includeInactive=true]` | **default flips to active-only**; param adds the rest |
| `POST /document-tiers` | **new** — `{tierNumber, label}` |
| `PATCH /document-tiers/{id}` | **new** — `{label, active}` |
| `GET /document-tiers/{id}/usage` | **new** — `{documentTypes}` |
| `DELETE /document-tiers/{id}` | **new** — 409 with `blocking`, or 204 + audit |

## 3. SPA summary (all in the two existing pages + client.ts)

- `client.ts`: `includeInactive` params, `lookupApi.usageDepartment/
  usageType/usageTier`, `deleteDepartment/deleteType/deleteTier`,
  `createTier/updateTier`.
- **LookupsPage**: load all three lists with `includeInactive=true`;
  Deactivate → usage + `confirm()` with real counts; Activate button works
  (rows are visible now); Delete button per row; tier rows gain the same
  three controls plus a create-tier form.
- **DocumentsPage**: filter dropdowns load with `includeInactive=true`
  and suffix "(inactive)"; creation dropdowns filter to active rows
  client-side. No backend search change (filtering by inactive codes
  already works).

## 4. Edge cases

| # | Situation | Decision |
|---|---|---|
| D1 | Deactivate a department that has members | Allowed; confirm shows the user count and states members keep access to existing documents but cannot file new ones there (create-time 409s already exist and read exactly that way). |
| D2 | Deactivate a type with pending-effective documents | Allowed; the daily flip does not consult lookup `active`, so in-flight lifecycles complete untouched. Deactivation only gates *new* documents. |
| D3 | Delete blocked by soft-deleted documents | Blocked — the count includes them and the message says "(including N soft-deleted)". The FK makes physical deletion impossible regardless. |
| D4 | Document created while a DELETE's pre-checks just passed | The FK violation backstops it: the existing `DataIntegrityViolationException` handler returns a generic 409. Race window is negligible; no extra locking. |
| D5 | Deactivate a tier that types reference | Allowed, nothing cascades; confirm shows the type count and that those types keep working. |
| D6 | Type active but its tier deactivated | Allowed (types reference tiers, not vice versa); documents of that type are unaffected. The LookupsPage marks the inactive tier so the state is visible. |
| D7 | Reactivate a department users were removed from | Out of scope — membership rows deleted by a department DELETE are gone; re-adding users is normal Users-page work. The audit details list who was removed. |

## 5. Explicitly out of scope

- Renaming codes (PATCH deliberately has no code field — type codes
  prefix generated document numbers).
- Moving documents between types/departments; bulk deactivation; tier
  renumbering; per-status usage breakdowns.
- A modal component for confirmations (`window.confirm` for v1).
- Cascade-deleting documents when their lookup is deleted — never;
  deactivation is the lifecycle for anything referenced.

## 6. Test impact (when implementation is approved)

- Existing 82 tests stay green; the tiers GET default change touches
  `LookupEndpointTests` expectations (now active-only by default).
- New coverage: usage counts (documents/users/types, incl. soft-deleted
  counting); DELETE blocked → 409 body with `blocking`; DELETE clean →
  204 + audit + membership/counter cascade; `includeInactive` on all
  three GETs; tier create/patch/delete + duplicate tierNumber 409;
  authorization (writes admin-only — existing rules already cover it).
- SPA verified manually per the runbook (admin sees + reactivates an
  inactive row; filters show "(inactive)"; creation dropdowns exclude
  them; delete blocked message renders).
