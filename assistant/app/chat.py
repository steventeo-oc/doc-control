"""Ask the assistant questions from a terminal, against a folder of documents and the real model servers.

    python -m app.chat --docs ~/rag-spike/docs                         # type questions, an empty line quits
    python -m app.chat --docs ~/rag-spike/docs --ask "How long does the MGX test take?" --context

It is the service's own code path (extraction, credential redaction, chunking, hybrid search, reranker, neighbouring
passages, the prompt, the three answer states), so it is the quickest honest way to see what the real AI does with real
documents before anything is deployed. It changes nothing anywhere: it indexes the folder into a private working folder
(default chat-data) and prints. Document numbers come from the file names ('SOP-QA-0010 Title.docx').

Model addresses come from the ASSISTANT_* variables; it also understands the spike's LLM_API_KEY, LLM_BASE_URL,
EMB_BASE_URL and RERANK_BASE_URL, so the shell that runs the release gate runs this."""
from __future__ import annotations

import argparse
import dataclasses
import os
import sys
from pathlib import Path

from .auth import LOCAL_IDENTITY
from .config import Settings
from .gate import SPIKE_ENV, build
from .models import ModelError

STATES = {"answered": "answered", "not_found": "NOT COVERED by the documents", "unavailable": "UNAVAILABLE"}
RULE = "-" * 78


def _source_line(source):
    facts = [part for part in (source["section"], f"v{source['version']}" if source["version"] is not None else None,
                               f"effective {source['effectiveAt']}" if source["effectiveAt"] else None) if part]
    label = f"{source['label']:<3} " if source["label"] else ""        # the S-mark only means something for cited sources
    return f"  {label}{source['documentNumber']}  {source['title']}" + (f"  ({' / '.join(facts)})" if facts else "")


def render_answer(response, passages=None):
    """The answer the way the page shows it, as text: state and timing, the words, then where they came from."""
    lines = [f"[{STATES[response['state']]}]  {response['ms'] / 1000:.1f} s  |  {response['model']}  |  prompt "
             f"{response['promptVersion']}", ""]
    if response["state"] == "not_found":
        lines += ["Not covered by the current documents. What they do say:", ""]
    lines += [response["answer"].strip(), ""]
    if response["truncated"]:
        lines += ["(The answer was cut short because it was long.)", ""]
    sources = response["sources"]
    cited = [s for s in sources if s["cited"]]
    if response["state"] == "answered" and cited:
        lines += ["Sources"] + [_source_line(s) for s in cited]
        others = sorted({s["documentNumber"] for s in sources if not s["cited"]} - {s["documentNumber"] for s in cited})
        if others:
            lines.append(f"  also searched: {', '.join(others)}")
    elif sources:
        seen, closest = set(), []
        for source in sources:
            if source["documentNumber"] not in seen:
                seen.add(source["documentNumber"])
                closest.append({**source, "label": ""})
        lines += ["Closest documents"] + [_source_line(s) for s in closest[:5]]
    if passages:
        lines += ["", "Passages the model was shown", RULE]
        for passage in passages:
            where = f" / {passage['section']}" if passage["section"] else ""
            lines += [f"[{passage['label']}] {passage['document_number']}{where}", passage["text"].strip(), RULE]
    return "\n".join(lines)


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--docs", required=True, help="folder with the documents (named like 'SOP-QA-0010 Title.pdf')")
    parser.add_argument("--data", default="chat-data", help="working folder for the index (default chat-data)")
    parser.add_argument("--prompt", default=None, help="prompt version (default: the configured one)")
    parser.add_argument("--ask", action="append", default=[], metavar="QUESTION",
                        help="ask this and exit (repeat for several); without it, questions are read from the keyboard")
    parser.add_argument("--context", action="store_true", help="also print the passages the model was shown")
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
    print(f"{stats['indexed']} documents searchable, {stats['skipped']} skipped, {stats['failed']} failed, "
          f"{redactions} credential(s) replaced, in {sync.seconds:.1f} s; LLM {assistant.llm.model}")
    for problem in index.problem_rows():
        print(f"  {problem['state']}: {problem['document_number']} - {problem['reason']}")

    def ask(question):
        result = assistant.ask(question, LOCAL_IDENTITY)
        print("\n" + render_answer(result.response, result.debug["passages"] if args.context else None) + "\n", flush=True)

    if args.ask:
        for question in args.ask:
            print(f"\nQuestion: {question}")
            ask(question)
        return
    print("\nType a question and press Enter. An empty line quits.")
    while True:
        try:
            question = input("\nQuestion> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if not question:
            return
        ask(" ".join(question.split()))


if __name__ == "__main__":
    main()
