#!/usr/bin/env python3
"""Throwaway RAG spike for the doc-control assistant. See README.md.

  smoke   probe the LLM endpoint: reasoning fields, effort dial, latency vs prompt size, concurrency
  index   extract, chunk and embed a folder of SOPs into an on-disk index (numpy, no database)
  ask     answer one question with hybrid retrieval (+ optional rerank) and the LLM
  search  learning aid: show what each retrieval method returns for one question (no LLM)
  eval    score retrieval (ablation) and, optionally, generated answers against a golden question set

Dependencies: requests, numpy, pypdf, python-docx. Secrets come from the environment only and are
never printed or accepted on the command line (a command line is visible to every user via `ps`).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import statistics
import sys
import time
import uuid
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import requests

SUPPORTED = {".pdf", ".docx", ".txt", ".md"}


# --------------------------------------------------------------------------- http

def env(name, default=None):
    value = os.environ.get(name)
    return value if value else default


class ApiError(RuntimeError):
    pass


def _headers(key):
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _check(resp, url):
    if resp.status_code >= 400:
        raise ApiError(f"HTTP {resp.status_code} from {url}: {resp.text[:300]}")


def post_json(url, payload, key=None, timeout=(10, 900)):
    resp = requests.post(url, json=payload, headers=_headers(key), timeout=timeout)
    _check(resp, url)
    return resp.json()


def get_json(url, key=None, timeout=(10, 30)):
    resp = requests.get(url, headers=_headers(key), timeout=timeout)
    _check(resp, url)
    return resp.json()


# --------------------------------------------------------------------------- model clients

class Llm:
    """OpenAI-compatible chat client (the SGLang DeepSeek endpoint)."""

    def __init__(self):
        self.base = env("LLM_BASE_URL", "http://127.0.0.1:8010/v1").rstrip("/")
        self.model = env("LLM_MODEL", "deepseek-v4.1-flash")
        self.key = env("LLM_API_KEY")
        if not self.key:
            print("note: LLM_API_KEY is not set; sending no Authorization header", file=sys.stderr)

    def payload(self, messages, max_tokens=2000, temperature=None, effort=None,
                effort_via="top", thinking=None, extra=None, stream=False):
        """effort is 'low'/'medium'/'high' or an integer; thinking True/False/None (= server default)."""
        body = {"model": self.model, "messages": messages, "max_tokens": max_tokens}
        if temperature is not None:
            body["temperature"] = temperature
        template_kwargs = {}
        if effort is not None:
            if effort_via == "kwargs":
                template_kwargs["reasoning_effort"] = effort
            else:
                body["reasoning_effort"] = effort
        if thinking is not None:
            template_kwargs["thinking"] = bool(thinking)
        if template_kwargs:
            body["chat_template_kwargs"] = template_kwargs
        body.update(extra or {})
        if stream:
            body["stream"] = True
            body["stream_options"] = {"include_usage": True}
        return body

    def chat(self, messages, **kw):
        started = time.perf_counter()
        data = post_json(f"{self.base}/chat/completions", self.payload(messages, **kw), self.key)
        choice = data["choices"][0]
        message = choice.get("message") or {}
        return {
            "content": message.get("content") or "",
            "reasoning": message.get("reasoning_content") or message.get("reasoning") or "",
            "message_keys": sorted(message.keys()),
            "finish": choice.get("finish_reason"),
            "usage": data.get("usage") or {},
            "seconds": time.perf_counter() - started,
        }

    def stream(self, messages, **kw):
        body = self.payload(messages, stream=True, **kw)
        try:
            return self._stream(body)
        except ApiError as exc:
            if "HTTP 400" in str(exc) or "HTTP 422" in str(exc):
                body.pop("stream_options", None)  # older servers reject it; usage is then unknown
                return self._stream(body)
            raise

    def _stream(self, body):
        url = f"{self.base}/chat/completions"
        started = time.perf_counter()
        first_any = first_answer = None
        answer, thinking, usage, finish = [], [], {}, None
        with requests.post(url, json=body, headers=_headers(self.key), stream=True,
                           timeout=(10, 900)) as resp:
            _check(resp, url)
            resp.encoding = "utf-8"
            for line in resp.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                event = json.loads(data)
                if event.get("usage"):
                    usage = event["usage"]
                for choice in event.get("choices") or []:
                    delta = choice.get("delta") or {}
                    now = time.perf_counter() - started
                    think = delta.get("reasoning_content") or delta.get("reasoning")
                    if think:
                        first_any = now if first_any is None else first_any
                        thinking.append(think)
                    if delta.get("content"):
                        first_any = now if first_any is None else first_any
                        first_answer = now if first_answer is None else first_answer
                        answer.append(delta["content"])
                    if choice.get("finish_reason"):
                        finish = choice["finish_reason"]
        return {"content": "".join(answer), "reasoning": "".join(thinking), "usage": usage,
                "finish": finish, "ttft_any": first_any, "ttft_answer": first_answer,
                "seconds": time.perf_counter() - started}


class Embedder:
    """OpenAI-compatible /v1/embeddings client (an SGLang --is-embedding server)."""

    def __init__(self, query_prefix="", doc_prefix=""):
        self.base = env("EMB_BASE_URL", "http://127.0.0.1:8011/v1").rstrip("/")
        self.key = env("EMB_API_KEY")
        self.model = env("EMB_MODEL") or detect_model(self.base, self.key, "EMB_MODEL")
        self.query_prefix, self.doc_prefix = query_prefix, doc_prefix

    def _embed(self, texts, batch=32, progress=False):
        vectors = []
        for start in range(0, len(texts), batch):
            part = texts[start:start + batch]
            try:
                data = post_json(f"{self.base}/embeddings", {"model": self.model, "input": part},
                                 self.key)["data"]
            except ApiError:  # some servers only take one string per call
                data = [post_json(f"{self.base}/embeddings", {"model": self.model, "input": t},
                                  self.key)["data"][0] for t in part]
            data.sort(key=lambda d: d.get("index", 0))
            vectors.extend(d["embedding"] for d in data)
            if progress and (start // batch) % 10 == 9:
                print(f"  embedded {len(vectors)}/{len(texts)}", flush=True)
        arr = np.asarray(vectors, dtype=np.float32)
        return arr / np.clip(np.linalg.norm(arr, axis=1, keepdims=True), 1e-12, None)

    def docs(self, texts):
        return self._embed([self.doc_prefix + t for t in texts], progress=True)

    def query(self, text):
        return self._embed([self.query_prefix + text])[0]


class Reranker:
    """SGLang /v1/rerank (cross-encoder such as bge-reranker-v2-m3)."""

    def __init__(self):
        self.base = env("RERANK_BASE_URL", "http://127.0.0.1:8012/v1").rstrip("/")
        self.key = env("RERANK_API_KEY")
        self.model = env("RERANK_MODEL") or detect_model(self.base, self.key, "RERANK_MODEL")

    def rerank(self, query, documents):
        data = post_json(f"{self.base}/rerank",
                         {"model": self.model, "query": query, "documents": documents,
                          "return_documents": False}, self.key)
        rows = data if isinstance(data, list) else (data.get("results") or data.get("data") or [])
        scored = [(int(r["index"]), float(r.get("score", r.get("relevance_score", 0.0)))) for r in rows]
        return sorted(scored, key=lambda x: x[1], reverse=True)


def detect_model(base, key, var):
    try:
        data = get_json(f"{base}/models", key).get("data", [])
    except (requests.RequestException, ApiError) as exc:
        sys.exit(f"cannot reach {base}/models ({exc}); is the server running? or set {var}")
    if not data:
        sys.exit(f"{base}/models lists no model; set {var}")
    return data[0]["id"]


# --------------------------------------------------------------------------- text + search

STOP = set("a an and are as at be by for from has have in is it its of on or that the to was were will with".split())
TOKEN_RE = re.compile(r"[A-Za-z0-9]+(?:[-_/.][A-Za-z0-9]+)*")
SPLIT_RE = re.compile(r"[-_/.]")
DOC_NUMBER_RE = re.compile(r"\b[A-Z]{2,6}-[A-Z]{2,6}-\d{3,5}\b")
NUM_HEADING_RE = re.compile(r"^\d+(?:\.\d+)*[.)]?\s+[A-Za-z]")


def tokenize(text):
    """Lowercase tokens; hyphenated ids (SOP-QA-0010) also contribute their parts."""
    out = []
    for match in TOKEN_RE.finditer(text.lower()):
        token = match.group(0)
        if token not in STOP:
            out.append(token)
        if SPLIT_RE.search(token):
            out.extend(p for p in SPLIT_RE.split(token) if p and p not in STOP)
    return out


def approx_tokens(text):
    return max(1, len(text) // 4)


def looks_like_heading(line):
    s = line.strip()
    words = s.split()
    if not s or len(s) > 90 or len(words) > 10 or s.endswith((".", ",", ";")):
        return False
    if NUM_HEADING_RE.match(s):
        return True
    letters = [c for c in s if c.isalpha()]
    return len(words) <= 8 and len(letters) >= 3 and s.isupper()


class BM25:
    def __init__(self, corpus, k1=1.5, b=0.75):
        self.k1, self.b, self.n = k1, b, len(corpus)
        self.lengths = [len(d) for d in corpus]
        self.avgdl = (sum(self.lengths) / self.n) if self.n else 1.0
        self.postings = defaultdict(list)
        for i, doc in enumerate(corpus):
            for term, tf in Counter(doc).items():
                self.postings[term].append((i, tf))

    def topk(self, query_tokens, k):
        scores = defaultdict(float)
        for term in set(query_tokens):
            plist = self.postings.get(term)
            if not plist:
                continue
            idf = math.log(1 + (self.n - len(plist) + 0.5) / (len(plist) + 0.5))
            for i, tf in plist:
                norm = tf + self.k1 * (1 - self.b + self.b * self.lengths[i] / self.avgdl)
                scores[i] += idf * tf * (self.k1 + 1) / norm
        return sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:k]


def rrf(rankings, k=60):
    """Reciprocal rank fusion over ranked (id, score) lists."""
    fused = defaultdict(float)
    for ranking in rankings:
        for rank, (i, _) in enumerate(ranking, start=1):
            fused[i] += 1.0 / (k + rank)
    return sorted(fused.items(), key=lambda kv: kv[1], reverse=True)


# --------------------------------------------------------------------------- extraction + chunking

def extract_pdf(path):
    import pypdf
    reader = pypdf.PdfReader(str(path))
    blocks = []
    for page_no, page in enumerate(reader.pages, start=1):
        paragraph = []
        for line in (page.extract_text() or "").splitlines():
            line = line.strip()
            if not line:
                continue
            if looks_like_heading(line):
                if paragraph:
                    blocks.append(("p", " ".join(paragraph), page_no))
                    paragraph = []
                blocks.append(("h", line, page_no))
            else:
                paragraph.append(line)
        if paragraph:
            blocks.append(("p", " ".join(paragraph), page_no))
    return blocks, len(reader.pages)


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006"


def textbox_items(element):
    """Text inside Word text boxes / shapes (flow charts are usually drawn this way; python-docx skips it).
    Word stores every box twice (DrawingML plus a VML fallback), so the fallback copy is ignored, and a box
    nested in another box is read as part of its parent."""
    box_tag, fallback_tag = f"{{{W_NS}}}txbxContent", f"{{{MC_NS}}}Fallback"
    items = []
    for box in element.iter(box_tag):
        if any(a.tag in (box_tag, fallback_tag) for a in box.iterancestors()):
            continue
        for para in box.iter(f"{{{W_NS}}}p"):
            text = " ".join("".join(t.text or "" for t in para.iter(f"{{{W_NS}}}t")).split())
            if text:
                items.append(text)
    return items


def diagram_block(element):
    items = textbox_items(element)
    return [("p", "Diagram text: " + " | ".join(items), None)] if items else []


def extract_docx(path):
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    document = docx.Document(str(path))
    blocks = []
    for child in document.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            para = Paragraph(child, document)
            text = para.text.strip()
            if text:
                style = para.style.name if para.style is not None and para.style.name else ""
                heading = style.startswith("Heading") or style == "Title" or looks_like_heading(text)
                blocks.append(("h" if heading else "p", text, None))
            blocks.extend(diagram_block(child))
        elif tag == "tbl":
            for row in Table(child, document).rows:
                seen, cells = [], []
                for cell in row.cells:
                    if any(cell._tc is s for s in seen):
                        continue  # merged cells repeat
                    seen.append(cell._tc)
                    text = " ".join(cell.text.split())
                    if text:
                        cells.append(text)
                if cells:
                    blocks.append(("p", " | ".join(cells), None))
            blocks.extend(diagram_block(child))
    return blocks, None


def extract_text_file(path):
    blocks = []
    for para in re.split(r"\n\s*\n", path.read_text(encoding="utf-8", errors="replace")):
        lines = para.strip().splitlines()
        if not lines:
            continue
        if len(lines) == 1 and (lines[0].lstrip().startswith("#") or looks_like_heading(lines[0])):
            blocks.append(("h", lines[0].lstrip("# ").strip(), None))
        else:
            blocks.append(("p", " ".join(" ".join(lines).split()), None))
    return blocks, None


def chunk_blocks(blocks, chunk_words=260, overlap=40):
    """Word-window chunks that never cross a heading; each remembers section and page span."""
    overlap = min(overlap, chunk_words - 1)
    chunks, current, section, chunk_section, fresh = [], [], "", "", 0

    def flush(keep_overlap):
        nonlocal current, fresh
        if current and fresh:
            pages = [p for _, p in current if p is not None]
            chunks.append({"section": chunk_section,
                           "page_start": min(pages) if pages else None,
                           "page_end": max(pages) if pages else None,
                           "text": " ".join(w for w, _ in current)})
        current = current[-overlap:] if keep_overlap and overlap else []
        fresh = 0

    for kind, text, page in blocks:
        if kind == "h":
            flush(False)
            section = text
            continue
        for word in text.split():
            if not current:
                chunk_section = section
            current.append((word, page))
            fresh += 1
            if len(current) >= chunk_words:
                flush(True)
    flush(False)
    return chunks


def render_full_text(blocks):
    out, last_page = [], None
    for kind, text, page in blocks:
        if page is not None and page != last_page:
            out.append(f"<<page {page}>>")
            last_page = page
        out.append(f"## {text}" if kind == "h" else text)
    return "\n".join(out)


def build_doc(path, chunk_words, overlap):
    ext = path.suffix.lower()
    if ext == ".pdf":
        blocks, pages = extract_pdf(path)
    elif ext == ".docx":
        blocks, pages = extract_docx(path)
    else:
        blocks, pages = extract_text_file(path)
    match = DOC_NUMBER_RE.search(path.stem)
    number = match.group(0) if match else path.stem
    title = path.stem.replace(number, "").strip(" -_") or path.stem
    return {"doc_id": path.stem, "doc_number": number, "title": title, "file": path.name,
            "pages": pages, "full_text": render_full_text(blocks),
            "chunks": chunk_blocks(blocks, chunk_words, overlap)}


def pages_str(chunk):
    a, b = chunk.get("page_start"), chunk.get("page_end")
    if a is None:
        return ""
    return f"p.{a}" if a == b else f"pp.{a}-{b}"


# --------------------------------------------------------------------------- index

class Index:
    def __init__(self, path):
        self.path = Path(path)
        self.meta = json.loads((self.path / "meta.json").read_text(encoding="utf-8"))
        lines = (self.path / "chunks.jsonl").read_text(encoding="utf-8").splitlines()
        self.chunks = [json.loads(line) for line in lines]
        self.vectors = np.load(self.path / "vectors.npy")
        self.docs = json.loads((self.path / "docs.json").read_text(encoding="utf-8"))
        self.bm25 = BM25([tokenize(c["embed_text"]) for c in self.chunks])
        self.number_to_doc = {d["doc_number"].lower(): k for k, d in self.docs.items()}
        self.doc_chunks = defaultdict(list)
        for i, chunk in enumerate(self.chunks):
            self.doc_chunks[chunk["doc_id"]].append(i)

    def embedder(self):
        emb = Embedder(self.meta["query_prefix"], self.meta["doc_prefix"])
        if emb.model != self.meta["embedding_model"]:
            print(f"warning: index was built with '{self.meta['embedding_model']}' but the server "
                  f"at {emb.base} serves '{emb.model}'", file=sys.stderr)
        return emb


def cmd_index(args):
    files = sorted(p for p in Path(args.docs).rglob("*") if p.is_file())
    docs, skipped, empty = {}, [], []
    for path in files:
        if path.suffix.lower() not in SUPPORTED:
            skipped.append(path.name)
            continue
        try:
            doc = build_doc(path, args.chunk_words, args.overlap)
        except Exception as exc:  # a bad file must not stop the spike
            print(f"  FAILED {path.name}: {exc}")
            continue
        if not doc["chunks"]:
            empty.append(path.name)
            continue
        docs[doc["doc_id"]] = doc
        print(f"  {doc['doc_number']:<16} {len(doc['chunks']):>4} chunks  {doc['file']}")
    if not docs:
        sys.exit("no indexable documents found")

    chunks = []
    for doc in docs.values():
        for chunk in doc.pop("chunks"):
            header = f"{doc['doc_number']} - {doc['title']}" + (f" - {chunk['section']}" if chunk["section"] else "")
            chunk.update(doc_id=doc["doc_id"], doc_number=doc["doc_number"], title=doc["title"],
                         embed_text=chunk["text"] if args.no_header else f"{header}\n{chunk['text']}")
            chunks.append(chunk)

    emb = Embedder(args.query_prefix, args.doc_prefix)
    print(f"embedding {len(chunks)} chunks with {emb.model} ...")
    started = time.perf_counter()
    vectors = emb.docs([c["embed_text"] for c in chunks])
    seconds = time.perf_counter() - started

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "chunks.jsonl").write_text("\n".join(json.dumps(c) for c in chunks), encoding="utf-8")
    (out / "docs.json").write_text(json.dumps(docs), encoding="utf-8")
    np.save(out / "vectors.npy", vectors)
    meta = {"embedding_model": emb.model, "dim": int(vectors.shape[1]),
            "query_prefix": args.query_prefix, "doc_prefix": args.doc_prefix,
            "header": not args.no_header, "chunk_words": args.chunk_words, "overlap": args.overlap,
            "n_docs": len(docs), "n_chunks": len(chunks), "embed_seconds": round(seconds, 1),
            "created": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    (out / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    avg = statistics.mean(len(c["text"].split()) for c in chunks)
    print(f"\nindexed {len(docs)} docs, {len(chunks)} chunks (avg {avg:.0f} words), dim {meta['dim']}, "
          f"{seconds:.1f}s ({len(chunks) / max(seconds, 1e-9):.1f} chunks/s) -> {out}")
    if skipped:
        print(f"skipped (unsupported type): {', '.join(skipped)}")
    if empty:
        print(f"NO EXTRACTABLE TEXT (scanned or image-only?): {', '.join(empty)}")


# --------------------------------------------------------------------------- retrieval + answering

def retrieve(idx, question, emb, reranker=None, k_each=50, k_fused=30, k_final=10):
    started = time.perf_counter()
    qvec = emb.query(question)
    t_embed = time.perf_counter() - started
    sims = idx.vectors @ qvec
    dense = [(int(i), float(sims[i])) for i in np.argsort(-sims)[:k_each]]
    sparse = idx.bm25.topk(tokenize(question), k_each)
    fused = rrf([dense, sparse])[:k_fused]
    reranked, t_rerank = None, 0.0
    if reranker is not None:
        started = time.perf_counter()
        ranked = reranker.rerank(question, [idx.chunks[i]["embed_text"] for i, _ in fused])
        reranked = [(fused[j][0], score) for j, score in ranked]
        t_rerank = time.perf_counter() - started
    final = boost_doc_number(idx, question, (reranked or fused)[:k_final])
    return {"dense": dense, "sparse": sparse, "fused": fused, "reranked": reranked,
            "final": final, "t_embed": t_embed, "t_rerank": t_rerank}


def boost_doc_number(idx, question, ranking):
    """A question that names a document number goes straight to that document."""
    q = question.lower()
    wanted = [doc_id for number, doc_id in idx.number_to_doc.items() if number in q]
    if not wanted:
        return ranking
    front = [(i, s) for i, s in ranking if idx.chunks[i]["doc_id"] in wanted]
    for doc_id in wanted:
        if not any(idx.chunks[i]["doc_id"] == doc_id for i, _ in front):
            front += [(i, 0.0) for i in idx.doc_chunks[doc_id][:3]]
    return front + [r for r in ranking if r not in front]


def rank_docs(idx, ranking):
    seen, out = set(), []
    for i, score in ranking:
        doc_id = idx.chunks[i]["doc_id"]
        if doc_id not in seen:
            seen.add(doc_id)
            out.append((doc_id, score))
    return out


def build_sources(idx, ranking, mode, top_docs, top_chunks, max_context_tokens):
    sources = []

    def add(chunk_or_doc, text, pages):
        sources.append({"label": f"S{len(sources) + 1}", "doc_id": chunk_or_doc["doc_id"],
                        "doc_number": chunk_or_doc["doc_number"], "title": chunk_or_doc["title"],
                        "section": chunk_or_doc.get("section", ""), "pages": pages, "text": text})

    if mode == "chunks":
        for i, _ in ranking[:top_chunks]:
            chunk = idx.chunks[i]
            add(chunk, chunk["text"], pages_str(chunk))
        return sources
    budget = max_context_tokens
    for doc_id, _ in rank_docs(idx, ranking)[:top_docs]:
        doc = idx.docs[doc_id]
        text = doc["full_text"]
        if approx_tokens(text) > budget:  # too big: fall back to the retrieved chunks of this doc
            picks = sorted({i for i, _ in ranking if idx.chunks[i]["doc_id"] == doc_id})
            text = "\n\n".join(idx.chunks[i]["text"] for i in picks)[: max(budget, 1) * 4]
        budget -= approx_tokens(text)
        add(doc, text, "whole document")
        if budget <= 0:
            break
    return sources


PROMPT_HEAD = (
    "You are the Document Control assistant for a manufacturing company (ISO 9001). Answer the user's "
    "question using ONLY the numbered SOURCES provided; they are the current, approved versions of the "
    "company's controlled documents.\n\n"
    "Rules:\n"
    "1. Never use outside knowledge, general industry practice or assumptions, even when you know the "
    "usual answer. If a detail is not in the SOURCES, say it is not stated.\n"
)
# Rule 2 is the only difference between the two grounded prompts. `strict` was the first spike baseline: it
# answered every question that was not covered with NOT_FOUND, but it also put NOT_FOUND on some replies that
# contained the right answer (over-cautious readings such as "not for a finished rack" or "no general rule").
# `partial` reserves NOT_FOUND for questions whose main point is not answered and asks for a final
# "Not stated in the SOURCES:" line when only a detail is missing.
RULE_2 = {
    "strict": ("2. If the SOURCES do not answer the question, begin your reply with NOT_FOUND: and say briefly "
               "what the SOURCES do cover.\n"),
    "partial": ("2. If the SOURCES do not answer the question's main point, begin your reply with NOT_FOUND: and "
                "say briefly what the SOURCES do cover; related material that does not answer the question does "
                "not count. If the SOURCES do answer the main point, answer it even when the wording differs "
                "or a minor detail is missing, and end with a line starting 'Not stated in the SOURCES:' that "
                "names what is missing. Never begin with NOT_FOUND when your reply contains the answer.\n"),
}
PROMPT_TAIL = (
    "3. Cite every factual statement with its source label in square brackets, for example [S2]. Give "
    "document numbers, intervals, limits and form numbers exactly as written.\n"
    "4. If sources conflict, say so and cite both.\n"
    "5. Be concise. Use a short numbered list for procedural steps."
)
SYSTEM_PROMPT = PROMPT_HEAD + RULE_2["strict"] + PROMPT_TAIL
SYSTEM_PROMPT_PARTIAL = PROMPT_HEAD + RULE_2["partial"] + PROMPT_TAIL

# Deliberately weak prompt for the "ask --prompt loose" learning experiment: no grounding rules at all.
SYSTEM_PROMPT_LOOSE = ("You are a helpful assistant. Use the SOURCES below if they help, and cite them like [S1] "
                       "when you do.")


def build_prompt(question, sources):
    parts = ["SOURCES"]
    for s in sources:
        head = f"[{s['label']}] {s['doc_number']} - {s['title']}"
        head += f" - {s['section']}" if s.get("section") else ""
        head += f" - {s['pages']}" if s.get("pages") else ""
        parts.append(f"{head}\n{s['text']}")
    parts.append(f"QUESTION\n{question}")
    return "\n\n".join(parts)


def cited_labels(answer):
    labels = []
    for group in re.findall(r"\[([^\]]+)\]", answer):
        labels += [f"S{n}" for n in re.findall(r"\bS(\d+)\b", group)]
    return labels


THINKING_FLAGS = {"on": True, "off": False}


def parse_effort(value):
    """'low'/'medium'/'high' stay strings; anything numeric becomes an int."""
    try:
        return int(value)
    except ValueError:
        return value


def answer_question(idx, question, emb, reranker, llm, opts):
    found = retrieve(idx, question, emb, reranker)
    sources = build_sources(idx, found["final"], opts.mode, opts.top_docs, opts.top_chunks,
                            opts.max_context_tokens)
    prompt = build_prompt(question, sources)
    system = {"strict": SYSTEM_PROMPT, "partial": SYSTEM_PROMPT_PARTIAL,
              "loose": SYSTEM_PROMPT_LOOSE}[getattr(opts, "prompt", "strict")]
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    reply = llm.chat(messages, max_tokens=opts.max_tokens, temperature=opts.temperature,
                     effort=opts.effort, effort_via=opts.effort_via,
                     thinking=THINKING_FLAGS.get(opts.thinking))
    labels = cited_labels(reply["content"])
    known = {s["label"] for s in sources}
    return {"question": question, "answer": reply["content"].strip(), "sources": sources,
            "prompt": prompt, "cited": sorted(set(labels) & known),
            "bad_citations": sorted(set(labels) - known),
            "abstained": reply["content"].lstrip().upper().startswith("NOT_FOUND"),
            "reasoning_chars": len(reply["reasoning"]), "usage": reply["usage"],
            "finish": reply["finish"], "seconds": reply["seconds"], "retrieval": found}


def cmd_ask(args):
    idx = Index(args.index)
    emb = idx.embedder()
    reranker = Reranker() if args.rerank else None
    result = answer_question(idx, args.question, emb, reranker, Llm(), args)
    if args.show_context:
        print(result["prompt"], "\n" + "=" * 70)
    print(result["answer"], "\n")
    print(f"sources ({args.mode} mode):")
    for s in result["sources"]:
        mark = "*" if s["label"] in result["cited"] else " "
        detail = " - ".join(p for p in (f"{s['doc_number']} - {s['title']}", s["section"], s["pages"]) if p)
        print(f" {mark}[{s['label']}] {detail}")
    usage = result["usage"]
    print(f"\n(* = cited) finish={result['finish']} prompt_tokens={usage.get('prompt_tokens', '?')} "
          f"completion_tokens={usage.get('completion_tokens', '?')} reasoning_chars={result['reasoning_chars']} "
          f"{result['seconds']:.1f}s")
    if result["bad_citations"]:
        print(f"WARNING: cites labels that were not provided: {result['bad_citations']}")


def cmd_search(args):
    """Learning aid: show what each retrieval method returns for one question, so you can see how they differ."""
    idx = Index(args.index)
    emb = idx.embedder()
    reranker = Reranker() if args.rerank else None
    found = retrieve(idx, args.question, emb, reranker)
    print(f"question: {args.question}")
    print("(a score only means something inside its own method: cosine similarity, BM25 score, fused rank "
          "score, reranker score)\n")
    for name, ranking in retrieval_configs(found).items():
        print(f"{name}:")
        for rank, (i, score) in enumerate(ranking[: args.top], start=1):
            chunk = idx.chunks[i]
            where = " - ".join(p for p in (chunk["doc_number"], chunk["section"], pages_str(chunk)) if p)
            print(f"  {rank}. {score:8.3f}  {where}")
            print(f"       {' '.join(chunk['text'].split())[: args.width]}")
        print()


# --------------------------------------------------------------------------- eval

def norm(text):
    return " ".join(text.lower().split())


def doc_ids_for(idx, names):
    wanted = {n.lower() for n in names}
    return {k for k, d in idx.docs.items() if k.lower() in wanted or d["doc_number"].lower() in wanted}


def first_doc_rank(idx, ranking, wanted):
    for rank, (doc_id, _) in enumerate(rank_docs(idx, ranking), start=1):
        if doc_id in wanted:
            return rank
    return None


def source_view(doc_number, title, chunk):
    """What the model is shown for one chunk: the header (number, title, section) plus the text. A question
    such as 'what is the document number of the firmware SOP?' is answered from the header."""
    return norm(f"{doc_number} {title} {chunk.get('section', '')} {chunk['text']}")


def fact_hit(idx, ranking, facts, k):
    if not facts:
        return None
    text = " ".join(source_view(idx.chunks[i]["doc_number"], idx.chunks[i]["title"], idx.chunks[i])
                    for i, _ in ranking[:k])
    return any(norm(f) in text for f in facts)


def retrieval_configs(found):
    configs = {"dense only": found["dense"], "bm25 only": found["sparse"], "hybrid (rrf)": found["fused"]}
    if found["reranked"] is not None:
        configs["hybrid + rerank"] = found["reranked"]
    configs["final (what ask uses)"] = found["final"]
    return configs


def pct(values):
    values = [v for v in values if v is not None]
    return f"{100 * sum(values) / len(values):.0f}% ({sum(values)}/{len(values)})" if values else "n/a"


def judge(llm, question, sources_prompt, answer, facts, effort, effort_via="top"):
    prompt = ("You are grading an assistant's answer against the source excerpts it was given.\n\n"
              f"{sources_prompt}\n\nREFERENCE FACTS (may be empty): {json.dumps(facts)}\n\n"
              f"ANSWER\n{answer}\n\n"
              "Return JSON only: {\"faithful\": true|false, \"unsupported_claims\": [\"...\"], "
              "\"correct\": true|false|null, \"reason\": \"...\"}\n"
              "faithful = every factual claim in ANSWER is supported by the SOURCES (an answer that begins "
              "with NOT_FOUND is faithful). correct = ANSWER states the reference facts (null if none given; "
              "false if the answer is NOT_FOUND but facts were given).")
    reply = llm.chat([{"role": "user", "content": prompt}], max_tokens=3000, effort=effort,
                     effort_via=effort_via)
    match = re.search(r"\{.*\}", reply["content"], re.S)
    try:
        return json.loads(match.group(0)) if match else {"faithful": None, "correct": None, "reason": "unparseable"}
    except json.JSONDecodeError:
        return {"faithful": None, "correct": None, "reason": "unparseable"}


def cmd_eval(args):
    idx = Index(args.index)
    emb = idx.embedder()
    reranker = Reranker() if args.rerank else None
    items = [json.loads(l) for l in Path(args.golden).read_text(encoding="utf-8").splitlines() if l.strip()]
    if args.limit:
        items = items[: args.limit]
    llm = Llm() if args.generate else None
    out_dir = Path(args.out or f"results_{idx.path.name}")
    out_dir.mkdir(parents=True, exist_ok=True)

    retr = defaultdict(lambda: defaultdict(list))
    rows, failures, t_ret = [], [], []
    for n, item in enumerate(items, start=1):
        started = time.perf_counter()
        found = retrieve(idx, item["question"], emb, reranker)
        t_ret.append(time.perf_counter() - started)
        wanted = doc_ids_for(idx, item.get("expected_docs", []))
        row = {"id": item["id"], "question": item["question"], "answerable": item.get("answerable", True),
               "kind": item.get("kind")}
        if row["answerable"]:
            facts = item.get("expected_facts", [])
            for name, ranking in retrieval_configs(found).items():
                rank = first_doc_rank(idx, ranking, wanted)
                retr[name]["hit1"].append(rank is not None and rank <= 1)
                retr[name]["hit3"].append(rank is not None and rank <= 3)
                retr[name]["hit5"].append(rank is not None and rank <= 5)
                retr[name]["rr"].append(1 / rank if rank and rank <= 10 else 0.0)
                retr[name]["fact5"].append(fact_hit(idx, ranking, facts, 5))
                retr[name]["fact10"].append(fact_hit(idx, ranking, facts, 10))
            final_rank = first_doc_rank(idx, found["final"], wanted)
            row["final_rank"] = final_rank
            if final_rank is None or final_rank > 5:
                failures.append(f"{item['id']}: retrieval miss (expected {sorted(wanted) or item.get('expected_docs')}, "
                                f"got {[d for d, _ in rank_docs(idx, found['final'])[:3]]})")
        rows.append((item, found, row))
        print(f"  retrieved {n}/{len(items)}", end="\r", flush=True)
    print()

    gen = defaultdict(list)
    if args.generate:
        def run(entry):
            item, found, row = entry
            try:
                result = answer_question(idx, item["question"], emb, reranker, llm, args)
                row.update(answer=result["answer"], cited=result["cited"], bad_citations=result["bad_citations"],
                           abstained=result["abstained"], seconds=result["seconds"], usage=result["usage"],
                           reasoning_chars=result["reasoning_chars"], finish=result["finish"],
                           sources=[f"{s['label']} {s['doc_number']}" for s in result["sources"]])
                if args.judge:
                    row["judge"] = judge(llm, item["question"], result["prompt"], result["answer"],
                                         item.get("expected_facts", []), args.judge_effort, args.effort_via)
            except (ApiError, requests.RequestException) as exc:  # one bad call must not lose the whole run
                row.update(error=str(exc)[:200], answer="", cited=[], bad_citations=[], abstained=False,
                           seconds=0.0, usage={}, reasoning_chars=0, finish="error", sources=[])
                return entry, None
            return entry, result

        with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 3))) as pool:
            for k, (entry, result) in enumerate(pool.map(run, rows), start=1):
                print(f"  answered {k}/{len(rows)}", end="\r", flush=True)
                item, _, row = entry
                qid = item["id"]
                if result is None:
                    failures.append(f"{qid}: LLM call failed: {row['error']}")
                    continue
                usage = row["usage"]
                gen["seconds"].append(row["seconds"])
                gen["prompt_tokens"].append(usage.get("prompt_tokens") or 0)
                gen["completion_tokens"].append(usage.get("completion_tokens") or 0)
                gen["bad_citation"].append(bool(row["bad_citations"]))
                verdict = row.get("judge") or {}
                if row["bad_citations"]:
                    failures.append(f"{qid}: cites labels that were not provided {row['bad_citations']}")
                if row["finish"] == "length":
                    failures.append(f"{qid}: hit max_tokens before finishing (raise --max-tokens or lower --effort)")
                if verdict.get("faithful") is False:
                    failures.append(f"{qid}: judge says unfaithful: {verdict.get('unsupported_claims')}")
                if row["answerable"]:
                    wanted = doc_ids_for(idx, item.get("expected_docs", []))
                    cited_docs = {s["doc_id"] for s in result["sources"] if s["label"] in row["cited"]}
                    facts = item.get("expected_facts", [])
                    facts_ok = all(norm(f) in norm(row["answer"]) for f in facts) if facts else None
                    row["facts_ok"] = facts_ok
                    row["cited_expected"] = bool(cited_docs & wanted) if wanted else None
                    gen["answered"].append(not row["abstained"])
                    gen["cited_expected"].append(row["cited_expected"])
                    gen["facts_all"].append(facts_ok)
                    if "judge" in row:
                        gen["faithful"].append(verdict.get("faithful"))
                        gen["correct"].append(verdict.get("correct"))
                    if row["abstained"]:
                        failures.append(f"{qid}: abstained on an answerable question")
                    elif facts_ok is False:
                        failures.append(f"{qid}: answer lacks expected fact(s) {facts}")
                else:
                    gen["abstained_unanswerable"].append(row["abstained"])
                    if not row["abstained"]:
                        failures.append(f"{qid}: answered a question the documents do not cover "
                                        f"(possible outside-knowledge answer): {row['answer'][:120]!r}")
        print()

    report = render_report(idx, items, retr, gen, t_ret, failures, args, [row for _, _, row in rows])
    (out_dir / "report.md").write_text(report, encoding="utf-8")
    with (out_dir / "results.jsonl").open("w", encoding="utf-8") as fh:
        for _, _, row in rows:
            fh.write(json.dumps(row) + "\n")
    print(report)
    print(f"\nwritten: {out_dir / 'report.md'} and results.jsonl")


def md_table(headers, rows):
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    lines += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(lines)


def kind_table(rows, generated):
    """Scores per question kind (a `kind` field in golden.jsonl), so a weak spot such as diagrams, tables or
    near-identical documents shows up instead of hiding inside one overall percentage."""
    groups = defaultdict(list)
    for row in rows:
        if row.get("kind"):
            groups[row["kind"]].append(row)
    if not groups:
        return []
    headers = ["kind", "n", "doc hit@5 (final)"]
    if generated:
        headers += ["handled (answered / abstained as it should)", "cited an expected doc", "facts in answer"]
    table = []
    for kind, group in sorted(groups.items()):
        answerable = [r for r in group if r["answerable"]]
        line = [kind, len(group), pct([r["final_rank"] is not None and r["final_rank"] <= 5 for r in answerable])]
        if generated:
            done = [r for r in group if "abstained" in r and not r.get("error")]
            line += [pct([r["abstained"] != r["answerable"] for r in done]),
                     pct([r.get("cited_expected") for r in answerable]),
                     pct([r.get("facts_ok") for r in answerable])]
        table.append(line)
    return ["", "## By question kind (small groups: read them as hints, not as percentages to quote)", "",
            md_table(headers, table)]


def render_report(idx, items, retr, gen, t_ret, failures, args, rows_by_question=None):
    answerable = sum(1 for i in items if i.get("answerable", True))
    meta = idx.meta
    out = [f"# RAG spike report - {idx.path.name}", "",
           f"Embedding model: `{meta['embedding_model']}` (dim {meta['dim']}, header={'on' if meta['header'] else 'off'}, "
           f"chunk {meta['chunk_words']}w/overlap {meta['overlap']}) - {meta['n_docs']} docs, {meta['n_chunks']} chunks, "
           f"embedded in {meta['embed_seconds']}s",
           f"Questions: {len(items)} ({answerable} answerable, {len(items) - answerable} not in the documents)",
           f"Retrieval time per question: median {statistics.median(t_ret) * 1000:.0f} ms", "",
           "## Retrieval (answerable questions; doc hit = an expected document is in the top-k documents; "
           "fact hit = an expected fact string appears in the top-k chunks)", ""]
    rows = []
    for name, m in retr.items():
        rows.append((name, pct(m["hit1"]), pct(m["hit3"]), pct(m["hit5"]),
                     f"{statistics.mean(m['rr']):.2f}" if m["rr"] else "n/a", pct(m["fact5"]), pct(m["fact10"])))
    out.append(md_table(["config", "doc hit@1", "doc hit@3", "doc hit@5", "MRR@10", "fact hit@5", "fact hit@10"], rows))
    if gen:
        default = "server default"
        out += ["", f"## Generation (mode={args.mode}, prompt={args.prompt}, "
                f"effort={args.effort if args.effort is not None else default}"
                f" via {args.effort_via}, thinking={args.thinking or default}, "
                f"temperature={args.temperature if args.temperature is not None else default})", ""]
        rows = [("answered (did not abstain), answerable", pct(gen["answered"])),
                ("cited an expected document", pct(gen["cited_expected"])),
                ("all expected facts present in the answer text", pct(gen["facts_all"]))]
        if gen["faithful"] or gen["correct"]:
            rows += [("judge: faithful to sources, answerable", pct(gen["faithful"])),
                     ("judge: correct vs expected facts", pct(gen["correct"]))]
        rows += [("abstained (NOT_FOUND) on not-in-documents questions", pct(gen["abstained_unanswerable"])),
                 ("citations to labels that were not provided", pct(gen["bad_citation"])),
                 ("latency p50 / p95 (s)", f"{statistics.median(gen['seconds']):.1f} / "
                  f"{sorted(gen['seconds'])[max(0, int(len(gen['seconds']) * 0.95) - 1)]:.1f}"),
                 ("avg prompt / completion tokens", f"{statistics.mean(gen['prompt_tokens']):.0f} / "
                  f"{statistics.mean(gen['completion_tokens']):.0f}")]
        out.append(md_table(["metric", "value"], rows))
    out += kind_table(rows_by_question or [], bool(gen))
    out += ["", "## Failures to look at", ""]
    out += [f"- {f}" for f in failures] or ["- none"]
    return "\n".join(out)


# --------------------------------------------------------------------------- smoke

FILLER = [
    "Operators shall record the inspection result on form F-{f:02d} and retain it for {m} years.",
    "Any deviation from work instruction WI-{n:03d} must be reported to the shift supervisor before production resumes.",
    "Material received under batch {n:03d} shall be quarantined until incoming inspection is complete.",
    "Torque settings for fastener class {m} are verified at the start of every shift using the calibrated driver.",
    "The line lead confirms ESD wrist strap continuity at station {f:02d} before boards are handled.",
]
NEEDLE = "The calibration interval for gauge type G-77 is 9 months."


def long_prompt(target_tokens):
    """About target_tokens of SOP-like filler with one needle sentence in the middle; unique per call
    so the server's prefix cache cannot make the timing look better than it is."""
    count = int(target_tokens * 4 / 95) + 1
    sentences = [f"{i + 1}. " + FILLER[i % len(FILLER)].format(n=(i * 7) % 997, m=3 + i % 5, f=(i * 13) % 41)
                 for i in range(count)]
    sentences.insert(len(sentences) // 2, NEEDLE)
    return (f"[run {uuid.uuid4().hex[:12]}]\n" + " ".join(sentences) +
            "\n\nQuestion: According to the text, what is the calibration interval for gauge type G-77? "
            "Answer with the number of months only.")


def cmd_smoke(args):
    llm = Llm()
    print(f"endpoint {llm.base}  model {llm.model}")
    models = [m.get("id") for m in get_json(f"{llm.base}/models", llm.key).get("data", [])]
    print(f"served models: {models}")
    if llm.model not in models:
        print(f"WARNING: LLM_MODEL '{llm.model}' is not in that list; set LLM_MODEL")

    print("\n[1] basic call")
    reply = llm.chat([{"role": "user", "content": "Reply with the single word: pong"}], max_tokens=args.max_tokens)
    print(f"  message fields: {reply['message_keys']}  finish: {reply['finish']}  usage: {reply['usage']}  {reply['seconds']:.1f}s")
    print(f"  content: {reply['content'][:120]!r}")
    print(f"  reasoning_content present: {bool(reply['reasoning'])} ({len(reply['reasoning'])} chars)")
    if "<think>" in reply["content"] or "</think>" in reply["content"]:
        print("  WARNING: thinking markup is leaking into content (is --reasoning-parser active?)")

    print(f"\n[2] how is thinking controlled? (same question, {args.repeats} runs per setting, averaged; "
          "judge by the reasoning columns, not the token totals, which vary from run to run)")
    variants = [("default", "no setting (server default)", {})]
    variants += [("top-int", f"top-level reasoning_effort={e}", dict(effort=e, effort_via="top"))
                 for e in args.efforts]
    variants += [("top-str", f"top-level reasoning_effort='{e}'", dict(effort=e, effort_via="top"))
                 for e in ("low", "medium", "high")]
    variants += [("kwargs-int", f"chat_template_kwargs reasoning_effort={e}", dict(effort=e, effort_via="kwargs"))
                 for e in args.efforts]
    variants += [("kwargs-think", f"chat_template_kwargs thinking=true, reasoning_effort={e}",
                  dict(effort=e, effort_via="kwargs", thinking=True)) for e in args.efforts]
    variants += [("thinking-on", "chat_template_kwargs thinking=true", dict(thinking=True)),
                 ("thinking-off", "chat_template_kwargs thinking=false", dict(thinking=False)),
                 ("thinking-off", "chat_template_kwargs enable_thinking=false",
                  dict(extra={"chat_template_kwargs": {"enable_thinking": False}}))]
    rows, thinks, errors, by_label = [], defaultdict(list), [], {}
    for group, label, kw in variants:
        runs, error = [], None
        for _ in range(args.repeats):
            try:
                runs.append(llm.chat([{"role": "user", "content": PROBE}], max_tokens=4096, **kw))
            except (ApiError, requests.RequestException) as exc:
                error = str(exc)
                break
        if error:
            thinks[group].append(None)
            errors.append(f"{label}: {error[:300]}")
            rows.append((label, "error", "", "", "", "", "", ""))
            continue
        think_chars = average(runs, lambda r: len(r["reasoning"]))
        thinks[group].append(think_chars)
        by_label[label] = think_chars
        rows.append((label, f"{average(runs, lambda r: r['usage'].get('completion_tokens') or 0):.0f}",
                     f"{average(runs, lambda r: r['usage'].get('reasoning_tokens') or 0):.0f}",
                     f"{think_chars:.0f}", f"{average(runs, lambda r: len(r['content'])):.0f}",
                     f"{average(runs, lambda r: r['seconds']):.1f}", runs[0]["finish"],
                     runs[0]["content"].strip().replace("\n", " ")[:50]))
    print_table(["setting", "completion tok", "reasoning tok", "reasoning chars", "answer chars", "sec",
                 "finish", "answer (first run)"], rows)
    for line in errors:
        print(f"  error - {line}")

    def switches_on(group):
        values = thinks.get(group)
        return bool(values) and None not in values and all(v > 0 for v in values)

    default_thinks = bool(thinks["default"]) and (thinks["default"][0] or 0) > 0
    print(f"  -> with no setting the server {'THINKS' if default_thinks else 'does not think'} "
          "(the expected answer is 46 units in total, with the 640-unit lot on the 20-unit sample)")
    think_runs = []
    verb = "controlled by" if default_thinks else "switched on by"
    if switches_on("top-str"):
        print(f"  -> thinking is {verb} the top-level string levels: use --effort-via top --effort low|medium|high")
        think_runs = [("effort 'low'", dict(effort="low", effort_via="top")),
                      ("effort 'high'", dict(effort="high", effort_via="top"))]
    elif switches_on("kwargs-think"):
        lo, hi = min(args.efforts), max(args.efforts)
        print(f"  -> thinking is {verb} chat_template_kwargs thinking=true + reasoning_effort: "
              "use --effort-via kwargs --thinking on --effort <1-100>")
        think_runs = [(f"thinking, effort {lo}", dict(effort=lo, effort_via="kwargs", thinking=True)),
                      (f"thinking, effort {hi}", dict(effort=hi, effort_via="kwargs", thinking=True))]
    elif switches_on("top-int"):
        lo, hi = min(args.efforts), max(args.efforts)
        print(f"  -> thinking is {verb} top-level integer efforts: use --effort-via top --effort <1-100>")
        think_runs = [(f"effort {lo}", dict(effort=lo, effort_via="top")), (f"effort {hi}", dict(effort=hi, effort_via="top"))]
    elif switches_on("thinking-on"):
        print(f"  -> thinking is {verb} chat_template_kwargs thinking=true: use --thinking on")
        think_runs = [("thinking on", dict(thinking=True))]
    else:
        print("  -> no setting produced reasoning; ask the server owner how thinking is exposed")
    if default_thinks and by_label.get("chat_template_kwargs thinking=false") == 0:
        print("  -> thinking can be turned off with --thinking off")

    print("\n[3] time to first token vs prompt size (streamed, server default settings)")
    rows = []
    for target in args.lengths:
        try:
            r = llm.stream([{"role": "user", "content": long_prompt(target)}], max_tokens=1500)
            ok = bool(re.search(r"\b9\b", r["content"]))
            rows.append((target, r["usage"].get("prompt_tokens", "?"), fmt(r["ttft_any"]), fmt(r["ttft_answer"]),
                         f"{r['seconds']:.1f}", r["content"].strip()[:20], "yes" if ok else "NO"))
        except (ApiError, requests.RequestException) as exc:
            rows.append((target, "error", "", "", "", str(exc)[:40], ""))
    print_table(["target tok", "prompt tok", "first token s", "first answer s", "total s", "answer", "needle found"], rows)

    print("\n[3b] what thinking costs on a ~10k-token prompt (same needle question)")
    rows = []
    for label, kw in [("server default", {})] + think_runs:
        try:
            r = llm.stream([{"role": "user", "content": long_prompt(10000)}], max_tokens=3000, **kw)
            ok = bool(re.search(r"\b9\b", r["content"]))
            rows.append((label, r["usage"].get("reasoning_tokens", "?"), len(r["reasoning"]), fmt(r["ttft_any"]),
                         fmt(r["ttft_answer"]), f"{r['seconds']:.1f}", "yes" if ok else "NO"))
        except (ApiError, requests.RequestException) as exc:
            rows.append((label, "error", "", "", "", str(exc)[:40], ""))
    print_table(["setting", "reasoning tok", "reasoning chars", "first token s", "first answer s", "total s",
                 "needle found"], rows)

    if args.parallel > 1:
        print(f"\n[4] {args.parallel} simultaneous ~8k-token requests (the server allows 8 running at once)")
        def one(_):
            r = llm.stream([{"role": "user", "content": long_prompt(8000)}], max_tokens=1500)
            return r["seconds"], r["ttft_answer"]
        started = time.perf_counter()
        with ThreadPoolExecutor(max_workers=args.parallel) as pool:
            results = list(pool.map(one, range(args.parallel)))
        print(f"  wall {time.perf_counter() - started:.1f}s; per-request seconds "
              f"{[round(s, 1) for s, _ in results]}; first-answer {[fmt(t) for _, t in results]}")


def fmt(value):
    return "n/a" if value is None else f"{value:.1f}"


def average(runs, fn):
    return statistics.mean(fn(r) for r in runs)


PROBE = ("Incoming lots are sampled by lot size: lots up to 500 units take a 13-unit sample and lots above 500 "
         "units take a 20-unit sample. Three lots arrive with 320, 640 and 500 units. How many units are sampled "
         "in total, and which lot uses the 20-unit sample? Answer in one or two sentences.")


def print_table(headers, rows):
    widths = [max(len(str(x)) for x in col) for col in zip(headers, *rows)]
    def line(row):
        return "  " + "  ".join(str(x).ljust(w) for x, w in zip(row, widths))
    print(line(headers))
    print(line(["-" * w for w in widths]))
    for row in rows:
        print(line(row))


# --------------------------------------------------------------------------- main

def add_llm_options(p):
    p.add_argument("--mode", choices=["docs", "chunks"], default="docs",
                   help="docs: give the model whole top documents; chunks: only the top chunks")
    p.add_argument("--top-docs", type=int, default=3)
    p.add_argument("--top-chunks", type=int, default=8)
    p.add_argument("--max-context-tokens", type=int, default=40000)
    p.add_argument("--max-tokens", type=int, default=6000, help="cap on generated tokens, reasoning included")
    p.add_argument("--effort", type=parse_effort, default=None,
                   help="reasoning effort: low, medium, high or a number (default: server default = see smoke)")
    p.add_argument("--effort-via", choices=["top", "kwargs"], default="top",
                   help="send the effort as top-level reasoning_effort, or inside chat_template_kwargs (see smoke)")
    p.add_argument("--thinking", choices=["on", "off"], default=None,
                   help="force thinking on or off via chat_template_kwargs (default: server default)")
    p.add_argument("--temperature", type=float, default=None)
    p.add_argument("--rerank", action="store_true", help="rerank the fused candidates with the reranker server")
    p.add_argument("--prompt", choices=["strict", "partial", "loose"], default="strict",
                   help="strict: NOT_FOUND unless the sources answer (baseline); partial: NOT_FOUND only when the "
                        "main point is unanswered, otherwise answer and list what is missing; loose: no grounding "
                        "rules at all, to show why they exist (learning experiment)")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("smoke", help="probe the LLM endpoint")
    p.add_argument("--efforts", type=lambda s: [int(x) for x in s.split(",")], default=[10, 50, 100])
    p.add_argument("--lengths", type=lambda s: [int(x) for x in s.split(",")], default=[2000, 10000, 30000, 60000])
    p.add_argument("--repeats", type=int, default=3, help="runs per setting in step [2]")
    p.add_argument("--parallel", type=int, default=3)
    p.add_argument("--max-tokens", type=int, default=200)
    p.set_defaults(func=cmd_smoke)

    p = sub.add_parser("index", help="build an index from a folder of documents")
    p.add_argument("--docs", required=True, help="folder with .pdf/.docx/.txt/.md (name files like 'SOP-QA-0010 Title.pdf')")
    p.add_argument("--out", required=True)
    p.add_argument("--query-prefix", default="", help="text put before every query (model specific)")
    p.add_argument("--doc-prefix", default="", help="text put before every chunk (model specific)")
    p.add_argument("--chunk-words", type=int, default=260)
    p.add_argument("--overlap", type=int, default=40)
    p.add_argument("--no-header", action="store_true", help="do not prefix chunks with number/title/section")
    p.set_defaults(func=cmd_index)

    p = sub.add_parser("ask", help="answer one question")
    p.add_argument("question")
    p.add_argument("--index", required=True)
    p.add_argument("--show-context", action="store_true", help="print the SOURCES + QUESTION the model receives")
    add_llm_options(p)
    p.set_defaults(func=cmd_ask)

    p = sub.add_parser("search", help="show what each retrieval method returns for one question (no LLM)")
    p.add_argument("question")
    p.add_argument("--index", required=True)
    p.add_argument("--rerank", action="store_true")
    p.add_argument("--top", type=int, default=5)
    p.add_argument("--width", type=int, default=110, help="characters of chunk text to show")
    p.set_defaults(func=cmd_search)

    p = sub.add_parser("eval", help="score retrieval and, with --generate, answers")
    p.add_argument("--index", required=True)
    p.add_argument("--golden", required=True, help="JSONL: id, question, answerable, expected_docs, expected_facts")
    p.add_argument("--out", default=None)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--generate", action="store_true", help="also call the LLM (retrieval-only otherwise)")
    p.add_argument("--judge", action="store_true", help="grade answers with the LLM (needs --generate)")
    p.add_argument("--judge-effort", type=parse_effort, default=None,
                   help="effort for the judge calls (default: server default)")
    p.add_argument("--workers", type=int, default=1, help="parallel LLM calls (max 3; the server is shared)")
    add_llm_options(p)
    p.set_defaults(func=cmd_eval)

    args = parser.parse_args()
    try:
        args.func(args)
    except (ApiError, requests.RequestException) as exc:
        sys.exit(f"error: {exc}")


if __name__ == "__main__":
    main()
