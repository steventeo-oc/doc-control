# AI Assistant ("Ask") — v1 Pilot: Design Plan-Back

Companion to `AI_Assistant_Spike.md` (what the spike measured) and `Phase2_Roadmap.md`. Goal, from the owner
(2026-09-21): stop testing in isolation and put a first version in front of colleagues, so real questions and real
feedback drive what comes next. *(Status: drafted 2026-09-21; **approved by the owner the same day with one change, to F9** — see "Decisions" below. Implementation follows §7. **Phase A passed its release gate; Phase B was approved by the owner on 2026-09-22; Phase C (the Ask page) is built and awaits the owner's review**: what building found or changed is in §11, and the approved text is otherwise untouched.)*

Everything below is grounded in the code as it exists on main today: document visibility
(`DocumentService.PUBLIC_STATUSES`, `findVisible`), version-pointer semantics (`document.current_version_id`), file
storage (`document_version.file_reference` is the MinIO object key), the session and CSRF setup
(`server.servlet.context-path=/api`, `CookieCsrfTokenRepository` with cookie path `/`), the reverse proxy
(`web/nginx.conf`) and compose (`docker-compose.yml`).

## Decisions (owner, 2026-09-21)

| Flag | Decision |
|---|---|
| F1 | Yes. A Python sidecar is acceptable; the owner owns every system involved. |
| F7 | (a) Redact credentials when indexing. |
| F9 | **Changed**: no pilot group and no daily cap. Every signed-in user can use it as soon as it is switched on. Only the technical protections below remain, because they protect the shared LLM rather than limit users. |
| F10 | Yes. The embedding and reranker containers become permanent; a dedicated LLM key will be requested from its owner. |
| F12 | Native React page. The SPA is already React and only its backend is Java, so the page is one more route in the same app; the assistant is the only new service. |
| F6 | The "check the document before acting" wording is approved as proposed. |
| Corpus | The 25 ENG documents are released in production doc-control. |

---

## 0. Where the spike left us

25 real ENG documents, 59 questions (47 answerable, 12 not), fully local models. Detail in `AI_Assistant_Spike.md`.

| Question | Result |
|---|---|
| Does retrieval find the right document? | hybrid + reranker: first for 98% (46/47), in the top 5 for 100%. Keywords alone 87%, meaning alone 83% at rank 1 |
| Does it refuse what the documents do not say? | `NOT_FOUND` on 12/12, in both context modes, including the near-miss traps |
| Does it cite the right document? | 46/47 (whole documents), 47/47 (chunks), 0 invalid citations |
| Is it fast enough? | chunks mode: p50 1.6 s, p95 3.5 s, about 2.7k prompt tokens, no thinking |
| What went wrong? | `NOT_FOUND` printed on 3-4 correct answers; logins repeated from SOPs in 3 of 59 answers; list questions capped by 3 documents; one chunk cut mid-step; flowchart-only content unanswerable |
| What did extraction miss? | Word text boxes (1,372 words, up to 66% of one document); flowcharts and cable matrices that are pictures |

**Not established**: how real colleagues phrase questions (the 59 were written by Claude after reading the documents,
so the numbers are optimistic); behaviour beyond 25 documents (the top 5 of 25 is 20% of the corpus); what a model
swap by the LLM's owner does; conversations with follow-ups. Usage answers these; more spike runs do not.

## 1. Flags — decision points for the owner

| Flag | Decision | Proposed default | Needs the owner? |
|---|---|---|---|
| F1 | Where it lives | Python sidecar first, in-app port only if the pilot earns it | Decided: yes |
| F2 | Login | Mount under `/api/assistant/`, validate every request against the api | Confirm |
| F3 | What is indexed | Exactly what every signed-in user can already read | Confirm |
| F4 | How it stays current | Read a database view every 5 minutes (no event hooks) | Confirm |
| F5 | The pipeline | The spike's measured configuration plus three small, gated changes | Confirm |
| F6 | What an answer looks like | Three states, text never hidden, sources always shown | Confirm |
| F7 | Credentials inside documents | Redact when indexing | Decided: redact |
| F8 | Logging and feedback | Own log, admin-visible, notice under the input | Confirm |
| F9 | Rollout and limits | Open to every signed-in user; technical limits only | Decided: open to all |
| F10 | Serving the models | Promote the two spike containers to compose; dedicated LLM key | Decided: yes |
| F11 | Release gate | The golden set through the real code path | Confirm |
| F12 | The page | Native React "Ask" (or a sidecar-served page as a fast lane) | Decided: native |

### F1 — A sidecar first; an in-app port only if the pilot earns it

The tech-stack table calls Java/Spring "decided, not open for silent change", and the pipeline the spike measured is
Python. Two ways to deliver:

- **A. In the Spring app.** pgvector (the Postgres image would change to `pgvector/pgvector:pg16`: same major version,
  but a change to the one stateful service; the 2,560-dimension embeddings also exceed pgvector's 2,000-dimension
  index limit, so `halfvec`, shorter dimensions or no index), hybrid search in SQL, a Java extraction port (which
  must re-solve the text-box problem the spike found and re-prove its numbers), reconciler jobs, a streaming
  controller, tests on the Windows Postgres 15 that has no pgvector (schema gated behind a flag). It is the right end
  state, roughly three times the work, and it freezes the response contract before anyone has used it.
- **B. A sidecar (recommended).** One container, `assistant` (Python 3.12: FastAPI, numpy, pypdf, python-docx), built
  from the spike's measured code. It reads the database through a read-only view, keeps its own index (SQLite) in its
  own volume and calls the three model servers over HTTP. The doc-control database and api are untouched apart from
  one migration; `docker compose` without the profile behaves exactly as today; removing it means deleting a service.
  Precedent: the Gotenberg sidecar (Phase 2e) is also a non-Java service behind an HTTP contract.

**Resolution (recommended)**: B, with the seams drawn so that A can replace the implementation later without touching
the SPA, the view (F4) or the log (F8): the HTTP contract in §2.4 is the boundary. Graduate to A only if the pilot
criteria in §8 are met; keeping the sidecar is a legitimate outcome if it is cheap to run. **Cost accepted**: a
second runtime to patch and watch (small: about 1,000 lines, pinned dependencies, its own tests).

### F2 — One login: mount under `/api/assistant/` and check every request with the api

`JSESSIONID` is scoped to the `/api` context path, so a route outside `/api/` would never receive the session cookie
(the CSRF cookie is `Path=/`, which is why the SPA can read it). **Resolution (recommended)**: nginx sends
`/api/assistant/*` to the sidecar. The sidecar validates each request by calling `GET http://api:8080/api/auth/me`
with the caller's `Cookie` header (cached 60 s per session): 200 gives the identity (id, name, roles, departments),
401 is passed through. For POSTs it applies the api's own double-submit CSRF rule (`X-XSRF-TOKEN` equals the
`XSRF-TOKEN` cookie) plus an `Origin` check.

Consequences: no new accounts or credentials; logout, expiry and deactivation take effect within a minute; each
validation also counts as session activity, so an open Ask page does not idle the session out; the SPA's existing
fetch client already sends the CSRF header for `/api/...`. Alternatives: nginx `auth_request` (authenticates but yields
no identity, so no per-user log or allow-list); a Spring proxy controller (best for the later port, but Java plus a
proxy for streaming now).

### F3 — Index exactly what every signed-in user can already read

The predicate: **not trashed, status `approved` or `released`, has a current version → that version's original file.**
This is `PUBLIC_STATUSES` plus the rule that non-owners only ever see the current version, so every indexed byte is
already readable by every authenticated user: the assistant needs no per-user filtering and cannot widen access. Drafts,
in review, superseded, obsolete and trashed documents never enter, and a document that leaves the predicate is dropped
at the next sync. Guard: a parity test (§6) asserts that everything in the view can be opened through the API by a plain,
non-member user; it fails if visibility ever changes without the assistant being revisited.

File types in v1: PDF (text layer) and DOCX. Everything else (DWG, images, .msg/.eml, XLSX/PPTX) is listed on the admin
status page as "not searchable: type" rather than silently missing; scanned PDFs as "no text". **Hard dependency
recorded**: named-user overrides or confidential documents (the "Later" backlog) require per-user filtering in the
assistant (or its port) before they ship.

### F4 — Sync by reading state, not by listening for events

The current version moves via `promoteVersion` and the effective-date flip, but `markObsolete`, delete/restore,
reactivate and discard-draft change what is visible without calling it; event hooks in Java would miss paths.
**Resolution (recommended)**: migration V12 creates the view `assistant_indexable_version` (the F3 predicate plus the
metadata needed, §2.6). A read-only Postgres role sees only that view; a read-only MinIO user sees the bucket. The
sidecar polls every 5 minutes, diffs the view against its index and adds, removes or refreshes; failures retry with
backoff and show on the status page. Idempotent and self-healing after any outage, and no hook to forget.

Cost: up to 5 minutes of lag, shown as "Index updated at…" on every answer, plus an admin "Sync now" button. Creating
the role and the MinIO user is a RUNBOOK step, not a migration (it needs a secret and would fail on the Windows test
database). A `folder` source adapter (same pipeline, reads a directory) serves development and evaluation: the ENG
documents used in the spike only reach the sidecar through doc-control once they are released there.

### F5 — Pipeline pinned to what the spike measured, plus three small changes behind the release gate

**Pinned**: extraction (DOCX including text boxes as `Diagram text:` lines and tables as `a | b` rows; PDF text layer);
chunks of about 260 words with 40 overlap that never cross a heading; header "number - title - section"; Qwen3-
Embedding-4B with its query instruction; BM25 and dense search fused by RRF (k=60); bge-reranker-v2-m3 over the top 30;
top 8 chunks to the model; the strict grounded prompt; no thinking; no LLM judge in production (one LLM call per
question).

**Changes** (each must pass the gate, F11, or it does not ship):

1. The header title is `document.name`, not a file name. The spike's titles carried `Rev 0` and, for the work
   instructions, the only mention of the product model (H8230, R863A, …). Check at first sync that names carry the
   model; if not, owners fix names, not code.
2. Neighbouring-chunk expansion for the top 3 hits (fixes the "cut off at Swap" failure).
3. `reasoning_effort` pinned explicitly (`none`, confirmed with `smoke` to give zero reasoning tokens) so a change to the
   server default cannot silently change behaviour. One prompt addition: reply in the language of the question.

### F6 — Answers have three visible states; the text is never hidden

**Answered** (cited), **Not covered** (`NOT_FOUND`), **Unavailable** (models busy or down). In the spike every
`NOT_FOUND` on an answerable question still carried the right facts, so the UI shows the model's text under a banner
("Not covered by the current documents. What they do say:") instead of a bare refusal. Sources are always listed under
the answer: document number, title, section, revision "v3", effective date, link, including for Not covered ("closest
documents") and as the fallback when the LLM is down (retrieval does not need it).

Every answer carries: *AI-generated from controlled documents. The document is the controlled record: check it before
acting. Lists may be incomplete.* (wording for QA to approve). A "Partial" state and the sharper `--prompt partial` wait
for real usage data; the prompt version is a config value logged with every answer, so the change is a config flip plus
a gate run.

### F7 — Credentials inside documents: redact when indexing (the owner's decision)

Three of 59 spike answers, in both modes, repeated a login and password that sit in plain text in SOP-ENG-0008,
WI-ENG-0008 and WI-ENG-0009, once while refusing a different question. Anyone allowed to open those documents can read
them, so this is not a permission bypass; but an assistant volunteers them and the query log (F8) would store them.

- **(a) Redact at indexing (recommended).** Patterns such as `password: …` and `username/password …` become
  `[redacted]` in the indexed text (never in MinIO), counted per document on the status page, plus a prompt rule never
  to output credentials. A few regexes and a unit test.
- (b) Leave as is; accept that answers and the log carry them.
- (c) Redact only in the log.

Redaction does not replace fixing the documents (the owners may prefer to move credentials out of the SOPs).

### F8 — Logging, privacy and feedback

An own table, `assistant_query_log`, in the sidecar's volume; **not** `audit_log`. `audit_log` is the ISO trail of
changes to controlled documents (every write action, convention 2) and feeds the CSV export auditors use; a question is
not a document-control event and would drown it. Columns: time, user, question, answer, state, sources (document,
version, chunk), model, prompt version, index snapshot, timings, rating (👍/👎) and comment. Visible to admins (status
page and CSV); users see their own history in v1.1. Retention 12 months (config). A one-line notice under the input:
"Questions and answers are logged to improve the assistant."

Feedback is the pilot's product: every 👎 and every Not covered becomes a candidate golden question, the calibration
set the spike lacked.

### F9 — Rollout: open to every signed-in user, with technical limits only (decided)

A compose profile `assistant`: without it nothing changes. Flag `DOCCONTROL_ASSISTANT_ENABLED`. **Decided by the owner: no pilot group and no daily cap** — every signed-in user can use it as soon as it is switched on. The protections that stay are there for the shared LLM, not to limit anyone: 600-character questions, 10 per minute per user (a human rarely reaches it; a script does), two simultaneous LLM calls overall (prefill is serialized on the shared server, measured), a short queue, then a "busy" state. `ASSISTANT_ALLOWED_DEPARTMENTS` (empty means everyone) and `ASSISTANT_RATE_PER_DAY` (0 means off) stay as switches for later.

### F10 — Serving the models, and the shared LLM

Today the LLM is another team's SGLang container (GPUs 0-3, published on loopback :8010, its key visible in `ps` and
pasted into a chat once); `emb-qwen` (GPU 4) and `rerank` (GPU 7) are hand-started spike containers.

**Resolution (recommended)**:

1. Promote the two spike containers to `docker-compose.ai.yml`: pinned image, `restart: unless-stopped`, weights cached
   in a volume so restarts work offline, health checks, GPUs 4 and 7 (5 and 6 stay free).
2. The sidecar joins the SGLang compose network to reach the LLM (the host-gateway address cannot reach a port published
   on loopback only). **To verify on the box before Phase B**: `docker network ls` and `docker inspect` of the LLM
   container. Fallback: `network_mode: host` for the sidecar.
3. Ask the LLM's owner for a dedicated key for doc-control: it replaces the exposed one and lets usage be attributed or
   revoked.
4. Pin `LLM_MODEL` and log it with every answer. A model swap by its owner changes behaviour; the golden set is the alarm.

Failure behaviour is in §4 (D1-D4).

### F11 — Release gate: the golden set through the real code path

The 59 questions run against the sidecar (first with the `folder` adapter, then against the real corpus): abstention
12/12, cited an expected document ≥ 95%, invalid citations 0, right document first ≥ 95%, p95 ≤ 6 s. Run before the
pilot, after any change to the prompt, model or config, and weekly during the pilot with the new real questions
appended. The golden data stays out of git (it is derived from company text); the runner and the thresholds live in
the repo.

### F12 — The page: native React "Ask" (recommended) or a sidecar-served page (fast lane)

- **Native**: a `/assistant` page and a rail item "Ask" in the design system (Card, Input, Button, Badge) using the
  existing fetch client; mobile comes for free through the shared `RAIL_ITEMS`. About two build sessions.
- **Fast lane**: the sidecar serves one plain HTML page at `/api/assistant/ui` (same cookie, same API), linked from the
  nav. Off-brand and throwaway; testers get in about two sessions sooner.

**Resolution (recommended)**: native. Take the fast lane only if the owner wants testers before the Ask-page
screenshots are approved. Open WebUI (already on the box) was considered as the front end and rejected: separate
accounts from doc-control, so no identity, allow-list or per-user log; no source links; no state banners.

## 2. Design

### 2.1 Shape

```
Browser ──► nginx (web) ──► /api/assistant/* ──► assistant (Python, new)
                  │                                 │ 1. GET api:8080/api/auth/me   (cookie → identity, 60 s cache)
                  └──► /api/* ──► api (Spring)      │ 2. own index: SQLite in volume `assistant_data`
                                                    │ 3. embeddings :8011 · reranker :8012 · LLM :8010
  every 5 min:                                      │
  Postgres view assistant_indexable_version ◄───────┤ (read-only role)
  MinIO bucket doccontrol ◄─────────────────────────┘ (read-only user)
```

### 2.2 Sync (F4)

```
desired = SELECT * FROM assistant_indexable_version
have    = index rows (version_id → state)
add     : in desired, not in have  → fetch from MinIO → extract → redact → chunk → embed → store
remove  : in have, not in desired  → delete chunks and row
refresh : number or name changed   → re-embed (the header changed); other metadata just updated
failed  : retry after 1 h, 6 h, 24 h; the status page lists reason and attempts
swap    : build the new in-memory index (matrix + BM25), then swap the pointer atomically
```

A bad file never stops the sync. Versions are immutable, so `version_id` is enough to detect change. The first sync on
an empty index shows "Indexing… N of M documents".

### 2.3 Ask path

1. Session check (F2) → allow-list (F9) → limits → question length.
2. Embed the query (with its instruction prefix) → dense top 50 and BM25 top 50 → RRF → top 30 → rerank → top 10 →
   document numbers named in the question are boosted → top 8 chunks, neighbours added for the top 3 (F5).
3. Prompt: system rules + numbered SOURCES + QUESTION → LLM (semaphore of 2, 45 s timeout, `max_tokens` 1200, effort
   `none`).
4. Parse `NOT_FOUND`, map `[S#]` citations to sources (unknown labels are ignored), redact defensively, log, respond.

Degrading: reranker down → skip it, log it, keep going (the spike's hybrid alone was 87% first / 98% top 5); LLM down or
timed out → state `unavailable` with the retrieved sources; embedding server down → `unavailable`.

### 2.4 HTTP contract (the boundary a later port must keep)

```
GET  /api/assistant/config    → {enabled, allowed, examples[], documents, syncedAt}
POST /api/assistant/ask       {question} → {id, state: answered|not_found|unavailable, answer,
                               sources:[{label, documentId, documentNumber, title, section, version,
                                         effectiveAt, cited}], index:{syncedAt, documents}, model,
                               promptVersion, ms}
                               400 empty/too long · 401 · 403 not allowed · 429 (Retry-After) · 503 index building
POST /api/assistant/feedback  {id, rating: up|down, comment?} → 204   (only the asker may rate)
GET  /api/assistant/admin/status    (Admin) coverage, skipped/failed with reasons, redactions, last sync, model health
POST /api/assistant/admin/sync      (Admin) → 202
GET  /api/assistant/admin/log.csv   (Admin)
GET  /api/assistant/health          no auth
```

### 2.5 Stores (SQLite, WAL, in the `assistant_data` volume)

```
doc_version(version_id PK, document_id, document_number, name, type_code, department_code, version_number,
            effective_at, file_reference, state indexed|skipped|failed, reason, words, chunks, redactions,
            attempts, next_try_at, indexed_at)
chunk(id PK, version_id, ord, section, text, embed_text, vector BLOB float16)
query_log(id PK, at, user_id, user_name, question, answer, state, sources JSON, model, prompt_version,
          index_snapshot, ms, rating, comment)
sync_run(id, started_at, finished_at, added, removed, refreshed, failed)
```

The index is derived data (rebuildable in minutes); the query log and feedback are not, so the volume goes into the
backup routine (RUNBOOK). Size: 500 documents at about 9 chunks each is 4,500 chunks, about 25 MB of float16 vectors.

### 2.6 Java change: one migration and two tests

```sql
-- V12__assistant_index_view.sql
CREATE VIEW assistant_indexable_version AS
SELECT d.id AS document_id, d.document_number, d.name AS document_name,
       t.code AS type_code, dep.code AS department_code,
       v.id AS version_id, v.version_number, v.file_reference,
       v.effective_at, v.uploaded_at, d.updated_at AS document_updated_at
FROM document d
JOIN document_version v ON v.id = d.current_version_id
JOIN document_type t    ON t.id = d.document_type_id
JOIN department dep     ON dep.id = d.department_id
WHERE d.deleted_at IS NULL AND d.status IN ('approved', 'released');
```

RUNBOOK (per deployment): `CREATE ROLE assistant_ro LOGIN PASSWORD '…'; GRANT SELECT ON assistant_indexable_version TO
assistant_ro;` and a MinIO user with a read-only policy on the `doccontrol` bucket (folded into the existing
"dedicated MinIO user" go-live item).

### 2.7 Config (env, all with defaults; secrets only in the gitignored `.env`)

`DOCCONTROL_ASSISTANT_ENABLED=false` · `ASSISTANT_SOURCE=doccontrol|folder` · `ASSISTANT_DB_URL` ·
`ASSISTANT_MINIO_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET` · `ASSISTANT_API_URL=http://api:8080/api` ·
`ASSISTANT_LLM_BASE_URL/API_KEY/MODEL/EFFORT=none` · `ASSISTANT_EMB_BASE_URL` · `ASSISTANT_RERANK_BASE_URL` ·
`ASSISTANT_SYNC_MINUTES=5` · `ASSISTANT_TOP_CHUNKS=8` · `ASSISTANT_NEIGHBOURS=1` · `ASSISTANT_PROMPT=strict` ·
`ASSISTANT_ALLOWED_DEPARTMENTS=` · `ASSISTANT_MAX_CONCURRENT=2` · `ASSISTANT_RATE_PER_MIN=10` ·
`ASSISTANT_RATE_PER_DAY=0` · `ASSISTANT_MAX_QUESTION_CHARS=600` · `ASSISTANT_LOG_RETENTION_DAYS=365` ·
`ASSISTANT_REDACT_SECRETS=true`.

### 2.8 Compose and nginx

`docker-compose.yml` gains the `assistant` service under `profiles: ["assistant"]` (build `./assistant`, volume
`assistant_data`, healthcheck on `/api/assistant/health`, depends on postgres, minio, api). `docker-compose.ai.yml`
(used on the box) adds the two model containers and the external network of the LLM stack; a `mock-models` profile
serves the kit's mock server so a GPU-less dev machine can run the whole flow (plumbing only).

```nginx
# web/nginx.conf, before the generic /api/ block. A variable plus Docker's resolver, so nginx still starts when
# the assistant profile is off; requests then get 502 and the SPA hides the Ask item.
location /api/assistant/ {
    resolver 127.0.0.11 valid=10s;
    set $assistant http://assistant:8000;
    proxy_pass $assistant;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}
```

No streaming in v1 (p50 is about 2 s), so no proxy-buffering exceptions.

### 2.9 SPA (F12, native)

New: `web/src/pages/AssistantPage.tsx`, `web/src/api/assistant.ts`. Edited: `App.tsx` (route `assistant`), `Layout.tsx`
(rail item "Ask", `Sparkles`, shown only when `GET /api/assistant/config` reports `allowed`). The page:

```
Ask                                        Beta
[ Ask about the current controlled documents…                    ] [Ask]
Try: "How long does the standalone MGX test take?" · …            (examples come from config)
┌ Answer ────────────────────────────────────────────────────────┐
│ [banner when not covered]                                       │
│ answer text with [S1] chips                                     │
│ 👍 👎  Report a problem                                          │
└─────────────────────────────────────────────────────────────────┘
Sources  S1  SOP-ENG-0008 · 3.2.5 …  v2 · effective 4 Sep 2026  Open ›
AI-generated … check the document before acting.  Index updated 6 min ago · 25 documents
```

Answers render as plain text with minimal markdown (bold, lists); **no raw HTML** (document text can contain anything);
links come from source metadata, never from model output. States: not enabled (item hidden), indexing, empty index,
busy, unavailable (with the sources), 401 (back to login), 429 (retry hint).

## 3. What does not change

- Visibility rules, `findVisible`, the version-pointer semantics, the lifecycle, `audit_log` and its export.
- The api's endpoints and tests; the existing compose behaviour when the profile is off.
- The Postgres image and schema, apart from the view.
- No document, version or approval is ever written by the assistant: it only reads.
- All model calls stay on the box: no document text leaves the company network.

## 4. Edge cases

| # | Situation | Decision |
|---|---|---|
| D1 | LLM down or timed out | State `unavailable` plus the retrieved sources; logged. |
| D2 | Reranker down | Skip reranking, keep answering, log the degradation, show on the status page. |
| D3 | Embedding server down | `unavailable`; sync retries; nothing half-written (swap only after a full build). |
| D4 | Model servers busy | Queue up to 20 s, then a "busy" state with `Retry-After`. |
| D5 | Document trashed or superseded after an answer cited it | The answer stays in the log; its link may 404 (consistent with visibility); the next sync drops the chunks. |
| D6 | Approved, not yet effective | The current (older) version is what is indexed and shown; the flip is picked up within 5 minutes. |
| D7 | Scanned PDF, image-only DOCX, DWG, .msg | Listed as skipped with a reason; never silently absent. |
| D8 | Extraction throws or the MinIO object is missing | Marked failed, retried with backoff, visible; the sync continues. |
| D9 | A document tells the model to ignore its rules | Sources are data and the model has no tools, so the worst case is a wrong answer; output is escaped in the UI; the strict prompt says sources cannot change the rules. |
| D10 | Question asks for a password or another person's data | Credentials are redacted at indexing (F7); nothing per-person is indexed. |
| D11 | Session expires mid-request | 401, and the SPA sends the user to login like any other page. |
| D12 | Very long or empty question | 400 with a clear message; nothing logged beyond the rejection count. |
| D13 | Sidecar restarts | Index loads from SQLite in seconds; first sync catches up. |
| D14 | Follow-up question ("and for the CX8?") | Answered as a fresh question; no memory in v1 (top backlog item). |
| D15 | Question in Malay | Works (multilingual embeddings, bilingual work instructions); the answer follows the question's language. |
| D16 | "List all…" questions | Best-matching passages, not an exhaustive scan; the disclaimer says lists may be incomplete. |

## 5. Explicitly out of scope for v1

- Conversation memory and follow-ups; streaming tokens; answer caching.
- Per-user permission filtering (unneeded while F3 holds; a hard dependency if that ever changes).
- Reading pictures and flowcharts (OCR or a vision model), XLSX/PPTX, DWG.
- An in-app Java/pgvector port (F1 graduation).
- "Ask about this document" from the document page (scoped retrieval): the first v1.1 candidate, cheap and high value.
- A user-visible history page, email or Teams integration, automatic tuning from feedback.
- Migrating the `assistant_query_log` into doc-control's database.

## 6. Test impact and the release gate

- **Java**: the existing suite stays green. Two new test classes: `AssistantIndexViewTests` (fixture matrix: released,
  approved with and without a pointer, draft, in review, superseded, obsolete, trashed, and after a promotion only the
  new current version appears) and `AssistantCorpusVisibilityTests` (every row of the view can be opened through the API
  by a plain non-member user: `GET /documents/{id}` and `GET /documents/{id}/versions/{versionId}` return 200, and
  rows outside the view return 404 — the guard for F3). Both run on the existing Windows Postgres 15.
- **Sidecar (pytest)**: extraction fixtures (a DOCX with a text box, a table and headings; a PDF; a scan), chunking
  invariants, redaction patterns, the sync diff (add, remove, refresh, fail and retry), auth delegation with a fake api,
  CSRF, rate limits and the concurrency queue, prompt building, `NOT_FOUND` parsing, log writes, the HTTP contract.
- **Smoke section 16** (`scripts/smoke.sh`): compose up with the assistant profile and mock models; upload and release a
  fixture document; sync; ask a question it answers (200, `answered`, cites the fixture's number) and one it does not
  (`not_found`); unauthenticated 401; trash the document; sync; ask again and it is no longer cited. Standing habit
  applies (notification flag `false` for the smoke run).
- **Release gate (F11)** on the box with the real models: thresholds in F11; results attached to the phase review.

## 7. Build order (a review pause after every phase) and effort

| Phase | Content | Pause / evidence |
|---|---|---|
| A. Sidecar core | `assistant/` from the spike code: sources (`folder`), extraction, redaction, chunking, embedding, hybrid + rerank, prompt, `/ask`, log; pytest; the gate against the ENG folder | Owner sees the gate numbers (same questions, sidecar code path) |
| B. Integration | V12 view and its tests, RUNBOOK role and MinIO user, `doccontrol` source, F2 auth, compose profile, `docker-compose.ai.yml`, nginx, status page, smoke 16 | Owner sees the status page on the box (coverage, skipped, failed) and the smoke pass |
| C. The page | `AssistantPage`, rail item, states, feedback, mobile | Screenshots for owner review, per the redesign habit |
| D. Go live | Switched on for every signed-in user, notice under the input, RUNBOOK section, weekly review routine | First week's log |

Effort: about 8-9 focused sessions (A 3-4, B 2, C 2, D 1). The fast lane (F12) removes about 2 sessions and puts a plain page
in testers' hands after Phase B. Rollback at any time: stop the `assistant` container and the nav item disappears; the
view is harmless.

## 8. Pilot: what to measure, and when to decide

Weekly: active users, questions per user, share rated 👍, share Not covered and the top Not-covered questions (content gaps
or naming problems), p50/p95 latency, sync lag, documents skipped or failed (coverage), LLM availability. **Proposed
criteria after four weeks**: most pilot users ask at least three questions a week; at least 70% of rated answers are 👍;
Not covered under 25% once obvious content gaps are fixed; p95 under 6 s; no incident of a wrong answer acted on. Then
decide: widen the audience, tune (the sharper prompt, thinking, "ask about this document", follow-ups), port to Java, or stop.

## 9. Risks

| Risk | Mitigation |
|---|---|
| The shared LLM is slow, busy or swapped by its owner | Concurrency cap, `unavailable` state with sources, pinned and logged model, the golden set as the alarm, a dedicated key |
| Users treat answers as authoritative | Citations with revision and date, the banner, the "check the document" line, QA-approved wording, pilot group first |
| A stale answer after a document changes | 5-minute sync, revision and effective date on every source, the "Index updated" line |
| Prompt injection through an uploaded document | Read-only assistant, no tools, escaped output, strict prompt; uploaders are authenticated staff |
| The corpus is thin (ENG documents not yet released in doc-control) | Check the count at first sync; agree which departments' documents should be in before the pilot |
| A second runtime to operate | Small code, pinned dependencies, tests, one container that can be removed; the port stays available |
| Real questions are far harder than the 59 | That is the point of the pilot; the log feeds the golden set, and the gate is rerun weekly |
| Exposed secrets: the LLM key was pasted into chat; Postgres and MinIO ports are published on all interfaces | Rotate or replace the LLM key (F10); the sidecar uses the internal network, and closing the published ports is recommended independently of this feature |

## 10. What was asked of the owner (answered 2026-09-21)

All answered; see "Decisions" at the top. Still to do on the box, not decisions: check the LLM container's network name before Phase B (two `docker` commands), request the dedicated LLM key, and confirm at the first sync that the work instructions' names carry the product model (F5).

## 11. Build log

What building found or changed, recorded here so the approved text above stays as approved.

### Phase A: the release gate (2026-09-21, on the box, real models, the 25 ENG documents, the 59 questions)

| criterion | needs | strict-2 (the default) | strict-1 (the spike's wording) |
|---|---|---|---|
| abstained on the 12 unanswerable | 100% | **100%** | 92% (fails) |
| cited an expected document | at least 95% | 100% | 100% |
| right document first | at least 95% | 100% | 100% |
| invalid citations, unavailable | 0, 0 | 0, 0 | 0, 0 |
| p95 latency | at most 6 s | 2.7 s | 2.7 s |

**Gate: PASS with strict-2.** p50 1.3 s, 2,963 prompt tokens on average. strict-2 answered 46 of the 47 answerable
questions, strict-1 42. Read the comparison with care: one run of each, and twelve unanswerable questions cannot tell 100%
from 92% apart with confidence. strict-2 stays the default because it passed, not because the run proves it beats
strict-1; the gate is rerun weekly with real questions appended.

The one miss left with strict-2, c38 (how many cables leave the R863A expansion module), is a cable matrix that is a picture
in the document; the reply began `NOT_FOUND` but still carried the facts, which is what the "Not covered" banner (F6)
shows instead of hiding. With strict-1, c48 (a torque the documents do not give) was answered in substance ("not stated in
the sources") without the `NOT_FOUND` marker, so it would have appeared as an answer with no banner. The marker is what the
classification relies on, which is why the gate counts it.

### Phase B: built (pending the owner's review)

The database view and its tests (migration V12; `AssistantIndexViewTests`, `AssistantCorpusVisibilityTests`); the
`doccontrol` source (the view over a fresh read-only connection per sync, files from MinIO); the session check against the
api with the CSRF and Origin rules; an HTML status page for admins; the compose profiles `assistant` and `mock-models`;
`docker-compose.ai.yml`; the nginx route; `scripts/assistant-setup.sh`; smoke section 16; the RUNBOOK section.
Evidence: 8 new Java tests and 118 Python tests green (Python 3.10 and 3.12); the full smoke passes (sections 0-16)
against a rebuilt stack with the stand-in models; the two view tests were also run against a deliberately weakened view
and failed for the right reasons (including the parity test: a leaked superseded document gave 404 instead of 200).

**Added to or changed from section 2**

- **Status page** (section 2.4): `GET /api/assistant/admin/status.html`, a plain HTML page served by the sidecar for admins
  (the JSON at `/admin/status` is unchanged). Section 7 asked the owner to see "the status page" in Phase B, before the
  React page exists; a React admin page can replace it later if wanted. Every value that came from a document is escaped.
- **Config** (section 2.7): `ASSISTANT_DB_PASSWORD` is separate from `ASSISTANT_DB_URL` (so the URL can be logged), plus
  `ASSISTANT_ALLOWED_ORIGINS` (the app's public URL, for the Origin check), `ASSISTANT_SESSION_CACHE_S` (60) and
  `ASSISTANT_DB_TIMEOUT`. `ASSISTANT_PROMPT` defaults to `strict-2`. Secret settings are excluded from `repr()`.
- **nginx** (section 2.8): the read timeout is 90 s, not 60 s: the worst case is 20 s queueing for the shared LLM plus its
  45 s timeout.
- **Credentials** (section 2.6): the two RUNBOOK commands became `scripts/assistant-setup.sh`, which generates the secrets
  into `.env`, never prints them, creates the role and the MinIO user, and proves that the role cannot read the `document`
  table and the user cannot write. The Postgres role also gets `default_transaction_read_only` and a statement timeout,
  and the connection asks for a read-only transaction.
- **Names** (F5.1): the index header uses `document.name` with the document number and a trailing "Rev N" removed, which is
  the normalisation the spike measured; the file name comes from the tail of `file_reference`.
- **Short documents**: a document with a few words but not enough to search is listed as "too little text to search (N
  words)", not as a scan, so a short form does not look like it needs OCR.

**Findings about the existing system (not changed; for the owner)**

- The API serves a **trashed** document to any signed-in user who asks for it by id (`findVisible` does not look at
  `deleted_at`); only the lists hide it. The assistant deliberately does not index trashed documents (D5), so the view is
  narrower than the API here, and the parity test does not assert the API's behaviour on this point.
- For an **approved document with no current version** (a first release waiting for its effective date), the version
  endpoints do not hide its versions from non-members, because `findVisibleVersion` only hides other versions when a current
  version exists. Again the view is narrower, and the behaviour is not asserted.
- The MinIO read-only user can read **every object in the bucket**, drafts included: MinIO cannot restrict by document
  status. The assistant only ever fetches the keys the view lists.
- The assistant reads the **original** file, users read the stamped PDF rendition. The claim in F3 holds if the two carry
  the same text; checked on the 25 ENG documents: no hidden text (three hidden paragraph marks, no words), no tracked
  changes, no comments. Worth re-checking when other departments' documents arrive.
- Smoke sections 5 and 6 had been failing since the draft lock of 2026-09-17 (a second draft is refused); they now assert
  the lock and download version 1.
- On this Windows host the JVM cannot open a loopback pipe, so no Spring context starts there; the Java tests were run in WSL
  against throwaway containers (`scripts/java-tests-wsl.sh`, RUNBOOK section 6, item 7).

### Owner decisions since the build began (2026-09-22)

- **Phase B reviewed and approved.**
- doc-control production runs on the **same box as the models for now, and may be separated later**. Everything the assistant
  connects to is a setting (RUNBOOK section 7, "Where doc-control runs"), so a later split is a configuration change: the
  assistant moves with doc-control, and the `llm` external network in `docker-compose.ai.yml` is replaced by an address and a
  key-protected route to the model servers.
- Box facts read off the machine: doc-control's Compose network is `doc-control_default`; the LLM's is
  `deepseek-v41-flash-4x-rtx-pro-6000_default` (the value for `LLM_DOCKER_NETWORK`); the LLM container is
  `deepseek-v41-flash-4x-rtx-pro-6000-deepseek-1`, listening on 8010, so `ASSISTANT_LLM_BASE_URL` is
  `http://deepseek-v41-flash-4x-rtx-pro-6000-deepseek-1:8010/v1`. doc-control's web is published on 3001 there (Open WebUI owns
  3000), and Postgres, MinIO and the api are published on all interfaces (the known open item).
- **Origin check hardened after reading those facts.** `.env.example` defaults `APP_BASE_URL` to `http://localhost:3000`; a box
  that kept that value (its web is on 3001) would have refused every question, because the allow-list defaulted to it. The
  service now always accepts a request from the page's own address (the browser's `Origin` equals the `Host` nginx forwards; nginx
  keeps the port for this route), and `ASSISTANT_ALLOWED_ORIGINS` only adds to that; an empty list no longer switches the check
  off. Other sites, other ports, `Origin: null` and a mismatched host are refused. Verified through the real nginx (8 cases) and
  in a real browser opened from an address that is not in the list.
- The compose file now passes through the documented tunables (`ASSISTANT_ALLOWED_DEPARTMENTS`, prompt, limits, sync interval,
  retention); empty means the service's own default. The RUNBOOK has the box's steps in order, with a private first look (own
  department only) before switching on for everyone.

### Phase C: the Ask page (built 2026-09-22, pending the owner's review)

Built: `web/src/pages/AssistantPage.tsx`, `web/src/api/assistant.ts`, `web/src/lib/answerText.ts`, the route `/assistant`, and the
rail item "Ask" (after Documents; also in the phone drawer). No new dependency, and the design system is reused (Card, Button,
Badge, the tokens).

- **When the item shows**: only while the service is running, switched on and open to the user (`GET /api/assistant/config`:
  `enabled` and `allowed`). Not deployed (nginx answers 502), switched off, or a failed check all simply hide it; the last answer
  is remembered for the browser session so the rail does not jump on each page load. Opened by URL anyway, the page explains
  itself.
- **States** (F6): answered (citation chips), not covered (an amber banner, then what the documents do say), unavailable (an amber
  notice, then the closest documents), plus loading, an empty index, switched off, service unreachable, 429 with the wait time,
  503 ("still being built"), and a 401 that sends the reader to the login page.
- **Answers are text, never HTML**: the reply is parsed into paragraphs, bullet and numbered lists (a split list keeps its
  numbers), bold, code, table rows (monospaced) and `[S1]` marks, and rendered with React elements only. A mark for a label that
  does not exist stays text; markup and links inside a reply stay visible text. The only links on the page come from the sources'
  metadata and open the document in a new tab, so the reader keeps the answer.
- **Sources**: the cited passages first (number, title, section, version, effective date, "Open document"), the other passages
  collapsed; for not covered and unavailable, "Closest documents", once per document, without S-labels (nothing cites them).
- **Feedback**: thumbs up or down at once (never lost), then an optional comment ("Add a comment" is the plan's "Report a
  problem"). The F6 disclaimer sits under every answer and the F8 logging notice under the box; admins also get the model, prompt
  version and time, and a link to the status page.
- **Small contract changes in the service**: for a not-covered reply the response no longer starts with the model's `NOT_FOUND`
  marker (a signal for us, not text for a person; the query log keeps the raw reply for the weekly review), and `/config` gained
  `maxQuestionChars`. The shared API client gained `ApiError.retryAfter` (the `Retry-After` header).

Evidence: the strict TypeScript build is clean; 14 checks of the reply parser (`node web/scripts/check-answer-text.ts`, no runner
needed); **48 browser checks against a stub** that produces every state (idle, answered, chip and other-passages behaviour,
feedback working and failing, not covered, unavailable, a long answer with a table, 429/503/502, hostile markup, loading, Enter and
Shift+Enter, example questions, empty index, switched off, service down, non-admin, expired session, a phone and its drawer); and
**11 checks on the real dev stack in a real browser** (real sources, the thumbs-up passing the service's CSRF and Origin checks
through nginx, both questions and the rating in the query log). Screenshots: `screenshots/assistant/` (gitignored).
Limits: the dev stack's models are stand-ins, so answer quality is not reviewed; only Edge was used; `web/` has no component test
runner, so the behaviour is covered by the browser checks above rather than by tests in the repo.

### Trying the real AI (2026-09-22, later)

- **A regression of mine, found before it was hit and fixed**: in Phase B `auth.py` imported `fastapi` at module level, so
  `python -m app.gate` would have failed with `ModuleNotFoundError` in the box's spike environment (numpy, requests, pypdf,
  python-docx only). `SessionAuth` moved to `session.py`; `auth.py` is standard library only again, and a test imports the gate
  and the client with the web packages blocked, so it cannot come back unnoticed.
- **New: `python -m app.chat`**, a terminal client over a folder of documents on the service's own code path, to try the real
  models on the real documents before anything is deployed (RUNBOOK section 7, "Trying the real AI first"). `--context` prints
  the passages the model was shown. Verified in a spike-only Python 3.10 on the 25 ENG documents with the stand-in models (25
  documents searchable, 6 credentials replaced, the same as the gate); **not yet run with the real models**.
