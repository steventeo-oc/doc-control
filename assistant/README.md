# assistant: the document-control "Ask" service

A read-only, retrieval-augmented answering service for the controlled documents. It never writes to
document-control; it reads what every signed-in user can already read, indexes it, and answers questions with
citations. Design: `../AI_Assistant_Design_PlanBack.md`. Measurements behind it: `../AI_Assistant_Spike.md`.

## Status

| Phase | Content | State |
|---|---|---|
| A. Core | extraction (incl. Word text boxes), credential redaction, chunking, embeddings, hybrid search + reranker, neighbour chunks, prompt, three answer states, query log, HTTP API, release gate | **built; gate PASS on the box** (strict-2: abstained 12/12, right document first 100%, p95 2.7 s) |
| B. Integration | database view (migration V12) and MinIO reader, session check against the api, compose profiles, nginx route, admin status page, smoke section 16 | **approved 2026-09-22** (119 Python tests on 3.10 and 3.12, 8 Java tests, full smoke green with stand-in models) |
| C. The page | React "Ask" page and rail item (`web/`) | **built; awaiting review** (48 stub + 11 real-stack browser checks) |
| D. Go live | switch on for everyone, RUNBOOK, weekly review | not started |

Setup, start-up and day-to-day operation: `../RUNBOOK.md` section 7. Development runs with `ASSISTANT_SOURCE=folder` and
`ASSISTANT_AUTH=none` (Settings refuses that combination with the real source).

## Layout

```
app/
  config.py      settings from environment variables (plan-back 2.7)
  extract.py     docx (text boxes, tables), pdf, text -> blocks
  redact.py      credentials in documents are replaced before indexing (F7)
  chunking.py    ~260-word chunks that never cross a heading, 40-word overlap, headers
  textsearch.py  tokenizer, BM25, reciprocal rank fusion
  db.py index.py SQLite file + in-memory snapshot (vectors + BM25), swapped atomically
  sources.py     VersionRef, FolderSource (development and the gate)
  doccontrol.py  the production source: the assistant_indexable_version view (Postgres, read-only role) + MinIO
  auth.py        the Identity type and the development identity (nothing to install)
  session.py     SessionAuth: asks the api who the caller is (GET /api/auth/me, 60 s cache), CSRF and Origin rules
  statuspage.py  the admin status page (plain HTML, everything escaped)
  sync.py        reconcile the index with the source: add, remove, refresh, retry with backoff
  models.py      embedding, reranker and LLM clients (all failures are ModelError)
  prompts.py     named prompt versions (strict-1 = measured in the spike, strict-2 = the default)
  ask.py         retrieve, select sources, ask, classify (answered | not_found | unavailable), log
  logdb.py       assistant_query_log with feedback (not audit_log)
  ratelimit.py   per-user window that protects the shared LLM
  api.py         /api/assistant/* (config, ask, feedback, admin status, status.html, sync, log.csv, health)
  main.py        wiring for uvicorn
  gate.py        the release gate: the golden questions through this code path
tools/
  mock_models.py stand-ins for the embedding, reranker and LLM servers (compose profile `mock-models`, smoke 16)
tests/           119 tests, no GPU or network needed (fake model servers, generated Word/PDF files)
```

## Run the tests

```bash
pip install -r requirements-dev.txt
python -m pytest
```

## Run the release gate (needs the model servers)

The golden set and the documents are company text and stay out of git; point the gate at them:

```bash
export LLM_API_KEY=...            # or ASSISTANT_LLM_API_KEY; the spike's LLM_BASE_URL, EMB_BASE_URL and
                                  # RERANK_BASE_URL are understood too
python -m app.gate --docs ~/rag-spike/docs --golden ~/rag-spike/golden.jsonl --report gate-report-strict2
python -m app.gate --docs ~/rag-spike/docs --golden ~/rag-spike/golden.jsonl --prompt strict-1 --report gate-report-strict1
```

It indexes the folder with the service's own sync, asks every golden question through `Assistant.ask`, and prints
the plan-back thresholds (abstention 100%, cited an expected document at least 95%, right document first at least
95%, no invalid citations, nothing unavailable, p95 at most 6 s). Exit code 0 means PASS. `--data` keeps the index
between runs (default `gate-data`); delete it to force a re-embed.

## Ask questions in a terminal (before anything is deployed)

```bash
python -m app.chat --docs ~/rag-spike/docs                   # type questions; an empty line quits
python -m app.chat --docs ~/rag-spike/docs --context --ask "How long does the MGX test take?"
```

The service's own code path over a folder of documents: it prints the answer, its state (answered, not covered,
unavailable) and its sources the way the page does, and with `--context` the passages the model was shown. It writes
nothing but its own working folder (`chat-data`). Like the gate it reads `LLM_API_KEY`, `EMB_BASE_URL` and the other
model addresses from the environment, and it needs only numpy, requests, pypdf and python-docx: `auth.py` and everything
the gate imports stay free of web packages (`tests/test_chat.py` imports both with them blocked), because the box's spike
environment does not have fastapi.

## Safety properties worth keeping

- Read-only: no code path writes to document-control, MinIO or the documents.
- The corpus is exactly what every authenticated user can already open; there is no per-user filtering to get wrong
  (plan-back F3). A parity test in the Java build guards that assumption.
- Credentials are redacted at indexing and again in every answer; the prompt also forbids repeating them.
- Answers are plain text: the UI must never render model output as HTML.
- `ASSISTANT_AUTH=none` is refused unless the source is a folder.
