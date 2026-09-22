# AI Assistant — Saved Conversations: Design Plan-Back

Companion to `AI_Assistant_Design_PlanBack.md`, which explicitly deferred this: *"Conversation memory and
follow-ups... A user-visible history page... [are] the top backlog item"* and *"That is the point of the pilot; the
log feeds the golden set, and the gate is rerun weekly"* (§5, §8). Triggered by the owner, after seeing v1 live on
the box: the page forgets everything as soon as a new question is asked, and doesn't feel like the chat experience
people already expect from Open WebUI and similar tools.

*(Status: drafted 2026-09-22, not yet reviewed. No code until reviewed — same convention as every other plan-back
in this project.)*

## Why this is a second project, not a UI tweak

`Assistant.ask(question, user)` takes a bare question string; nothing about a prior turn reaches it. `query_log` is
one flat row per exchange, with no notion of grouping. Making saved, resumable, genuinely context-aware
conversations work touches three separate things, not one:

1. **Storage** — conversations have to be persisted, owned by a user, and listed/reopened.
2. **Retrieval** — a bare follow-up like *"what about the CX8?"* embedded on its own retrieves close to nothing
   useful, because the embedding has no idea what "the CX8" refers to. The system has to work out what the
   question actually means before it can search for it.
3. **Testing** — the release gate's 59 questions are single-turn by construction; none of them tell us whether a
   follow-up was understood correctly. A different, smaller evaluation is needed for this specifically.

Getting (2) wrong is the real risk: this assistant's whole safety property is that it answers only from what it
actually retrieved. A follow-up that retrieves the wrong passages doesn't just give a worse answer — it can
confidently cite the wrong document, or wrongly say `NOT_FOUND` when the real document is one message back.

## 1. Flags

| Flag | Decision | Proposed default |
|---|---|---|
| F1 | Where conversations live | The assistant's own SQLite, extending `query_log` |
| F2 | How a follow-up is understood | Rewrite it to a standalone question before retrieving, one extra LLM call |
| F3 | How long a conversation can grow | Cap what reaches the model; the UI keeps the full thread regardless |
| F4 | Retention and deletion | Same `ASSISTANT_LOG_RETENTION_DAYS` clock; users can rename/delete their own |
| F5 | Admin visibility | Unchanged — the existing CSV/log already sees everything, no new admin surface |
| F6 | Testing | A new, small multi-turn set; the existing 59-question gate stays as is, run separately |
| F7 | Rollout shape | Two phases: persistence first, context-aware retrieval second |

### F1 — Storage: extend `query_log`, don't invent a parallel table

```sql
conversation(id PK, user_id, title, created_at, updated_at, archived_at NULL)
-- query_log gains one nullable column:
ALTER TABLE query_log ADD COLUMN conversation_id INTEGER REFERENCES conversation(id);
```

`query_log` already stores one question+answer pair per row with everything a "message" needs (text, state,
sources, timings, rating). Grouping existing rows by a nullable `conversation_id` is a smaller, more honest change
than a second parallel table that would duplicate most of the same columns. A plain `/ask` with no conversation
(scripts, the gate, `app/chat.py`) keeps working exactly as today — `conversation_id` stays null, nothing about the
existing single-shot path changes. Title: the first question, truncated, editable afterward.

Deliberately not `audit_log` (same reasoning as F8 in the original plan-back — this still isn't a document-control
event) and not doc-control's own Postgres (the assistant stays a read-only guest there; keeping conversations in
its own store keeps that boundary intact).

### F2 — Retrieval: rewrite the follow-up before searching (recommended)

**The actual hard part.** Three ways to let retrieval understand *"what about the CX8?"*:

- **(a) Query rewriting (recommended).** Before embedding, one extra LLM call: given the conversation so far and
  the new message, produce a standalone version of the question ("What torque is used for the GPU screws on the
  CX8?"), and retrieve using that. The generation step still sees the real conversation and the user's actual
  wording — only retrieval uses the rewritten form. This is the standard, proven approach for conversational RAG,
  and the only one of the three that reliably fixes the actual failure mode.
- (b) Concatenate recent turns into the retrieval query directly. Cheaper (no extra call), but noisier — older
  vocabulary can dilute or mislead the embedding for what's actually being asked now. Not recommended as the
  primary mechanism.
- (c) Don't rewrite at all; rely on the LLM seeing history in the generation prompt to compensate for imperfect
  retrieval. Cheapest, but breaks the grounding property directly: if retrieval hands the model the wrong sources,
  a strict prompt should say `NOT_FOUND` — a correct answer would require the model to reach outside what it was
  given, which is exactly the thing this assistant is built never to do.

**Cost of (a), stated plainly**: every follow-up (not the first question in a new conversation, which has no
history to rewrite from) now takes two sequential LLM calls instead of one — a real latency increase (roughly
another 1–2s on top of what §0 measured) and, more importantly, it doubles how many turns a threaded question
takes from the shared `max_concurrent=2` semaphore that protects the LLM other teams also use. Worth watching once
this is real, not just theoretical.

### F3 — Context budget: cap what the model sees, not what the user sees

A long-running saved conversation can't send its entire history to the model forever — cost and latency both grow
with it. Proposed: keep the last N exchanges (or a token budget, whichever binds first) in the actual prompt; the
UI and the database keep the whole thread regardless. The user never loses anything; the model just stops seeing
the oldest parts of a very long conversation.

### F4 — Retention and deletion

Same `ASSISTANT_LOG_RETENTION_DAYS` purge applies to conversations as it does to today's log rows. Users can
rename and delete their own conversations (matches Open WebUI's own affordances, and is the sensible default for
anything a person can now revisit indefinitely). Redaction (F7 in the original plan-back) is per-answer already
and needs no change — it keeps applying to every message in a thread exactly as it does to a single one today.

### F5 — Admin visibility: unchanged

Admins already see every question, answer, rating and comment via the CSV export. Grouping them into named
conversations doesn't need a new admin view — the existing weekly-review workflow keeps working as is. Whether
individual users' conversation *titles* should be admin-visible (vs. just the flat log) is a small, separate
question, not a blocker.

### F6 — Testing: a second, smaller evaluation, not a rewrite of the gate

The 59-question gate stays exactly as it is and keeps running weekly — it's still the right measure of single-turn
grounding. A new, small set (10–15 real two-to-three-turn conversations, the kind of follow-up a colleague would
actually type) is needed specifically to check: does the rewritten query retrieve the right document for the
follow-up, and does the final answer correctly use what was said earlier. This is genuinely new measurement work,
comparable in kind (if not size) to building the original golden set.

### F7 — Rollout: two phases, not one big change

- **Phase 1 — persistence only.** Save and list conversations, reopen them, rename/delete. Each question inside a
  thread is still retrieved independently (no rewriting yet) — the model does see the conversation in its prompt,
  so it has *some* context, but retrieval itself stays exactly as accurate (or inaccurate, for a bare follow-up) as
  it is today. Ships real, visible value — "my history is here when I come back" — with no change to retrieval, no
  new gate needed beyond confirming nothing regressed on the existing 59 questions.
- **Phase 2 — context-aware retrieval.** Add F2's query rewriting, backed by F6's new evaluation set. This is
  where the real engineering risk and the real benefit both live.

Recommended over doing both at once: smaller, independently verifiable steps, matching how the rest of this
project has shipped (Phase A/B/C for the assistant itself; every page of the design redesign, one at a time).

## 2. What doesn't change

- The existing `POST /api/assistant/ask` contract for a plain, un-threaded question — untouched, still used by
  `app/gate.py` and `app/chat.py` exactly as today.
- The release gate and its thresholds.
- Redaction, the three answer states, the disclaimer, rate limits, the concurrency cap's *size* (still 2) — only
  how many calls one threaded turn makes against it changes, in Phase 2.
- Everything about how documents are indexed (F3/F4 of the original plan-back).

## 3. Open questions for the owner

1. Phase 1 first, then decide on Phase 2 once it's live? (Recommended — matches how the rest of this shipped.)
2. Any objection to the extra LLM round-trip per follow-up in Phase 2, given the LLM is shared with other teams?
3. Anything from Open WebUI specifically you want matched beyond "saved, resumable conversations with working
   follow-ups" — e.g., renaming, search across past conversations, exporting a thread?

## 4. Build log

**§3 answered 2026-09-22**: Phase 1 first (then decide on Phase 2 once live); no objection to Phase 2's extra
LLM round-trip; nothing beyond saved/resumable conversations wanted from Open WebUI specifically. Approved.

**Phase 1 built and tested the same day.** Backend: `conversation` table + a nullable `query_log.conversation_id`
(`app/db.py`), `app/conversations.py` (create/list/history/messages/rename/archive/discard — delete is a soft
archive, matching doc-control's own convention; a conversation that never got a first message due to a 503 is hard
`discard`ed rather than left as an empty orphan), `Assistant.ask` gained optional `history`/`conversation_id`
params (retrieval untouched, exactly as planned — only the LLM prompt gains prior turns as real chat messages),
five new endpoints under `/api/assistant/conversations`. Frontend: `AssistantPage.tsx` rebuilt around a
conversation sidebar (a `Card` column on desktop, a `Sheet` drawer on mobile via a new "History" button) —
every question typed into the page now starts or continues a conversation; the old single-shot `POST /ask` stays
in the service, used only by the gate and `app/chat.py`, never by the page.

**A real bug found by testing against a simulated pre-existing database, not just a fresh one**: the new
`conversation_id` index was created in the same schema script as the rest of the tables, which is fine for a
brand-new database but crashes on database already on disk (production's, among others) — `CREATE INDEX ... ON
query_log(conversation_id, ...)` ran before the column-adding `ALTER TABLE` for a database that predates this
feature, since `CREATE TABLE IF NOT EXISTS query_log` is a no-op there and never adds the column. Fixed by moving
the index creation into the same conditional migration step as the `ALTER TABLE`, after the column is guaranteed
to exist either way. A test opens a hand-built pre-existing database (old schema, one row) to prove the upgrade
path specifically, not just a fresh `:memory:` one. **Deployment note**: this migration is automatic — it runs
the moment the assistant container next starts, no manual step like V12's needed.

Evidence: 171 Python tests (3.10, 3.12; 27 new), the spike-only import check still clean (`auth.py`/gate/chat stay
free of web packages), the strict TypeScript build clean, 27 browser checks against a stub covering the full
conversation lifecycle (start, follow-up, new chat, switch between threads, reopening shows saved messages in
order with the `NOT_FOUND` marker still stripped, rename — including its blur-triggered fallback when the
in-browser Enter keypress the test first tried turned out unreliable to simulate, not a real bug — delete with
confirmation and no effect on other conversations, the empty-index 503 leaving no orphan, admin-only debug info,
and the mobile drawer). Screenshots: `screenshots/assistant-conversations/` (gitignored).

**Not built**: Phase 2 (query rewriting for context-aware retrieval on a follow-up) — waits on Phase 1 actually
being used first, per the approved rollout. Nothing here is committed or deployed.
