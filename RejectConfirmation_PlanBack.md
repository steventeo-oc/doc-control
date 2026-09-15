# Reject-Confirmation Plan-Back (draft — not yet approved, no code written)

Found during UI/UX review 2026-09-15. Small, standalone, functional fix —
deliberately kept separate from the visual redesign (`Design_System_Redesign_PlanBack.md`),
since that plan's charter is explicitly "no functional change."

## Problem

In `web/src/pages/TasksPage.tsx`'s `MyApprovals` completion form, "Reject" is
a plain button with the same interaction weight as "Approve" and "Cancel" —
no confirmation step. The action is irreversible in effect: per the existing
code comment, rejecting closes out the whole approval instance (every
reviewer's pending task is cancelled), not just the current reviewer's task.
There is no `window.confirm` guarding it today, so this isn't one of the
five native-dialog sites the design redesign's F2 already covers — it was
simply never guarded.

## Proposal

Add a confirmation step before the reject call
(`workflowApi.complete(task.id, false, ...)`) fires:

- A shadcn `AlertDialog` (already scaffolded in `web/src/components/ui/alert-dialog.tsx`,
  used elsewhere for the tier/type deactivate confirms) titled something like
  "Reject this approval?" with body text: "All reviewers' pending tasks will
  be cancelled and the document stays at its last released version. This
  cannot be undone." Confirm → proceeds with the existing reject call;
  Cancel → returns to the form unchanged, no request sent.
- No change to the reject endpoint, its request/response shape, or workflow
  semantics — this is purely a client-side confirmation gate.
- The optional review comment field, if filled in, stays intact through the
  confirm step (don't clear it if the user cancels).

## Scope

- `web/src/pages/TasksPage.tsx` only.
- Can land independently of the design redesign (plain CSS/JSX, using the
  existing `.danger`/`.card` classes) if you want the gap closed sooner, or
  be folded into Phase 2c (Tasks) of the redesign once that page is being
  reskinned anyway — either sequencing works; whichever you'd rather do.

## Out of scope

No change to approval semantics, no "undo" capability, no confirmation added
to Approve (a completed approval isn't destructive the same way — releasing
a version is the intended, expected outcome of approving).

## Open question for the owner

Land this now (small, independent PR) or bundle it into Phase 2c? Either is
fine from a risk standpoint since it touches nothing else in that file.
