"""The release gate (plan-back F11): the golden questions through the service's real code path.

    python -m app.gate --docs ../spike/rag/docs --golden ../spike/rag/golden.jsonl [--prompt strict-2]

It indexes a folder with the service's own sync (extraction, redaction, chunking, headers), asks every golden
question through Assistant.ask (retrieval, reranker, neighbours, prompt, LLM) and checks the thresholds below.
The golden data is derived from company documents and stays out of git; only this runner is in the repo.

Model addresses come from the ASSISTANT_* variables; for convenience it also understands the spike's
LLM_API_KEY, LLM_BASE_URL, EMB_BASE_URL and RERANK_BASE_URL."""
from __future__ import annotations

import argparse
import dataclasses
import json
import math
import os
import statistics
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .ask import Assistant
from .auth import LOCAL_IDENTITY
from .config import Settings
from .db import Database
from .index import Index
from .logdb import QueryLog
from .models import Embedder, Llm, ModelError, Reranker
from .sources import FolderSource
from .sync import Syncer

# The thresholds in the plan-back (F11). Abstention is the safety property and has no tolerance.
THRESHOLDS = {"abstained_on_unanswerable": 1.0, "cited_expected_doc": 0.95, "right_document_first": 0.95,
              "invalid_citations": 0, "unavailable": 0, "p95_ms": 6000}
SPIKE_ENV = {"LLM_API_KEY": "ASSISTANT_LLM_API_KEY", "LLM_BASE_URL": "ASSISTANT_LLM_BASE_URL",
             "EMB_BASE_URL": "ASSISTANT_EMB_BASE_URL", "RERANK_BASE_URL": "ASSISTANT_RERANK_BASE_URL"}


def norm(text):
    return " ".join(text.lower().split())


def pct(values):
    values = [v for v in values if v is not None]
    return (sum(values) / len(values)) if values else None


def fmt(value):
    return "n/a" if value is None else f"{100 * value:.0f}%"


def evaluate(item, result):
    """One golden question against one AskResult -> a flat row of facts the gate aggregates."""
    response, debug = result.response, result.debug
    row = {"id": item["id"], "kind": item.get("kind", ""), "question": item["question"],
           "answerable": item.get("answerable", True), "state": response["state"], "ms": response["ms"],
           "bad_citations": len(debug.get("bad_citations", [])),
           "prompt_tokens": (debug.get("usage") or {}).get("prompt_tokens") or debug.get("prompt_tokens_est"),
           "answer": response["answer"], "degraded": debug.get("degraded", [])}
    if row["answerable"]:
        wanted = {d.lower() for d in item.get("expected_docs", [])}
        ranked = [d.lower() for d in debug.get("ranked_docs", [])]
        rank = next((i for i, d in enumerate(ranked, start=1) if d in wanted), None)
        cited = {d.lower() for d in debug.get("cited_docs", [])}
        facts = item.get("expected_facts", [])
        row.update(rank=rank, first=rank == 1 if wanted else None, top5=(rank is not None and rank <= 5)
                   if wanted else None, answered=response["state"] == "answered",
                   cited_expected=bool(cited & wanted) if wanted else None,
                   facts_ok=all(norm(f) in norm(response["answer"]) for f in facts) if facts else None)
    else:
        row["abstained"] = response["state"] == "not_found"
    return row


def summarise(rows):
    answerable = [r for r in rows if r["answerable"]]
    unanswerable = [r for r in rows if not r["answerable"]]
    ms = sorted(r["ms"] for r in rows)
    p95 = ms[max(0, math.ceil(len(ms) * 0.95) - 1)] if ms else 0      # nearest rank: never hides a slow outlier
    return {
        "right_document_first": pct([r["first"] for r in answerable]),
        "right_document_top5": pct([r["top5"] for r in answerable]),
        "answered_answerable": pct([r["answered"] for r in answerable]),
        "cited_expected_doc": pct([r["cited_expected"] for r in answerable]),
        "facts_in_answer": pct([r["facts_ok"] for r in answerable]),
        "abstained_on_unanswerable": pct([r["abstained"] for r in unanswerable]),
        "invalid_citations": sum(r["bad_citations"] for r in rows),
        "unavailable": sum(1 for r in rows if r["state"] == "unavailable"),
        "p50_ms": int(statistics.median(ms)) if ms else 0, "p95_ms": p95,
        "avg_prompt_tokens": int(statistics.mean([r["prompt_tokens"] for r in rows if r["prompt_tokens"]] or [0])),
    }


def verdicts(summary):
    out = {}
    for name, limit in THRESHOLDS.items():
        value = summary[name]
        if value is None:
            out[name] = ("n/a", True)
        elif name in {"invalid_citations", "unavailable"}:
            out[name] = (str(value), value <= limit)
        elif name == "p95_ms":
            out[name] = (f"{value} ms", value <= limit)
        else:
            out[name] = (fmt(value), value >= limit)
    return out


def by_kind(rows):
    groups = defaultdict(list)
    for r in rows:
        groups[r["kind"] or "(no kind)"].append(r)
    lines = ["| kind | n | right doc first | cited expected doc | facts in answer | abstained |", "|---|---|---|---|---|---|"]
    for kind, group in sorted(groups.items()):
        a = [r for r in group if r["answerable"]]
        u = [r for r in group if not r["answerable"]]
        lines.append(f"| {kind} | {len(group)} | {fmt(pct([r['first'] for r in a]))} | "
                     f"{fmt(pct([r['cited_expected'] for r in a]))} | {fmt(pct([r['facts_ok'] for r in a]))} | "
                     f"{fmt(pct([r['abstained'] for r in u]))} |")
    return lines


def failures(rows):
    out = []
    for r in rows:
        if r["state"] == "unavailable":
            out.append(f"{r['id']}: unavailable ({', '.join(r['degraded']) or 'no reason recorded'})")
        elif r["answerable"]:
            if r["rank"] is None or r["rank"] > 1:
                out.append(f"{r['id']}: right document ranked {r['rank'] or 'nowhere in the top 10'}")
            if r["state"] == "not_found":
                out.append(f"{r['id']}: NOT_FOUND on an answerable question")
            elif r["cited_expected"] is False:
                out.append(f"{r['id']}: answer did not cite an expected document")
            if r["facts_ok"] is False and r["state"] == "answered":
                out.append(f"{r['id']}: answer lacks an expected fact")
        elif not r["abstained"] and r["state"] != "unavailable":
            out.append(f"{r['id']}: answered a question the documents do not cover: {r['answer'][:100]!r}")
        if r["bad_citations"]:
            out.append(f"{r['id']}: cites a source label that was not provided")
    return out


def render(settings, sync_line, rows, summary, checks, docs_line):
    lines = [f"# Release gate: prompt {settings.prompt}, {settings.top_chunks} chunks, "
             f"{settings.neighbours} neighbour(s) for the top {settings.neighbour_top}", "",
             docs_line, sync_line, f"Questions: {len(rows)} ({sum(r['answerable'] for r in rows)} answerable)", "",
             "| criterion | result | needs | verdict |", "|---|---|---|---|"]
    needs = {"abstained_on_unanswerable": "100%", "cited_expected_doc": ">= 95%", "right_document_first": ">= 95%",
             "invalid_citations": "0", "unavailable": "0", "p95_ms": "<= 6000 ms"}
    for name, (value, ok) in checks.items():
        lines.append(f"| {name} | {value} | {needs[name]} | {'PASS' if ok else 'FAIL'} |")
    lines += ["", f"Also: right document in top 5 {fmt(summary['right_document_top5'])}, answered "
              f"{fmt(summary['answered_answerable'])} of the answerable, expected facts present "
              f"{fmt(summary['facts_in_answer'])}, p50 {summary['p50_ms']} ms, average prompt "
              f"{summary['avg_prompt_tokens']} tokens.", "", "## By kind", ""] + by_kind(rows)
    problems = failures(rows)
    lines += ["", "## Failures to look at", ""] + ([f"- {p}" for p in problems] or ["- none"])
    return "\n".join(lines)


def build(settings):
    db = Database(Path(settings.data_dir) / "assistant.db")
    index = Index(db)
    embedder = Embedder(settings.emb_base_url, settings.emb_api_key, settings.emb_model,
                        settings.emb_query_prefix, settings.emb_doc_prefix)
    reranker = Reranker(settings.rerank_base_url, settings.rerank_api_key, settings.rerank_model)
    llm = Llm(settings.llm_base_url, settings.llm_api_key, settings.llm_model, settings.llm_effort,
              settings.llm_timeout)
    assistant = Assistant(settings, index, embedder, reranker, llm, QueryLog(db))
    return index, embedder, assistant, Syncer(settings, index, FolderSource(settings.folder), embedder)


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--docs", required=True, help="folder with the documents (named like 'SOP-QA-0010 Title.pdf')")
    parser.add_argument("--golden", required=True, help="golden.jsonl from spike/rag/make_golden.py")
    parser.add_argument("--data", default="gate-data", help="working folder for the index and log (default gate-data)")
    parser.add_argument("--prompt", default=None, help="prompt version (default: the configured one)")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=1, help="questions asked at once (max 2)")
    parser.add_argument("--report", default=None, help="folder for report.md and results.jsonl")
    args = parser.parse_args(argv)

    env = dict(os.environ)
    for old, new in SPIKE_ENV.items():
        if old in env and new not in env:
            env[new] = env[old]
    env.update(ASSISTANT_SOURCE="folder", ASSISTANT_AUTH="none", ASSISTANT_FOLDER=args.docs,
               ASSISTANT_DATA_DIR=args.data, DOCCONTROL_ASSISTANT_ENABLED="true")
    settings = Settings.from_env(env)
    if args.prompt:
        settings = dataclasses.replace(settings, prompt=args.prompt)
    Path(args.data).mkdir(parents=True, exist_ok=True)

    items = [json.loads(line) for line in Path(args.golden).read_text(encoding="utf-8").splitlines() if line.strip()]
    if args.limit:
        items = items[:args.limit]
    index, _embedder, assistant, syncer = build(settings)

    print(f"indexing {args.docs} ...", flush=True)
    try:
        sync = syncer.run()
    except ModelError as exc:
        sys.exit(f"cannot index: {exc}")
    if sync is None or index.snapshot.empty:
        problems = "; ".join(sync.errors[:3]) if sync else "a sync was already running"
        sys.exit(f"nothing was indexed ({problems}). Are the embedding server and the documents folder right?")
    stats = index.stats()
    redactions = sum(r["redactions"] for r in index.redaction_rows())
    sync_line = (f"Index: {stats['indexed']} documents, {stats['chunks']} chunks, {stats['skipped']} skipped, "
                 f"{stats['failed']} failed, {redactions} credential(s) redacted, {sync.seconds:.1f} s")
    docs_line = f"Documents folder: {args.docs}; models: LLM {assistant.llm.model}"
    print(sync_line)
    for problem in index.problem_rows():
        print(f"  {problem['state']}: {problem['document_number']} - {problem['reason']}")

    rows = []

    def run(item):
        return evaluate(item, assistant.ask(item["question"], LOCAL_IDENTITY))

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 2))) as pool:
        for n, row in enumerate(pool.map(run, items), start=1):
            rows.append(row)
            print(f"  asked {n}/{len(items)}", end="\r", flush=True)
    print(f"\nasked {len(items)} questions in {time.perf_counter() - started:.0f} s")

    summary = summarise(rows)
    checks = verdicts(summary)
    report = render(settings, sync_line, rows, summary, checks, docs_line)
    print("\n" + report)
    if args.report:
        out = Path(args.report)
        out.mkdir(parents=True, exist_ok=True)
        (out / "report.md").write_text(report, encoding="utf-8")
        (out / "results.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n",
                                           encoding="utf-8")
        print(f"\nwritten: {out / 'report.md'} and results.jsonl")
    passed = all(ok for _value, ok in checks.values())
    print("\nGATE: " + ("PASS" if passed else "FAIL"))
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
