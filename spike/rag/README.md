# RAG spike kit (throwaway)

Answers three questions before any code goes into the app:

1. How does the DeepSeek endpoint on `:8010` really behave — reasoning fields, the effort dial, time to first
   token as prompts grow, and what happens with several requests at once?
2. Which embedding model (and does a reranker help) retrieves the right passages from *your* SOPs?
3. Does the model answer only from the documents, cite them, and say `NOT_FOUND` when they don't cover the question?

It uses in-memory numpy search on purpose: this measures model and retrieval quality, not database plumbing
(pgvector comes later, in the app). Nothing here touches the doc-control API, database or MinIO.

**New to RAG? Read [`LEARNING_GUIDE.md`](LEARNING_GUIDE.md) first.** It explains every concept behind these
commands, what the measurements mean, and includes five short experiments, a self-test and a glossary.

## Rules

- **The API key never goes on a command line** (visible to every user via `ps`). Use the silent prompt below.
- **Real SOPs and questions stay out of git.** Put them in `docs/` and `golden.jsonl` (both gitignored).
- **Do not touch GPUs 0-3 or the process on `:8010`.** Spike servers bind to `127.0.0.1` on GPUs 4-7 only.
- Spike code is throwaway (same as the watermark spike): delete it afterwards and record the findings in a
  short `AI_Assistant_Spike.md`.

## 0. Dry run anywhere (1 minute, no GPU)

The mock only proves the plumbing; its numbers mean nothing about real models.

```bash
python -m venv .venv && . .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python mock_server.py --key test-key &
export LLM_BASE_URL=http://127.0.0.1:18010/v1 EMB_BASE_URL=http://127.0.0.1:18010/v1 \
       RERANK_BASE_URL=http://127.0.0.1:18010/v1 LLM_MODEL=mock-model LLM_API_KEY=test-key EMB_API_KEY=test-key RERANK_API_KEY=test-key
python rag_spike.py index --docs examples/docs --out idx_mock
python rag_spike.py eval --index idx_mock --golden examples/golden.example.jsonl --rerank --generate --judge
```

## 1. On the prod box: probe the LLM endpoint

Copy the folder over (`scp -r spike/rag <user>@<box>:~/rag-spike`), then:

```bash
cd ~/rag-spike && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
read -rs LLM_API_KEY && export LLM_API_KEY          # paste the key; nothing is echoed or stored in history
python rag_spike.py smoke
```

Keep the output. It shows: (a) whether thinking arrives in `reasoning_content` and never leaks into `content`;
(b) how thinking is switched on and graded (judge by the *reasoning* columns; total token counts vary from run
to run) and what it costs in latency on a ~10k-token prompt; (c) seconds to the first answer token at
2k/10k/30k/60k prompt tokens (this decides how much context we pass per question); (d) latency with 3
simultaneous requests (this decides the concurrency cap). Run it in a quiet period; the 60k run is heavy.

## 2. Start embedding and rerank servers on the idle GPUs

SGLang on the prod box runs inside a Docker container (`docker ps`; `/opt/sglang/...` exists only in the
image), so start each spike server as its own container from the same locally built image, pinned to one
idle GPU and published on the box's loopback only. The first start downloads weights from Hugging Face
(needs internet from the container, or mount a folder with the model and pass its path instead).
Check `nvidia-smi` first: GPUs 4-7 should be idle. Stop and remove afterwards with `docker rm -f <name>`.

| name | GPU | port | model | extra flags |
|---|---|---|---|---|
| `emb-qwen` | 4 | 8011 | `Qwen/Qwen3-Embedding-4B` | `--is-embedding` |
| `emb-bge` | 5 | 8013 | `BAAI/bge-large-en-v1.5` | `--is-embedding --attention-backend triton` |
| `emb-gemma` | 6 | 8014 | `google/embeddinggemma-300m` | (auto-detected) |
| `rerank` | 7 | 8012 | `BAAI/bge-reranker-v2-m3` | `--is-embedding --disable-radix-cache --chunked-prefill-size -1 --attention-backend triton` |

```bash
IMAGE=deepseek-v41-4x6000:local        # image of the running SGLang container (docker ps / docker inspect)
mkdir -p ~/hf-cache
docker run -d --name emb-qwen --gpus '"device=4"' --ipc=host -p 127.0.0.1:8011:8011 \
  -e HF_HOME=/hf -v ~/hf-cache:/hf --entrypoint /opt/sglang/bin/python3 "$IMAGE" \
  -m sglang.launch_server --model-path Qwen/Qwen3-Embedding-4B --is-embedding --host 0.0.0.0 --port 8011
docker logs -f emb-qwen                # wait for the ready line, Ctrl-C only stops the log watch
curl -s http://127.0.0.1:8011/v1/models          # confirm it is up
```

If a server fails with an attention or kernel error, add `--attention-backend triton` to its command.

Query/document prefixes are model specific (check each model card):

| model | `--query-prefix` | `--doc-prefix` |
|---|---|---|
| Qwen3-Embedding-4B | `$'Instruct: Given a question about company procedures, retrieve the passages that answer it\nQuery: '` | none |
| bge-large-en-v1.5 | `'Represent this sentence for searching relevant passages: '` | none |
| embeddinggemma-300m | `'task: search result \| query: '` | `'title: none \| text: '` |

## 3. Corpus and questions (ask QA)

- `docs/`: 25-30 real released SOPs/WIs as PDF or DOCX, named like `SOP-QA-0010 Calibration Control.pdf`. Include
  messy ones (tables, forms, a scan) — the messy ones are the point.
- `golden.jsonl`: 30-50 questions worded the way people really ask (mine chat and email). One JSON object per line,
  see `examples/golden.example.jsonl`: `answerable`, `expected_docs` (numbers), `expected_facts` (short strings
  that must appear). Make about 20% **not answerable from the documents**, and include a few where the
  generic industry answer differs from your SOP; those catch answers made up from general knowledge.

QA does not need to write JSON. Give them `examples/questions.template.csv` (opens in Excel: keep the header
row, one question per row, save as CSV). Then convert and check it on any PC or on the box; it needs only the
Python standard library, refuses to write anything while there are errors, and warns about typos in document
numbers, facts that are too long, duplicate wording, too few questions or a lopsided answerable/not-answerable
mix, and documents that have no question yet:

```bash
python make_golden.py questions.csv --docs docs --out golden.jsonl
python make_golden.py questions.csv --docs docs --out golden.jsonl --verify   # also checks every expected fact
                                                                              # against the extracted text
```

`--verify` reads the documents with the kit's extractors (run it where `pip install -r requirements.txt` was done)
and warns when a fact is not in the expected documents: a typo, or a paraphrase instead of the document's own
words. An optional `kind` column (lookup, table, ...) makes `eval` print one score row per kind.

### No questions from QA yet? Simulate them

Two routes that complement each other. Neither replaces real questions, but both let you keep going:

1. **Claude writes them from documents you are allowed to share.** Put the documents in `docs/` and ask; Claude
   reads them and writes a `questions.csv` in the template format plus a `kind` column (direct lookups,
   paraphrases, near-duplicate documents, tables, flowcharts, Malay, questions that need two documents, questions
   the documents do not answer, general-knowledge traps), with every expected fact checked verbatim against the
   extracted text and a `questions_review.md` quoting each source passage. A different model writes them than the
   one under test, so there is less same-model bias. Done for the 25 ENG documents (59 questions); convert with
   `python make_golden.py questions.csv --docs docs --out golden.jsonl --verify`.
2. **The local LLM writes them at scale.** On the box, with the servers running and an index built:

   ```bash
   python synth_questions.py --index idx_qwen4b --out-dir synth_out --per-doc 4
   python rag_spike.py eval --index idx_qwen4b --golden synth_out/golden.synth.jsonl --rerank --out results_synth
   ```

   It writes `questions.synth.csv` (Excel-friendly), `golden.synth.jsonl` and `synth_review.md` (each question
   beside its source passage, for a 10-minute human review). A question survives only if its facts appear verbatim
   in the passage, it does not leak the answer, it does not merely copy the passage's wording, and a second LLM
   call confirms the passage alone answers it. It also writes multi-document questions and three kinds of
   unanswerable ones (near-miss, general-knowledge trap, out of scope), each confirmed unanswerable against what
   retrieval actually returns. Keep `synth_out/` out of git: it contains passages from your documents.

Synthetic questions are **optimistic**: they lean on the passage's wording and come from the same model family.
Use them to compare settings against each other, not to quote an absolute accuracy. To measure how optimistic they
are, run the eval on both sets (or on a handful of real questions) and compare the scores.

## 4. Index and score retrieval (fast, no LLM calls)

```bash
export EMB_BASE_URL=http://127.0.0.1:8011/v1
python rag_spike.py index --docs docs --out idx_qwen4b --query-prefix $'Instruct: Given a question about company procedures, retrieve the passages that answer it\nQuery: '
python rag_spike.py eval --index idx_qwen4b --golden golden.jsonl
python rag_spike.py eval --index idx_qwen4b --golden golden.jsonl --rerank --out results_qwen4b_rerank
```

Repeat for each embedding model (change `EMB_BASE_URL`, prefixes and `--out`). Also worth one run each:
`index --no-header` (does the "number - title - section" prefix help?) and `--chunk-words 150` / `400`.

## 5. Generation

Run the baseline first with no thinking flags (on the DeepSeek server the default is no thinking), then repeat with
thinking on, using the flags smoke printed. Observed on the DeepSeek server: top-level `--effort` accepts
none, minimal, low, medium, high, xhigh or max (integers are rejected with HTTP 400), and `--thinking on` also
switches thinking on. `--effort-via kwargs` with an integer and no `--thinking on` does nothing.

```bash
python rag_spike.py eval --index idx_qwen4b --golden golden.jsonl --rerank --generate --judge \
    --mode docs --out results_gen_docs
python rag_spike.py eval --index idx_qwen4b --golden golden.jsonl --rerank --generate --judge \
    --mode docs --effort low --effort-via top --out results_gen_docs_low
python rag_spike.py eval ... --mode chunks --out results_gen_chunks     # whole documents vs chunks only
python rag_spike.py ask --index idx_qwen4b "how often are torque drivers calibrated?" --rerank --show-context
```

`--prompt partial` changes one rule of the grounded prompt: `NOT_FOUND` only when the question's main point is
unanswered, otherwise answer and end with a `Not stated in the SOURCES:` line. It was added after the first run, where
`strict` answered every unanswerable question with `NOT_FOUND` but also put `NOT_FOUND` on a few correct answers.
Compare it with the same run under `strict`, and check that the unanswerable questions still abstain.

```bash
python rag_spike.py eval --index idx_eng --golden golden.jsonl --rerank --generate --judge --mode chunks --prompt partial --workers 2 --out results_gen_chunks_partial
```

Each eval writes `results_*/report.md` (tables plus a "failures to look at" list) and `results.jsonl`.
The judge is the same model grading itself: treat it as a screen and read the failing answers yourself.

## Learning aids

- `python rag_spike.py search --index idx_example "your question" --rerank` prints what each retrieval method
  returns (meaning-based, keyword, fused, reranked). Try a paraphrase and then a bare form number and watch the
  methods disagree. No LLM is called.
- `python rag_spike.py ask ... --show-context` prints the exact SOURCES + QUESTION the model receives.
- `python rag_spike.py ask ... --prompt loose` removes the grounding rules so you can see why they exist.
- Read `results_*/results.jsonl` for a failing question: which sources were used, what was cited.

## Send back

The `smoke` output and each `report.md`. Reports contain document numbers, your questions and the model's
answers, so skim them before sharing.

## Limits

Numpy search is fine up to roughly 100k chunks; production uses pgvector. Scanned PDFs are reported as
"NO EXTRACTABLE TEXT". Not measured here: permissions, drafts and revisions, behaviour under real load.
