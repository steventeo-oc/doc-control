# Design System Redesign — Plan-Back (Tailwind CSS + shadcn/ui)

Companion to `CLAUDE.md`. Drafted 2026-09-14 at the owner's request;
**not yet approved — no code has been written.** Purely visual and
structural: no functional, permission, route, API, or data changes
anywhere. Backend untouched (113 tests stay green throughout). The
verification protocol for this phase is new and owner-shaped (section 7):
after each migrated section the rendered pages are screenshotted and
**paused for the owner's direct visual review** before the next section
starts.

Grounded in the code on main: `web/src` has **zero UI dependencies**
(React 18.3, Vite 6, TS 5.6, react-router-dom 6.28 only), one 502-line
`index.css` with 59 bespoke classes (14px base, system font stack),
4 shared components (Layout, AcknowledgmentPanel, DepartmentMembersPanel,
ActivitySentence), 11 pages, 6 inline-style usages, and **5 native-dialog
idioms** — `window.prompt` ×3 (change password self-service, admin reset),
`window.confirm` ×2 (deactivate tier/type), `window.alert` ×2.

---

## 1. Direction and non-negotiables

Clean, trustworthy enterprise SaaS (Linear/Notion/Stripe register) for an
ISO 9001 compliance tool: strong typographic hierarchy, intentional
whitespace, and a restrained palette where **color carries meaning**
(status, badges, warnings) — never decoration. Three hard rules:

1. **Meaning-preserving recolor only.** Every existing color→meaning
   mapping survives the redesign unchanged (table in §3); shades refine
   to the new scale, semantics do not move.
2. **Self-hosted everything.** No font/CDN fetches — an internal
   compliance tool ships its own font file (bundled Inter).
3. **Behavior freeze.** Routes, `?view=`/`?scope=`/query params,
   redirects, visibility rules, and every interaction stay bit-for-bit;
   the only structural swaps are the native-dialog and native-select
   replacements flagged in §6 (same behavior, new implementation).

## 2. Stack decision

**Tailwind CSS v4** (CSS-first config, `@tailwindcss/vite` plugin) +
**shadcn/ui** (copy-in Radix-based components — no component-library
runtime to fight, the code lives in our repo) + **lucide-react** for
icons (replaces the two hand-drawn SVGs and equips empty states/menus) +
**@fontsource-variable/inter** bundled locally. shadcn is the right
weight here precisely because it is copy-in: we own every line, can bend
it to the token set, and nothing about it constrains the backend or the
router. Dark mode is explicitly **out of scope** (one light theme,
tokens structured so a dark theme could come later).

## 3. Design tokens

CSS variables in the shadcn semantic shape (`--background`, `--card`,
`--primary`, `--muted`, `--destructive`, `--border`, `--ring`, …) mapped
to Tailwind theme utilities, so components never hardcode hex values.

**Palette** (cool slate neutrals, one blue family, meaning-carrying
accents):

| Token | Proposed value | Notes |
|---|---|---|
| background | slate-50 (#f8fafc) | replaces #f4f6f8 |
| card / foreground | white / slate-900 (#0f172a) | replaces #1c2733 text |
| primary | blue-700 (#1d4ed8 family, tuned) | heir of today's #1a6fb5/#16324f — continuity, not novelty |
| muted foreground | slate-500 | the current `.muted` role, AA on white |
| destructive | red-600 family | overdue, delete, superseded |
| border / ring | slate-200 / primary at 40% | focus rings everywhere |

**Status mapping (meaning-preserving, F4):**

| Current class | Meaning | New Badge variant |
|---|---|---|
| released, approved, current | in force | success (green) |
| draft | not yet in review | warning (amber) |
| in_review | awaiting sign-off | info (blue) |
| superseded, obsolete | retired | destructive-muted (red) |
| reapproval | periodic-review task | violet (kept) |
| overdue | past window/due | destructive (red) |
| Approval / Acknowledgment kind badges | row type | info / success |
| dept badge | department label | neutral outline |

**Type scale** — Inter variable, base 14px (unchanged); steps
12 / 13 / 14 / 16 / 20 / 24 with tightened tracking on headings and
`tabular-nums` on timestamps/counts (audit tables align). **Spacing** —
Tailwind's 4px scale; cards `p-4`–`p-6`, section gaps `gap-4`/`gap-6`.
**Radius** — one token family (6–8px, `rounded-lg`), matching today's
6px cards. **Elevation** — near-flat: borders over shadows except the
account dropdown.

## 4. Component set (first rebuilds, shared app-wide)

shadcn CLI components (copied in, then token-tuned): **Button, Card,
Badge, Table, Input, Label, Select, Dialog, AlertDialog,
DropdownMenu, Separator**. Bespoke (thin, built on the above):
**StatusBadge** (the single map from §3 — the only place status colors
live), **PageHeader** (title + actions row), **EmptyState** (icon +
sentence + optional CTA — generalizing the dashboard's existing
pattern), **SectionSidebar** (the existing Layout config, reskinned),
and the simple Prev/Next pagination (kept bespoke; shadcn's Pagination
component is overkill for it).

## 5. Incremental coexistence — confirmed, with one caveat (F1)

**Yes, page-by-page migration works — with one structural caveat to
design around: Tailwind's preflight reset is global.** The strategy:

- Tailwind is installed **without preflight** first. The old
  `index.css` and the new utilities coexist in one cascade with no
  collisions (bespoke class names vs generated utilities never
  overlap), so every page keeps its exact current look until its turn.
- shadcn components are copied in as pages adopt them; un-migrated
  pages never import them.
- **The one all-at-once moment is the final preflight flip** (Phase 5):
  by then every page is migrated and the remaining hand-rolled CSS is
  deleted in the same commit, so the flip's blast radius is provably
  zero — verified by the full screenshot sweep. Until then preflight
  stays off; the known gap (default border-color, some element
  defaults) is handled per-component inside shadcn parts, which are
  written to not depend on preflight.

## 6. Friction flags — where the current structure fights shadcn

### F1 — preflight is global
Covered in §5: off during migration, flipped once at the end. This is
the only non-incremental step in the whole effort.

### F2 — five native-dialog call sites become Radix modals
`window.prompt` (self-service change password, admin password reset),
`window.confirm` (deactivate tier, deactivate type), `window.alert`
(success/error toasts for password flows). Same behavior, new
implementation: **Dialog** for the two password prompts (real fields,
validation, error display inline), **AlertDialog** for the two
confirms, and the alerts become inline banners (the pattern every other
page already uses). Each swap happens in the phase that migrates its
host page; the account-menu one lands in Phase 1 because the chrome is
being rebuilt there anyway.

### F3 — native `<select>` → shadcn Select (Radix) changes DOM behavior
The filters, creation forms, and admin pages use native selects
(Documents filters ×4, create form ×2, type-create tier, users roles).
shadcn's Select is a Radix listbox: different keyboard/mobile/IME
behavior, no native dropdown on mobile. **Recommendation: adopt it** —
it is the design-system way and this is a desktop intranet tool — with
the swap concentrated in Phase 2a/4 where selects live. If the owner
prefers minimal behavioral delta, styled native selects are the
fallback; decision needed at plan-back review, not mid-build.

### F4 — dynamic `badge ${status}` classes centralize
Today every page interpolates `badge ${doc.status}` against index.css.
The redesign funnels all of them through **StatusBadge** with one
exhaustive status→variant map (§3 table — including the workflow
re-approval/overdue/kind/dept badges). Rule going forward: a new status
MUST extend the map, so color meaning can never fork per page.

### F5 — shared components span phases
`AcknowledgmentPanel`, `DepartmentMembersPanel`, and `ActivitySentence`
are hosted on pages in different phases. Each migrates **with its first
host page** and appears in its new skin on later hosts immediately — so
for a while an old page shows one new-styled panel. Acceptable
coexistence (the components are small and self-contained), flagged so
the interim look isn't mistaken for a bug during reviews.

### F6 — small stuff
Six inline `style={{…}}` usages get absorbed into utilities during each
page's migration. Tailwind v4's browser floor (Chrome 111+ / Safari
16.4+) should be checked against the fleet's actual browsers once; the
web Docker build's Node version must satisfy the v4 toolchain (checked
in Phase 0).

### F7 — dashboard behaviors to preserve verbatim
The 384px max-height card lists with internal scroll, the full-width
`content-wide` dashboard vs the centered 1100px section pages, counts in
footer deep links, empty-state icons, and the 2×2 grid — all survive as
utilities with identical numbers.

## 7. Verification protocol for this phase (new, owner-shaped)

1. **Baseline first**: before Phase 1, the current app's major pages are
   screenshotted as the reference set.
2. **After each phase** (§8): I rebuild the stack, verify structure
   (routes, params, counts, behaviors — DOM checks still run, they just
   stop being the *visual* gate), confirm the backend suite + smoke stay
   green, capture **full-page screenshots of every migrated page**, and
   hand them over with the artifact paths.
3. **Pause.** The owner reviews the screenshots directly (the visual
   gate is human, by design — my own visual review is structural only)
   and gives feedback; corrections land **before** the next phase
   starts. No pushing through the whole app on computed-style checks.
4. Phase 5 ends with a full-app screenshot sweep comparing against the
   Phase-0 baseline for regressions in content/behavior (visual deltas
   are the point; content deltas are not).

## 8. Migration order (owner's suggestion, confirmed and refined)

| Phase | Scope | Review pause |
|---|---|---|
| 0 — Foundation | Tailwind+shadcn scaffold (preflight off), tokens, fonts, base components built, **baseline screenshots**, zero visual change | baseline handed over |
| 1 — Shell | Top nav, section sidebar, Account menu (DropdownMenu + password Dialog, F2), Login page, Dashboard 2×2 | **pause + screenshots** |
| 2a — Documents | List, filters (Select swap, F3), create form, Trash | **pause + screenshots** |
| 2b — Document detail | Metadata, versions, upload dialog, acknowledgment panel (F5) | **pause + screenshots** |
| 2c — Tasks | Both panes (approvals incl. the completion form, acknowledgments) | **pause + screenshots** |
| 3 — Departments | List, detail, members panel (F5) | **pause + screenshots** |
| 4 — Admin | Types, Tiers, Users (lowest traffic, last) | **pause + screenshots** |
| 5 — Cleanup | Preflight on, dead CSS deleted, full sweep vs baseline | final review |

Each phase is its own commit (or few), each ends with the pause. The
owner's suggested order — Dashboard+nav first, Documents/Tasks next,
then Departments, Admin last — is adopted as-is; the only refinement is
splitting Documents/Tasks into 2a/2b/2c because the document detail page
is the densest surface in the app and deserves its own review.

## 9. Out of scope

Dark mode; a responsive/mobile overhaul (current reasonable behavior
preserved, no new breakpoint work); any functional, permission, or API
change; animation beyond shadcn defaults; i18n. The watermark/stamping
pipeline and everything backend are untouched.

## 10. Test impact

Backend: none — 113 stay green, smoke re-runs after each stack rebuild
(notification-flag habit as usual). Frontend: no SPA harness — per-phase
browser verification (routes, params, behaviors) plus the owner's
screenshot review per §7. No new tests are invented for styling; the
verification IS the review protocol.
