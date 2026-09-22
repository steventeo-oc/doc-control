#!/usr/bin/env python3
"""Turn the questions QA fills in (a CSV saved from Excel) into golden.jsonl for rag_spike.py, and flag
common mistakes before they waste an evaluation run.

    python make_golden.py questions.csv --docs docs --out golden.jsonl [--verify]

Columns (header row required, other columns are ignored):
  id             optional; q1, q2, ... are assigned when empty
  question       the question worded the way a colleague would really ask it
  answerable     yes / no: do the documents answer it?
  expected_docs  document numbers that hold the answer, separated by ; (leave empty when answerable is no)
  expected_facts short literal strings that must appear in a correct answer, such as a number or a form
                 number, separated by ; (matched case-insensitively)
  kind           optional label (lookup, table, diagram, ...); eval prints a score per kind

Without --verify only the Python standard library is needed, so this runs on any PC. Nothing is written while
there are errors. --verify also reads every document with the kit's own extractors (run it where
`pip install -r requirements.txt` was done) and warns when an expected fact is not in the text of the expected
documents: a typo, or a paraphrase instead of the document's own words.
"""
import argparse
import csv
import difflib
import io
import json
import re
import sys
from pathlib import Path

DOC_NUMBER_RE = re.compile(r"\b[A-Z]{2,6}-[A-Z]{2,6}-\d{3,5}\b")
YES = {"yes", "y", "true", "t", "1"}
NO = {"no", "n", "false", "f", "0"}
DOC_TYPES = {".pdf", ".docx", ".txt", ".md"}


def read_rows(path):
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8-sig")  # Excel's "CSV UTF-8" starts with a BOM
    except UnicodeDecodeError:
        text = raw.decode("cp1252", errors="replace")  # plain Excel "CSV" on Windows
    lines = text.splitlines()
    if not lines:
        sys.exit("the file is empty")
    delimiter = max(",;\t", key=lines[0].count)  # some Excel locales save with ; instead of ,
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    reader.fieldnames = [re.sub(r"\s+", "_", (h or "").strip().lower()) for h in reader.fieldnames or []]
    if "question" not in reader.fieldnames or "answerable" not in reader.fieldnames:
        sys.exit(f"the header row must contain 'question' and 'answerable'; found {reader.fieldnames}")
    return list(reader)


def split_list(cell):
    return [part.strip() for part in re.split(r"[;|]", cell or "") if part.strip()]


def doc_names(folder):
    names = {}
    for path in sorted(p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in DOC_TYPES):
        match = DOC_NUMBER_RE.search(path.stem)
        names[(match.group(0) if match else path.stem).lower()] = path.name
    return names


def verify_facts(folder, items):
    """Warnings for expected facts that the expected documents do not contain, judged on the same chunk text
    that retrieval and the answer check use."""
    try:
        import rag_spike as rs
    except ImportError as exc:
        sys.exit(f"--verify needs the kit's packages (pip install -r requirements.txt): {exc}")
    chunks = {}
    for path in sorted(p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in rs.SUPPORTED):
        try:
            doc = rs.build_doc(path, 260, 40)
        except Exception as exc:  # a bad file must not stop the check
            print(f"  cannot read {path.name} for --verify: {exc}")
            continue
        chunks[doc["doc_number"].lower()] = [rs.source_view(doc["doc_number"], doc["title"], c) for c in doc["chunks"]]
    warnings = []
    for item in items:
        if not item["answerable"]:
            continue
        wanted = [d.lower() for d in item.get("expected_docs", []) if d.lower() in chunks] or list(chunks)
        for fact in item.get("expected_facts", []):
            needle = rs.norm(fact)
            if any(needle in c for d in wanted for c in chunks[d]):
                continue
            elsewhere = sorted(d.upper() for d, cs in chunks.items() if d not in wanted and any(needle in c for c in cs))
            where = ", ".join(d.upper() for d in wanted[:3]) if len(wanted) < len(chunks) else "any document"
            hint = (f"; it does appear in {', '.join(elsewhere[:4])}, so check expected_docs" if elsewhere
                    else "; copy the words exactly as the document has them")
            warnings.append(f"{item['id']}: expected fact '{fact}' is not in the text of {where}{hint}")
    return warnings


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv", help="the spreadsheet saved as CSV")
    parser.add_argument("--docs", help="the folder of SOPs, to check that expected_docs exist there")
    parser.add_argument("--out", default="golden.jsonl")
    parser.add_argument("--verify", action="store_true",
                        help="also check every expected fact against the text of the documents (needs --docs)")
    args = parser.parse_args()
    if args.verify and not args.docs:
        parser.error("--verify needs --docs")

    known = doc_names(Path(args.docs)) if args.docs else None
    items, errors, warnings, seen_ids, seen_questions, referenced = [], [], [], set(), {}, set()
    for line_no, row in enumerate(read_rows(Path(args.csv)), start=2):  # the header is line 1
        if not any((value or "").strip() for value in row.values() if isinstance(value, str)):
            continue  # a blank line
        question = (row.get("question") or "").strip()
        if not question:
            errors.append(f"line {line_no}: the question is empty")
            continue
        qid = (row.get("id") or "").strip() or f"q{len(items) + 1}"
        if qid in seen_ids:
            errors.append(f"line {line_no}: duplicate id '{qid}'")
            continue
        seen_ids.add(qid)
        flag = (row.get("answerable") or "").strip().lower()
        if flag not in YES | NO:
            errors.append(f"line {line_no} ({qid}): answerable must be yes or no, found '{flag}'")
            continue
        answerable = flag in YES
        docs, facts = split_list(row.get("expected_docs")), split_list(row.get("expected_facts"))

        key = " ".join(question.lower().split())
        if key in seen_questions:
            warnings.append(f"{qid}: same wording as {seen_questions[key]}")
        seen_questions[key] = qid
        if len(question) > 220:
            warnings.append(f"{qid}: very long question; is it pasted from a document instead of asked in a colleague's words?")

        item = {"id": qid, "question": question, "answerable": answerable}
        if (row.get("kind") or "").strip():
            item["kind"] = row["kind"].strip()
        if answerable:
            if not docs:
                warnings.append(f"{qid}: no expected_docs, so retrieval cannot be scored for it")
            if not facts:
                warnings.append(f"{qid}: no expected_facts, so the answer cannot be checked automatically")
            for fact in facts:
                if len(fact) > 60:
                    warnings.append(f"{qid}: expected fact '{fact[:40]}...' is long; use a short literal string such as a number or form number")
            if known is not None:
                for doc in docs:
                    if doc.lower() in known:
                        referenced.add(doc.lower())
                    else:
                        close = difflib.get_close_matches(doc.lower(), known, n=1)
                        hint = f" (did you mean {close[0].upper()}?)" if close else ""
                        warnings.append(f"{qid}: expected document '{doc}' is not in {args.docs}{hint}")
            item["expected_docs"], item["expected_facts"] = docs, facts
        elif docs or facts:
            warnings.append(f"{qid}: answerable is no, so expected_docs and expected_facts are ignored")
        items.append(item)

    if errors:
        print("Fix these first (nothing was written):")
        print("\n".join(f"  ERROR {e}" for e in errors))
        sys.exit(1)
    if not items:
        sys.exit("no questions found")

    yes = sum(1 for i in items if i["answerable"])
    no = len(items) - yes
    share = 100 * no / len(items)
    if len(items) < 30:
        warnings.append(f"only {len(items)} questions; 30-50 gives usable percentages")
    if share < 10 or share > 40:
        warnings.append(f"{share:.0f}% of the questions are not answerable; aim for roughly 20%")
    if args.verify:
        warnings += verify_facts(Path(args.docs), items)
    if known is not None:
        unused = [name for key, name in known.items() if key not in referenced]
        if unused:
            warnings.append(f"{len(unused)} of {len(known)} documents have no question yet: {', '.join(unused[:8])}"
                            + (" ..." if len(unused) > 8 else ""))

    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(json.dumps(item, ensure_ascii=False) for item in items) + "\n")
    print(f"wrote {args.out}: {len(items)} questions ({yes} answerable, {no} not answerable)")
    if warnings:
        print("Worth a look:")
        print("\n".join(f"  - {w}" for w in warnings))


if __name__ == "__main__":
    main()
