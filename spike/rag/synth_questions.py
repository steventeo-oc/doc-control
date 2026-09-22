#!/usr/bin/env python3
"""Simulate QA's question list: the local LLM writes test questions from the documents you already indexed.

    python synth_questions.py --index idx_qwen4b --out-dir synth_out

Writes into --out-dir:
  questions.synth.csv   the questions in the spreadsheet format make_golden.py reads (open it in Excel, delete or
                        fix anything unrealistic, then convert with make_golden.py)
  golden.synth.jsonl    the same questions, ready for `rag_spike.py eval --golden` (extra fields are ignored)
  synth_review.md       every question next to its source passage, for a 10-minute human review

What it does: picks passages from each document and asks the LLM for a question a colleague might really ask, in
a mix of personas and styles, plus the short literal facts a correct answer must contain. A question is kept only
if its facts really appear in the passage, it does not leak the answer, it does not just copy the passage's
wording, and a second LLM call confirms the passage alone answers it. It also writes questions that need two
documents, and three kinds of questions the documents do NOT answer (near-miss, general-knowledge trap, out of
scope), each confirmed unanswerable against what retrieval actually returns.

Synthetic questions are optimistic: they come from the same model family and lean on the passage's wording. Use
them to compare settings against each other and to exercise the pipeline, not to quote an absolute accuracy.
"""
from __future__ import annotations

import argparse
import csv
import difflib
import json
import math
import random
import re
import statistics
import sys
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests

import rag_spike as rs

PERSONAS = [
    "a shop-floor operator in a hurry",
    "a new hire who does not know the jargon",
    "a QA auditor checking records and responsibilities",
    "a production supervisor who needs to know who must approve or sign",
    "an engineer who wants exact limits and steps",
]
STYLES = [
    "short and blunt, like a chat message",
    "one complete polite sentence",
    "casual, with an abbreviation or one small typo",
    "describes the situation first, then asks what to do",
    "a keyword-style search query without a question mark",
]

DIRECT_PROMPT = """You write test questions for a document-control assistant at a manufacturing company.
You are given ONE passage from a controlled procedure. Write ONE question that a colleague could really ask and that this passage answers.

Persona: {persona}
Style: {style}

Rules:
- The passage must contain the answer. Do not ask about anything it does not state.
- Use everyday words. Do NOT copy phrases of three or more consecutive words from the passage, and replace its technical words with plain synonyms where you can.
- Do not put the answer in the question. Do not mention the document number or title unless the persona would.
- expected_facts: one or two short exact strings copied verbatim from the passage (a number with its unit, a form number, a role, a time limit) that a correct answer must contain. At most 6 words each.
{hint}
Return JSON only: {{"question": "...", "expected_facts": ["...", "..."]}}

PASSAGE (from {doc_number} - {title}, {section}):
\"\"\"
{text}
\"\"\"
"""

MULTIHOP_PROMPT = """You write test questions for a document-control assistant at a manufacturing company.
Below are two passages from two different controlled procedures. Write ONE question that needs BOTH passages to answer, the way {persona} might ask it ({style}). If the passages are unrelated, so that no natural question needs both, return {{"question": null}}.

Rules: everyday words, do not copy phrases of three or more consecutive words, do not put the answer in the question.
facts_from_first / facts_from_second: one or two short exact strings copied verbatim from that passage that a correct answer must contain (at most 6 words each).

Return JSON only: {{"question": "...", "facts_from_first": ["..."], "facts_from_second": ["..."]}}

FIRST PASSAGE ({doc_a} - {title_a}, {section_a}):
\"\"\"
{text_a}
\"\"\"

SECOND PASSAGE ({doc_b} - {title_b}, {section_b}):
\"\"\"
{text_b}
\"\"\"
"""

NEAR_MISS_PROMPT = """You write test questions for a document-control assistant at a manufacturing company.
Below is ONE passage from a controlled procedure. Write ONE natural follow-up question that a colleague might ask on the SAME topic but that this passage does NOT answer (for example it asks for a value, step, role, form or exception that the passage does not state). It must sound like something people really ask, in the style: {style}.

Return JSON only: {{"question": "..."}}

PASSAGE (from {doc_number} - {title}, {section}):
\"\"\"
{text}
\"\"\"
"""

TRAP_PROMPT = """You write test questions for a document-control assistant at a manufacturing company.
Below is ONE passage from a controlled procedure. Write ONE question about common industry or ISO practice on this passage's topic, where a knowledgeable person would give a standard answer from general knowledge, but where THIS company's specific answer is NOT stated in the passage. Style: {style}.

Return JSON only: {{"question": "..."}}

PASSAGE (from {doc_number} - {title}, {section}):
\"\"\"
{text}
\"\"\"
"""

OUT_OF_SCOPE_PROMPT = """You write test questions for a document-control assistant at a manufacturing company.
The company's controlled procedures cover only these topics:
{topics}

Write {n} realistic questions an employee might ask at work that NONE of these procedures would answer (for example about HR, finance, IT, facilities or other subjects). Vary the style: some short and casual, some full sentences.

Return JSON only: {{"questions": ["...", "..."]}}
"""

VERIFY_PROMPT = """Do the passages contain the information needed to answer the question? Judge only from the passages, not from general knowledge.

PASSAGES
{passages}

QUESTION
{question}

Return JSON only: {{"answerable": true or false, "reason": "one short sentence"}}
"""


# --------------------------------------------------------------------------- helpers

def ask_json(llm, prompt, max_tokens=500, temperature=0.9, retries=1):
    """One LLM call that must return a JSON object; returns (data, error)."""
    error = "no attempt"
    for _ in range(retries + 1):
        try:
            reply = llm.chat([{"role": "user", "content": prompt}], max_tokens=max_tokens, temperature=temperature)
        except (rs.ApiError, requests.RequestException) as exc:
            error = f"LLM error: {str(exc)[:80]}"
            continue
        match = re.search(r"\{.*\}", reply["content"], re.S)
        if match:
            try:
                return json.loads(match.group(0)), None
            except json.JSONDecodeError:
                pass
        error = "unparseable JSON"
    return None, error


def verify(llm, passages, question):
    """True/False whether the passages answer the question; None when the check itself failed."""
    body = "\n\n".join(f"[P{n}] {text}" for n, text in enumerate(passages, start=1))
    data, error = ask_json(llm, VERIFY_PROMPT.format(passages=body, question=question),
                           max_tokens=200, temperature=0, retries=1)
    if data is None:
        return None, error
    flag = data.get("answerable")
    if isinstance(flag, bool):
        return flag, str(data.get("reason", ""))[:160]
    return None, "no true/false verdict"


def overlap_ratio(question, passage):
    """Share of the question's content words that also appear in the passage (1.0 = pure copy)."""
    words = set(rs.tokenize(question))
    return len(words & set(rs.tokenize(passage))) / len(words) if words else 0.0


def clean_facts(facts, passage):
    """Keep only short facts that really appear in the passage and cannot break the CSV format."""
    text = rs.norm(passage)
    kept = []
    for fact in facts or []:
        fact = str(fact).strip()
        if fact and len(fact.split()) <= 8 and not re.search(r"[;|]", fact) and rs.norm(fact) in text:
            kept.append(fact)
    return kept[:2]


def source_of(chunk):
    return {"doc_number": chunk["doc_number"], "title": chunk["title"], "section": chunk["section"],
            "pages": rs.pages_str(chunk), "text": chunk["text"]}


def source_label(src):
    return " - ".join(p for p in (src["doc_number"], src["title"], src["section"], src["pages"]) if p)


# --------------------------------------------------------------------------- generators
# Each returns (items, drop_reasons); an item is a dict with the fields the writers below use.

def make_direct(idx, llm, task, args):
    chunk = idx.chunks[task["chunk"]]
    reason = "generation failed"
    for attempt in range(2):
        hint = "" if attempt == 0 else "- Your previous question reused too many of the passage's words. Use different words.\n"
        prompt = DIRECT_PROMPT.format(persona=task["persona"], style=task["style"], hint=hint,
                                      doc_number=chunk["doc_number"], title=chunk["title"],
                                      section=chunk["section"] or "-", text=chunk["text"])
        data, error = ask_json(llm, prompt, temperature=args.temperature)
        if data is None:
            reason = "generation failed"
            continue
        question = str(data.get("question") or "").strip()
        facts = clean_facts(data.get("expected_facts"), chunk["text"])
        if not question:
            reason = "empty question"
            continue
        if not facts:
            reason = "expected fact not found verbatim in the passage"
            continue
        if any(rs.norm(f) in rs.norm(question) for f in facts):
            reason = "the question contains its own answer"
            continue
        overlap = overlap_ratio(question, chunk["text"])
        if overlap > args.max_overlap:
            reason = "copies the passage wording"
            continue
        ok, why = verify(llm, [chunk["text"]], question)
        if ok is None:
            reason = "verification call failed"
            continue
        if not ok:
            reason = "the passage alone does not answer it"
            continue
        return [{"kind": "direct", "question": question, "answerable": True,
                 "expected_docs": [chunk["doc_number"]], "expected_facts": facts,
                 "persona": task["persona"], "style": task["style"], "sources": [source_of(chunk)],
                 "overlap": overlap, "verdict": why}], []
    return [], [reason]


def make_multihop(idx, llm, task, args):
    a, b = idx.chunks[task["chunk"]], idx.chunks[task["other"]]
    prompt = MULTIHOP_PROMPT.format(persona=task["persona"], style=task["style"],
                                    doc_a=a["doc_number"], title_a=a["title"], section_a=a["section"] or "-", text_a=a["text"],
                                    doc_b=b["doc_number"], title_b=b["title"], section_b=b["section"] or "-", text_b=b["text"])
    data, error = ask_json(llm, prompt, max_tokens=600, temperature=args.temperature)
    if data is None:
        return [], ["generation failed"]
    question = data.get("question")
    if not question:
        return [], ["passages unrelated"]
    question = str(question).strip()
    facts_a = clean_facts(data.get("facts_from_first"), a["text"])
    facts_b = clean_facts(data.get("facts_from_second"), b["text"])
    if not facts_a or not facts_b:
        return [], ["expected fact not found verbatim in the passage"]
    if any(rs.norm(f) in rs.norm(question) for f in facts_a + facts_b):
        return [], ["the question contains its own answer"]
    if max(overlap_ratio(question, a["text"]), overlap_ratio(question, b["text"])) > args.max_overlap:
        return [], ["copies the passage wording"]
    alone_a, _ = verify(llm, [a["text"]], question)
    alone_b, _ = verify(llm, [b["text"]], question)
    both, why = verify(llm, [a["text"], b["text"]], question)
    if None in (alone_a, alone_b, both):
        return [], ["verification call failed"]
    if alone_a or alone_b:
        return [], ["one passage alone is enough (not multi-document)"]
    if not both:
        return [], ["the two passages together do not answer it"]
    return [{"kind": "multihop", "question": question, "answerable": True,
             "expected_docs": [a["doc_number"], b["doc_number"]], "expected_facts": (facts_a + facts_b)[:3],
             "persona": task["persona"], "style": task["style"], "sources": [source_of(a), source_of(b)],
             "overlap": max(overlap_ratio(question, a["text"]), overlap_ratio(question, b["text"])),
             "verdict": why}], []


def unanswerable_item(idx, llm, emb, question, kind, style, sources):
    """Confirm against what retrieval really returns that the documents do NOT answer the question."""
    found = rs.retrieve(idx, question, emb, None)
    top = [idx.chunks[i] for i, _ in found["final"][:6]]
    ok, why = verify(llm, [c["text"] for c in top], question)
    if ok is None:
        return None, "verification call failed"
    if ok:
        return None, "the documents do answer it (not a real negative)"
    return {"kind": kind, "question": question, "answerable": False, "expected_docs": [], "expected_facts": [],
            "persona": "", "style": style, "sources": sources, "overlap": 0.0, "verdict": why,
            "checked_against": [f"{c['doc_number']} {c['section']}".strip() for c in top]}, None


def make_near_miss(idx, llm, emb, task, args):
    chunk = idx.chunks[task["chunk"]]
    template = NEAR_MISS_PROMPT if task["kind"] == "near-miss" else TRAP_PROMPT
    prompt = template.format(style=task["style"], doc_number=chunk["doc_number"], title=chunk["title"],
                             section=chunk["section"] or "-", text=chunk["text"])
    data, error = ask_json(llm, prompt, max_tokens=300, temperature=args.temperature)
    question = str((data or {}).get("question") or "").strip()
    if not question:
        return [], ["generation failed"]
    item, reason = unanswerable_item(idx, llm, emb, question, task["kind"], task["style"], [source_of(chunk)])
    return ([item], []) if item else ([], [reason])


def make_out_of_scope(idx, llm, emb, task, args):
    topics = "\n".join(f"- {t}" for t in task["topics"])
    data, error = ask_json(llm, OUT_OF_SCOPE_PROMPT.format(topics=topics, n=task["n"]), max_tokens=600,
                           temperature=args.temperature)
    questions = [str(q).strip() for q in (data or {}).get("questions", []) if str(q).strip()]
    if not questions:
        return [], ["generation failed"]
    items, drops = [], []
    for question in questions:
        item, reason = unanswerable_item(idx, llm, emb, question, "out-of-scope", "", [])
        if item:
            items.append(item)
        else:
            drops.append(reason)
    return items, drops


def run_task(idx, llm, emb, args, task):
    kind = task["kind"]
    if kind == "direct":
        return make_direct(idx, llm, task, args)
    if kind == "multihop":
        return make_multihop(idx, llm, task, args)
    if kind == "out-of-scope":
        return make_out_of_scope(idx, llm, emb, task, args)
    return make_near_miss(idx, llm, emb, task, args)


# --------------------------------------------------------------------------- planning

def plan_tasks(idx, args, rng):
    skip = re.compile(args.skip_sections, re.I) if args.skip_sections else None
    by_doc = defaultdict(list)
    for i, chunk in enumerate(idx.chunks):
        if len(chunk["text"].split()) < args.min_words:
            continue
        if skip and skip.search(chunk["section"] or ""):
            continue
        by_doc[chunk["doc_id"]].append(i)
    if not by_doc:
        sys.exit("no passages long enough to write questions from; lower --min-words or check --skip-sections")

    def style():
        return rng.choice(STYLES)

    tasks, direct = [], []
    for doc_id in sorted(by_doc):
        chunks = by_doc[doc_id][:]
        rng.shuffle(chunks)
        for i in chunks[: args.per_doc]:
            direct.append(i)
            tasks.append({"kind": "direct", "chunk": i, "persona": rng.choice(PERSONAS), "style": style()})

    everything = [i for chunks in by_doc.values() for i in chunks]
    n_multi = args.multihop if args.multihop is not None else round(0.1 * len(direct))
    if len(by_doc) < 2:
        n_multi = 0
    for i in rng.sample(everything, min(n_multi, len(everything))):
        sims = idx.vectors @ idx.vectors[i]
        others = [int(j) for j in np.argsort(-sims) if idx.chunks[int(j)]["doc_id"] != idx.chunks[i]["doc_id"]
                  and int(j) in set(everything)][:5]
        if others:
            tasks.append({"kind": "multihop", "chunk": i, "other": rng.choice(others),
                          "persona": rng.choice(PERSONAS), "style": style()})

    expected_positives = len(direct) + n_multi
    wanted_negatives = math.ceil(expected_positives * args.unanswerable_ratio / (1 - args.unanswerable_ratio))
    candidates = math.ceil(wanted_negatives * 1.6)
    n_near, n_trap = math.ceil(candidates * 0.5), math.ceil(candidates * 0.25)
    n_oos = max(0, candidates - n_near - n_trap)
    for kind, count in (("near-miss", n_near), ("trap", n_trap)):
        for i in rng.sample(everything, min(count, len(everything))):
            tasks.append({"kind": kind, "chunk": i, "style": style()})
    topics = sorted({f"{c['title']}" for c in idx.chunks})[:40]
    for _ in range(math.ceil(n_oos / 5)):
        tasks.append({"kind": "out-of-scope", "n": 5, "topics": topics})
    return tasks


# --------------------------------------------------------------------------- outputs

def dedupe(items):
    kept = []
    for item in items:
        text = rs.norm(item["question"])
        if any(difflib.SequenceMatcher(None, text, rs.norm(k["question"])).ratio() > 0.85 for k in kept):
            continue
        kept.append(item)
    return kept


def rebalance(items, ratio, rng):
    """Trim unanswerable questions (round-robin across kinds) so they stay near the requested share."""
    positives = [i for i in items if i["answerable"]]
    negatives = [i for i in items if not i["answerable"]]
    allowed = math.ceil(len(positives) * ratio / (1 - ratio)) if positives else 0
    if len(negatives) <= allowed:
        return items, 0
    by_kind = defaultdict(list)
    for item in negatives:
        by_kind[item["kind"]].append(item)
    for group in by_kind.values():
        rng.shuffle(group)
    kept = []
    while len(kept) < allowed and any(by_kind.values()):
        for kind in sorted(by_kind):
            if by_kind[kind] and len(kept) < allowed:
                kept.append(by_kind[kind].pop())
    return positives + kept, len(negatives) - len(kept)


def write_outputs(items, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "questions.synth.csv", "w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["id", "question", "answerable", "expected_docs", "expected_facts", "notes"])
        for it in items:
            source = "; ".join(source_label(s) for s in it["sources"]) or "none (out of scope)"
            note = f"synthetic; kind={it['kind']}; source={source}; overlap={it['overlap']:.2f}"
            writer.writerow([it["id"], it["question"], "yes" if it["answerable"] else "no",
                             ";".join(it["expected_docs"]), ";".join(it["expected_facts"]), note])
    with open(out_dir / "golden.synth.jsonl", "w", encoding="utf-8", newline="\n") as fh:
        for it in items:
            record = {"id": it["id"], "question": it["question"], "answerable": it["answerable"],
                      "expected_docs": it["expected_docs"], "expected_facts": it["expected_facts"],
                      "synthetic": True, "kind": it["kind"], "persona": it["persona"], "style": it["style"],
                      "overlap": round(it["overlap"], 2), "sources": [source_label(s) for s in it["sources"]]}
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    lines = ["# Synthetic question review", "",
             "Every question below was written by the local LLM and machine-checked. A person should skim it before",
             "trusting it: delete unrealistic questions, fix wrong expected facts, and reword anything no colleague",
             "would ask that way. Edit `questions.synth.csv` (Excel) and convert it with `make_golden.py`.", ""]
    order = ["direct", "multihop", "near-miss", "trap", "out-of-scope"]
    for kind in order:
        group = [it for it in items if it["kind"] == kind]
        if not group:
            continue
        lines += [f"## {kind} ({len(group)})", ""]
        for it in group:
            lines.append(f"### {it['id']}: {it['question']}")
            if it["answerable"]:
                lines.append(f"- expected documents: {', '.join(it['expected_docs'])}; expected facts: "
                             f"{' | '.join(it['expected_facts'])}")
                flag = "  (HIGH: reuses a lot of the passage's wording)" if it["overlap"] > 0.6 else ""
                lines.append(f"- persona: {it['persona']}; style: {it['style']}; wording overlap with source: "
                             f"{it['overlap']:.2f}{flag}")
            else:
                lines.append("- not answerable from the documents")
                if it.get("checked_against"):
                    lines.append(f"- confirmed unanswerable against the top retrieved passages: "
                                 f"{'; '.join(it['checked_against'])}")
                if it["style"]:
                    lines.append(f"- style: {it['style']}")
            lines.append(f"- checker said: {it['verdict']}")
            for src in it["sources"]:
                snippet = " ".join(src["text"].split())
                lines.append(f"- source: {source_label(src)}")
                lines.append(f"  > {snippet[:600]}{'...' if len(snippet) > 600 else ''}")
            lines.append("")
    (out_dir / "synth_review.md").write_text("\n".join(lines), encoding="utf-8")


# --------------------------------------------------------------------------- main

def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--index", required=True, help="an index built by `rag_spike.py index`")
    parser.add_argument("--out-dir", default="synth_out")
    parser.add_argument("--per-doc", type=int, default=3, help="direct questions per document")
    parser.add_argument("--multihop", type=int, default=None,
                        help="questions that need two documents (default: about 10%% of the direct ones)")
    parser.add_argument("--unanswerable-ratio", type=float, default=0.25,
                        help="share of the final set the documents do NOT answer")
    parser.add_argument("--min-words", type=int, default=30, help="ignore passages shorter than this")
    parser.add_argument("--skip-sections", default=r"revision|history|change log|distribution|approvals?$",
                        help="regex of section titles to skip as boilerplate; empty keeps everything")
    parser.add_argument("--max-overlap", type=float, default=0.85,
                        help="drop questions reusing more than this share of the passage's words")
    parser.add_argument("--temperature", type=float, default=0.9)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--workers", type=int, default=2, help="parallel LLM calls (max 3; the server is shared)")
    args = parser.parse_args()
    if not 0 <= args.unanswerable_ratio < 0.9:
        sys.exit("--unanswerable-ratio must be between 0 and 0.9")

    rng = random.Random(args.seed)
    idx = rs.Index(args.index)
    emb = idx.embedder()
    llm = rs.Llm()
    tasks = plan_tasks(idx, args, rng)
    counts = Counter(t["kind"] for t in tasks)
    print(f"index {idx.path}: {idx.meta['n_docs']} documents, {idx.meta['n_chunks']} chunks")
    print("plan: " + ", ".join(f"{n} {k}" for k, n in counts.items()) + f" tasks, {max(1, min(args.workers, 3))} workers")

    items, drops = [], Counter()
    done = 0
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 3))) as pool:
        for made, dropped in pool.map(lambda t: run_task(idx, llm, emb, args, t), tasks):
            items += made
            drops.update(dropped)
            done += 1
            print(f"  {done}/{len(tasks)} tasks, {len(items)} questions kept", end="\r", flush=True)
    print()

    before = len(items)
    items = dedupe(items)
    if before != len(items):
        drops["near-duplicate wording"] += before - len(items)
    if not any(i["answerable"] for i in items):
        print("dropped by the checks: " + "; ".join(f"{r} ({n})" for r, n in drops.most_common()))
        sys.exit("no answerable question survived the checks. The passages may hold too few concrete facts "
                 "(numbers, form numbers, roles), or --min-words / --max-overlap are too strict.")
    items, trimmed = rebalance(items, args.unanswerable_ratio, rng)
    if trimmed:
        drops["unanswerable questions trimmed to keep the ratio"] += trimmed
    rng.shuffle(items)
    for n, item in enumerate(items, start=1):
        item["id"] = f"s{n}"

    out_dir = Path(args.out_dir)
    write_outputs(items, out_dir)

    kinds = Counter(i["kind"] for i in items)
    answerable = sum(1 for i in items if i["answerable"])
    print(f"\nkept {len(items)} questions ({answerable} answerable, {len(items) - answerable} not answerable): "
          + ", ".join(f"{k} {n}" for k, n in kinds.items()))
    if drops:
        print("dropped by the checks: " + "; ".join(f"{r} ({n})" for r, n in drops.most_common()))
    direct = [i for i in items if i["kind"] == "direct"]
    if direct:
        overlaps = [i["overlap"] for i in direct]
        print(f"wording overlap between direct questions and their passage: mean {statistics.mean(overlaps):.2f}, "
              f"{sum(1 for o in overlaps if o > 0.6)} above 0.6 (real questions usually overlap less)")
    if answerable < 20:
        print(f"WARNING: only {answerable} answerable questions survived, so percentages will be noisy. Try a higher "
              "--per-doc, a lower --min-words, or run again with another --seed and combine the CSVs.")
    print(f"\nwritten to {out_dir}: questions.synth.csv, golden.synth.jsonl, synth_review.md")
    print("Next: skim synth_review.md and drop or fix weak questions, then run")
    print(f"  python rag_spike.py eval --index {args.index} --golden {out_dir / 'golden.synth.jsonl'} --out results_synth")
    print("Remember: these results are optimistic and best used to compare settings against each other.")


if __name__ == "__main__":
    main()
