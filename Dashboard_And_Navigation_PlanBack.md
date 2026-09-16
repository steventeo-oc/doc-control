# Plan-Back — Dashboard Visual Hierarchy & Navigation Architecture

Two separate findings from an owner UI/UX pass, grouped here because
they were raised together — but they're independent decisions and can
be approved/scheduled independently. No code until reviewed, same as
every other plan-back in this project.

## Part A — Dashboard visual hierarchy

### Current state (verified against the actual source)

`DashboardPage.tsx` renders four cards through one shared `Dashlet`
component in a `grid grid-cols-2 items-start gap-4` (the `items-start`
is exactly the F7 "no stretch-to-tallest" decision from
`Dashboard_Design_PlanBack.md` — each card sizes to its own content,
not its row sibling). Every card is: a plain-text title, an optional
count, then a `<ul>` of rows capped at `max-h-96` (384px) with internal
scroll. Rows are a blue link plus small `StatusBadge` pills, no icon.
`Dashlet` already accepts an `emptyIcon` prop (`Inbox`/`Folder`) but it
only renders in the empty state — never when the card has content.

### The two problems

1. **Low visual distinction.** Every card reads as the same "list of
   blue links" regardless of whether the row is a task, a document, a
   department, or an activity entry. Nothing but reading the text
   tells you which card you're looking at once you're past the title.
2. **Uneven grid rhythm.** Because cards don't stretch to match their
   row sibling (correct, deliberate behavior), a card with 1 item
   (Tasks, often) sits much shorter than a card with 20+ items
   (My Documents, scrolling to the 384px cap) in the same row. Not a
   bug, but it reads unbalanced whenever someone's task count is low —
   which is probably most of the time for most users.

### F1 — Card-header icon (recommended: yes)

`Dashlet` already carries the right icon per card via `emptyIcon` — it
just needs to also render in the card header when the card has
content, not only when it's empty. Minimal diff, one shared component,
applies to all four cards at once. No new icon choices needed, no new
dependency.

### F2 — Short-card minimum height (recommended: a modest min-height)

Give the `Dashlet`'s content area a `min-h-*` (candidate: `min-h-40`,
160px — roughly half the 384px cap, enough to stop a 1-row card
looking accidentally empty, not enough to fake a full card). Cheap,
low-risk, one class on the shared component. Alternative considered
and not recommended: reflowing the grid into a masonry/auto-fit layout
so cards pack tighter — bigger change, not clearly better, drops the
predictable "always 4 corners" mental model the current grid gives.

### Explicitly out of scope for this pass

Per-row icons (a small glyph before every individual document/
department/activity row, not just once per card) — would touch all
four Dashlet render functions instead of the one shared component, for
a benefit that's smaller than the card-header icon given rows already
have colored status badges doing some of that work. Skip unless F1
alone doesn't feel like enough once it's actually on screen.

## Part B — Navigation architecture

### Current state (verified, not assumed)

The shell (`Layout.tsx`) is a horizontal top bar — Dashboard,
Documents, Tasks, Departments, Activity, Admin — plus a contextual
left sidebar rendered from a `sections` config keyed by the four
resource sections. Two concrete findings from checking the actual
code and the running app just now, not hypothetical:

1. **`admin` is not in the `sections` map at all.** Documents, Tasks,
   Departments, and Activity each get a sidebar; Admin — which has
   three real sub-pages, Types/Tiers/Users — gets none. There is no
   in-app way to get from `/admin/types` to `/admin/tiers` or
   `/admin/users` except typing the URL. Confirmed by reading
   `Layout.tsx` and by loading `/admin/types` live: no sidebar renders.
2. **The top bar already needs `overflow-x-auto`** to stop "Admin"
   clipping at narrower widths (an existing, shipped fix from the nav
   restructure) — six items is already close to this bar's comfortable
   ceiling, and every future top-level section makes it tighter.

### F3 — Fix the Admin sidebar gap (recommended: yes, low risk, do
regardless of F4)

Add `admin` to `Layout.tsx`'s `sections` map with Types/Tiers/Users as
items, exactly matching the existing pattern for the other four
sections. This is a real, demonstrated usability gap independent of
whatever happens with F4 below — worth fixing on its own even if the
bigger nav question goes nowhere.

### F4 — The actual architecture question (needs your decision, not
mine)

Two real options, not a recommendation dressed up as a question:

- **Option 1 — keep top tabs, just fix what's broken.** F3 above,
  plus nothing else structural. Lowest risk, smallest change, doesn't
  address the top bar's shrinking headroom as sections keep getting
  added (this session alone added none, but Activity and Dashboard
  were both added in the last few days).
- **Option 2 — move section-switching into a persistent left icon
  rail**, with the existing per-section sub-nav becoming a second
  panel next to it (the "double sidebar" pattern — Slack, Linear,
  similar tools). Removes the horizontal ceiling entirely since
  vertical space scales better than a top bar's width. Real costs:
  touches the shared shell used by every page in the app, needs its
  own icon choice per section, needs its own responsive/collapse
  design for narrow widths, and is a genuine reversal of part of the
  Phase 1 shell design that was already reviewed and approved.

**Decided: Option 2.** The owner chose the persistent left icon rail
over patching the top bar. F1, F2, and F3 are all approved as
proposed. The rest of this document is the "dedicated design pass"
Option 2 was flagged as needing — decided now, not deferred.

## F4 technical design — the left rail (decided)

### Structure

`Layout.tsx`'s current `<header>` (brand text + horizontal tabs +
account menu, `bg-slate-900`) is replaced by a full-height vertical
`<aside class="rail">`, same `bg-slate-900` color carried over from the
header (no new color decision needed):

- **Top**: the existing `ClipboardCheck` brand mark (already used as
  the app's icon badge on Login and elsewhere) — icon only, no text,
  since the rail is narrow.
- **Middle**: six nav items, each **icon stacked above a short label**
  (not icon-only-with-tooltip). Reasoning: this app's users span
  Manager/Collaborator/Contributor/Consumer levels across a
  manufacturing floor, not a self-selected group of power users the
  way Slack/Linear's audience is — label-less icon rails trade away
  discoverability this audience can't as easily afford. Icons (all
  already-available lucide-react, no new dependency):
  - Dashboard → `LayoutDashboard`
  - Documents → `FileText`
  - Tasks → `ListChecks`
  - Departments → `Building2` (already used with this exact meaning
    in the Login brand panel — reuses an icon vocabulary that already
    exists rather than inventing a second one)
  - Activity → `Activity` (lucide's actual icon name — a pulse/trend
    line, and it happens to match the section's own name)
  - Admin → `Settings` (shown only for `isAdmin`, matching current
    behavior exactly)
- **Bottom**: the account menu (identity, Change password, Log out) —
  same `DropdownMenu` content as today, anchored to the bottom of the
  rail instead of the top-right of a header. Truncates to initials or
  a small avatar-style circle in the rail itself; the full name/email/
  department-levels list still shows in the opened dropdown exactly as
  today.

The existing per-section sidebar (Documents' All/Mine/Trash, Tasks'
three panes, Departments' list, Activity's scope filter) is
unchanged in *content* and *data source* — it moves from rendering
below a horizontal header to rendering as a second column immediately
right of the rail. Admin gains this same sidebar mechanism per F3
(Types/Tiers/Users), using the identical pattern, not a special case.

### Sizing

- Rail: fixed width, `w-20` (80px) — enough for a centered icon plus a
  short label beneath it without wrapping most labels (verify
  "Departments" and "Acknowledgment"-adjacent labels don't wrap
  awkwardly; abbreviate the visible label if needed, e.g. rail label
  "Depts" while the page's own H1 still says "Departments" in full).
- Secondary sidebar (sections with one): unchanged width from today
  (`min-w-[220px]`).
- Main content: unchanged max-width rules (1100px capped, Dashboard's
  `content-wide` still lifts that cap) — just measured from the rail's
  right edge instead of the viewport edge now.

### Active state

Same visual language as today's `[&.active]:bg-white/15
[&.active]:text-white` on `NAV_LINK_CLASS`, applied to the stacked
icon+label block instead of a horizontal pill.

### Responsive collapse (new design surface — didn't exist before,
since the old header already handled narrow widths via
`overflow-x-auto`)

Below `md` (768px, Tailwind's standard breakpoint — picked over
reusing the Dashboard's one-off 860px since this is a new, separate
concern, not the same grid): the rail and any secondary sidebar
collapse into a single hamburger-triggered slide-out drawer stacking
both (section switcher on top, current section's sub-nav below it in
the same drawer) rather than inventing a bottom tab bar this app has
no precedent for. A slim top bar remains at mobile widths carrying
just the hamburger trigger, the brand mark, and the account menu, so
there's always a way in to both without permanently consuming vertical
space the way the old full header did.

Explicitly not in this pass: a user-toggleable collapse-to-icon-only
on desktop (VS Code-style). Real feature, adds real complexity
(persisted state, width animation, conditional label rendering) that
wasn't asked for — the rail is a fixed, always-labeled width on
desktop for now.

## What I need from you before any code

Nothing further — F1-F4 are all decided. Sending to the junior next.
