# AI Assistant — RAG Spike: Findings

Record of the bounded spike run on 2026-09-21, kept after the throwaway kit (`spike/rag/`, untracked) is retired.
Companion to `AI_Assistant_Design_PlanBack.md`, which builds on these numbers. No company document text, question
text or credential appears in this file; documents are referred to by number only.

**Question asked**: can a fully local retrieval-augmented assistant answer colleagues' questions from the controlled
documents accurately, with citations, refusing what the documents do not say, at a usable speed?
**Answer**: yes, well enough to put in front of a small pilot group. The remaining unknowns are answered by usage.

## Setup

- **Corpus**: 25 real ENG documents, `SOP-ENG-0001..0010` and `WI-ENG-0001..0015` (about 26,000 words, 211 chunks).
- **Models, all local**: Qwen3-Embedding-4B (2560 dims), bge-reranker-v2-m3, DeepSeek V4.1 Flash (552B MoE, FP8) on the
  shared SGLang server. The LLM runs in Docker on GPUs 0-3, published on loopback :8010 only; the embedding and
  reranker servers were started for the spike on GPUs 4 and 7.
- **Questions**: 59, written by Claude after reading every document (47 answerable, 12 not answerable), each with
  expected documents and short literal facts, each fact verified word for word against the extracted text, each
  unanswerable question searched for across all 25 documents. Kinds: lookup, paraphrase, near-duplicate documents,
  tables, flowchart-only answers, Malay, multi-document, aggregate, and four kinds of not-answerable.

## The LLM endpoint (measured)

| Measurement | Result |
|---|---|
| Time to first token vs prompt size | 1,909 tokens 0.3 s; 9,253 tokens 1.1-1.3 s; 27,878 tokens 3.2 s; 56,671 tokens 6.4 s (about 9k tokens/s prefill) |
| Three simultaneous ~8k-token requests | all finished at 3.0 s: prefill is serialized, so cap doc-control at 2-3 calls |
| Decode | roughly 100-150 tokens/s |
| Thinking | off by default; top-level `reasoning_effort` accepts none, minimal, low, medium, high, xhigh, max (integers are HTTP 400); `chat_template_kwargs {"thinking": true}` also works; cost on a 10k prompt about +0.2 s |
| Served context | `--context-length 409600`, `--max-running-requests 8` |

## Retrieval (47 answerable questions)

| method | right document first | in the top 5 | MRR@10 |
|---|---|---|---|
| dense (meaning) only | 83% | 96% | 0.89 |
| BM25 (keywords) only | 87% | 98% | 0.92 |
| hybrid (RRF) | 87% | 98% | 0.92 |
| hybrid + reranker | **98%** | **100%** | **0.99** |

Keywords beat meaning at rank 1 (SOP text is full of exact identifiers). The reranker fixed the near-duplicate
documents (R863A vs R863A CX8 vs R860ADXBB, the copy-pasted SOP-ENG-0002..0005), the flowchart question and a Malay
question. Retrieval time per question: 11 ms hybrid, 55 ms with the reranker. Indexing: 211 chunks in 1.5 s.
The top-5 figure is saturated on a 25-document corpus (five documents is 20% of it); the rank-1 column is the informative one.

## Generation (strict prompt, no thinking)

| | whole documents (top 3) | chunks (top 8) |
|---|---|---|
| `NOT_FOUND` on the 12 unanswerable questions | 12/12 | 12/12 |
| answered the 47 answerable (did not abstain) | 44 | 43 |
| cited an expected document | 46 | 47 |
| invalid citations | 0 | 0 |
| all expected facts in the answer text | 47 | 46 |
| latency p50 / p95 | 2.2 s / 4.2 s | 1.6 s / 3.5 s |
| average prompt / completion tokens | 6,566 / 134 | 2,724 / 129 |

Even the near-miss traps (a value that exists for other models but not the one asked about; an operating
temperature that exists only for a different product) got `NOT_FOUND` with a useful "what the sources do cover".
When a document contradicted itself (13 vs 14 cables, two screw part numbers) the assistant said so and cited both.

**What went wrong**

- `NOT_FOUND:` was put on 3 (documents) and 4 (chunks) correct answers, mostly after an over-cautious reading; the reply
  still contained the right facts. So the label can lie while the content is right: show the text under a banner.
- Answers repeated plain-text logins from SOP-ENG-0008 and WI-ENG-0009 in 3 of 59 questions, in both modes, once while
  refusing a different question.
- The whole-document run listed 3 of the 6 SOPs on a "which SOPs..." question (only 3 documents in context) and the LLM
  judge, which sees the same context, called it correct; the chunks run found all 6. Completeness is invisible to the judge.
- One chunks answer was cut mid-step ("cut off at Swap"): the neighbouring chunk was not retrieved.
- One whole-document answer in Malay attributed a fact to the wrong source label; one padded its answer with an unrelated value.
- The flowchart-only question failed in both modes: when a flowchart becomes text its arrows are lost.

## What the documents showed (feeds the design)

- **Text boxes**: the standard Word reader (`python-docx`) skips them. The first extraction silently missed 1,372 words
  (5.6% of the corpus; up to 66% of a single document, including whole flowcharts). The kit now reads them.
- **Pictures**: the process flows in SOP-ENG-0002..0005 and the cable matrices in WI-ENG-0011..0015 are images. No text
  extractor reads them; only OCR or a vision model could.
- **Two languages**: every work-instruction step is repeated in Bahasa Malaysia (the SOPs are English only).
- **Credentials**: default logins in plain text in SOP-ENG-0008, WI-ENG-0008, WI-ENG-0009.
- **Model names only in titles**: OCES85ZZG6, Pulsar OCX-6215A, H8230, R863A, R860ADXBB, AS-4125GS-TNRT, H8250 appear in the
  titles of WI-ENG-0002 and 0004..0015, never in their body text, so the index header must carry the document title.
- **Document errors the assistant will surface**: 13 were found and listed for the owners (e.g. WI-ENG-0012 says 13 cables
  in one step and 14 elsewhere; SOP-ENG-0008 says REV 2 while its file name says Rev 1).
- **Corpus predicate**: every indexed document is readable by every authenticated user today (see the plan-back, F3).

## Process lessons

- **Noise vs signal**: an early smoke-test conclusion rested on token totals that varied between runs (28, 30, 29); the real
  signal, reasoning tokens, was zero in every row. Decide which number proves a claim and repeat measurements.
- **Check assumptions cheaply**: SGLang was assumed to run on the host; it runs in Docker.
- **Extraction before retrieval**: check what the extractor sees before judging retrieval quality.
- **Synthetic vs real questions**: Claude-written questions are cleaner than colleagues' real ones, so the absolute numbers
  above are optimistic. Real questions from pilot users are the calibration the spike lacked.

## What the spike did not establish

Real users' phrasing; behaviour beyond 25 documents; what a model swap by the LLM's owner does; multi-turn conversation;
thinking-on quality (only latency was measured, not accuracy); the sharper `--prompt partial` (implemented in the kit,
not run); the `--no-header` ablation (not run); other embedding models (skipped: too little headroom to measure).

## The kit

`spike/rag/` (untracked; `docs/`, `golden.jsonl`, `questions*`, `results_*/`, `idx_*/` are gitignored because they hold
company text): `rag_spike.py` (smoke, index, ask, search, eval), `make_golden.py` (`--verify`), `synth_questions.py`
(never run against the real LLM), `mock_server.py` (plumbing without GPUs), `README.md`, `LEARNING_GUIDE.md`. Its code is
the starting point for the sidecar in the plan-back; the kit is deleted once the sidecar has replaced it.
