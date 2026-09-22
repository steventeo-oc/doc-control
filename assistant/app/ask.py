"""Answering one question: retrieve, select sources, ask the LLM, classify, log (plan-back 2.3).

Three visible states (F6): answered, not_found (the model said NOT_FOUND: the text is still shown, under a
banner) and unavailable (a model is down or busy; the retrieved sources are still returned)."""
from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass

from .chunking import join_overlapping
from .index import iso_utc
from .models import ModelError
from .prompts import build_user_prompt, system_prompt
from .redact import redact
from .textsearch import approx_tokens, tokenize

log = logging.getLogger("assistant.ask")

UNAVAILABLE_TEXT = ("The assistant is temporarily unavailable, so no answer could be written. "
                    "The passages below are the closest matches in the current documents.")
BUSY_TEXT = ("The assistant is busy answering other questions. Please try again in a moment. "
             "The passages below are the closest matches in the current documents.")


NOT_FOUND_MARKER = re.compile(r"^\s*NOT_FOUND\b\s*[:.\-\u2013\u2014]*\s*", re.IGNORECASE)
NOT_FOUND_TEXT = "The current documents do not answer this question."


def reader_text(state, answer):
    """What the reader sees. NOT_FOUND is the model's signal to us, not text for a person: the response drops it
    (an empty remainder becomes a plain sentence) while the query log keeps the model's raw reply."""
    if state != "not_found":
        return answer
    return NOT_FOUND_MARKER.sub("", answer, count=1).strip() or NOT_FOUND_TEXT


class IndexBuilding(Exception):
    """The index is empty (first sync still running, or nothing is released yet)."""


@dataclass
class Source:
    label: str
    version_id: str
    document_id: object
    document_number: str
    name: str
    section: str
    version_number: object
    effective_at: object
    text: str


@dataclass
class AskResult:
    response: dict        # what the HTTP API returns
    debug: dict           # what the release gate needs (never sent to a user)


def cited_labels(answer):
    labels = []
    for group in re.findall(r"\[([^\]]+)\]", answer):
        labels += [f"S{n}" for n in re.findall(r"\bS(\d+)\b", group)]
    return labels


def boost_document_numbers(snapshot, question, ranking):
    """A question that names a document number goes straight to that document."""
    q = question.lower()
    wanted = [vid for number, vid in snapshot.numbers.items() if number in q]
    if not wanted:
        return ranking
    front = [(p, s) for p, s in ranking if snapshot.chunks[p].version_id in wanted]
    for vid in wanted:
        if not any(snapshot.chunks[p].version_id == vid for p, _ in front):
            front += [(p, 0.0) for p in snapshot.by_version[vid][:3]]
    return front + [r for r in ranking if r not in front]


def select_sources(snapshot, ranking, top_chunks, neighbours, neighbour_top, overlap):
    """The top chunks become sources; the best `neighbour_top` also get their neighbours, so a step that runs
    across a chunk boundary is read whole. Windows that touch are merged into one source."""
    windows = []
    for rank, (pos, _score) in enumerate(ranking[:top_chunks]):
        chunk = snapshot.chunks[pos]
        members = snapshot.by_version[chunk.version_id]
        i = snapshot.slot[pos]
        n = neighbours if rank < neighbour_top else 0
        windows.append([rank, chunk.version_id, max(0, i - n), min(len(members) - 1, i + n)])
    merged = []
    for w in sorted(windows, key=lambda w: (w[1], w[2])):
        if merged and merged[-1][1] == w[1] and w[2] <= merged[-1][3] + 1:
            merged[-1][3] = max(merged[-1][3], w[3])
            merged[-1][0] = min(merged[-1][0], w[0])
        else:
            merged.append(list(w))
    merged.sort(key=lambda w: w[0])
    sources = []
    for _rank, version_id, lo, hi in merged:
        recs = [snapshot.chunks[p] for p in snapshot.by_version[version_id][lo:hi + 1]]
        version = snapshot.versions[version_id]
        text = join_overlapping([{"section": r.section, "text": r.text} for r in recs], overlap)
        sources.append(Source(f"S{len(sources) + 1}", version_id, version.get("document_id"),
                              version["document_number"], version["name"], recs[0].section,
                              version.get("version_number"), version.get("effective_at"), text))
    return sources


def _doc_id(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


class Assistant:
    def __init__(self, settings, index, embedder, reranker, llm, log_db, clock=time.time):
        self.s, self.index, self.embedder, self.reranker, self.llm = settings, index, embedder, reranker, llm
        self.log_db, self.clock = log_db, clock
        self._slots = threading.BoundedSemaphore(settings.max_concurrent)
        self._system = system_prompt(settings.prompt)

    # ------------------------------------------------------------------
    def ask(self, question, user, history=None, conversation_id=None):
        """`history` (Phase 1 of the saved-conversations plan-back): prior {question, answer} pairs, oldest first,
        already capped by the caller (Conversations.history) -- shown to the model so a threaded follow-up has
        context. Retrieval is unaffected: this question alone is still what gets embedded and searched, exactly as
        in a one-off ask. `conversation_id` only affects where the exchange is logged."""
        started = time.perf_counter()
        snapshot = self.index.snapshot
        if snapshot.empty:
            raise IndexBuilding()
        timings, degraded = {}, []
        history = history or []

        t = time.perf_counter()
        try:
            qvec = self.embedder.query(question)
        except ModelError as exc:
            log.warning("embedding server unavailable: %s", exc)
            return self._finish(user, question, snapshot, [], [], "unavailable", UNAVAILABLE_TEXT, started,
                                {"embed_ms": _ms(t)}, ["embedding"], {}, None, conversation_id=conversation_id)
        timings["embed_ms"] = _ms(t)

        t = time.perf_counter()
        found = snapshot.search(qvec, tokenize(question))
        ranking = found["fused"]
        timings["search_ms"] = _ms(t)

        if self.reranker is not None and ranking:
            t = time.perf_counter()
            try:
                order = self.reranker.rerank(question, [snapshot.chunks[p].embed_text for p, _ in ranking])
                ranking = [(ranking[j][0], score) for j, score in order]
            except ModelError as exc:
                degraded.append("reranker")
                log.warning("reranker unavailable, continuing without it: %s", exc)
            timings["rerank_ms"] = _ms(t)
        ranking = boost_document_numbers(snapshot, question, ranking[:10])
        ranked_docs = _unique(snapshot.chunks[p].document_number for p, _ in ranking)
        sources = select_sources(snapshot, ranking, self.s.top_chunks, self.s.neighbours, self.s.neighbour_top,
                                 self.s.overlap)
        prompt = build_user_prompt(question, sources)
        history_text = "".join(h["question"] + h["answer"] for h in history)
        debug = {"ranked_docs": ranked_docs, "history_turns": len(history),
                 "prompt_tokens_est": approx_tokens(self._system + history_text + prompt),
                 # exactly what the model was shown, for whoever is judging an answer (the terminal client's --context)
                 "passages": [{"label": s.label, "document_number": s.document_number, "section": s.section,
                               "text": s.text} for s in sources]}

        if not self._slots.acquire(timeout=self.s.queue_wait_s):
            return self._finish(user, question, snapshot, sources, [], "unavailable", BUSY_TEXT, started, timings,
                                degraded + ["llm-busy"], debug, None, conversation_id=conversation_id)
        t = time.perf_counter()
        messages = [{"role": "system", "content": self._system}]
        for turn in history:
            messages.append({"role": "user", "content": turn["question"]})
            messages.append({"role": "assistant", "content": turn["answer"]})
        messages.append({"role": "user", "content": prompt})
        try:
            reply = self.llm.chat(messages, max_tokens=self.s.max_tokens, temperature=self.s.llm_temperature)
        except ModelError as exc:
            log.warning("LLM unavailable: %s", exc)
            return self._finish(user, question, snapshot, sources, [], "unavailable", UNAVAILABLE_TEXT, started,
                                {**timings, "llm_ms": _ms(t)}, degraded + ["llm"], debug, None,
                                conversation_id=conversation_id)
        finally:
            self._slots.release()
        timings["llm_ms"] = _ms(t)

        answer = reply["content"].strip()
        if self.s.redact_secrets:
            answer, _ = redact(answer)
        if not answer:
            return self._finish(user, question, snapshot, sources, [], "unavailable", UNAVAILABLE_TEXT, started,
                                timings, degraded + ["empty-answer"], debug, reply, conversation_id=conversation_id)
        state = "not_found" if answer.upper().startswith("NOT_FOUND") else "answered"
        labels = cited_labels(answer)
        known = {s.label for s in sources}
        return self._finish(user, question, snapshot, sources, sorted(set(labels) & known), state, answer, started,
                            timings, degraded, {**debug, "bad_citations": sorted(set(labels) - known)}, reply,
                            conversation_id=conversation_id)

    # ------------------------------------------------------------------
    def _finish(self, user, question, snapshot, sources, cited, state, answer, started, timings, degraded,
                debug, reply, conversation_id=None):
        ms = int((time.perf_counter() - started) * 1000)
        source_rows = [{"label": s.label, "documentId": _doc_id(s.document_id), "documentNumber": s.document_number,
                        "title": s.name, "section": s.section, "version": s.version_number,
                        "effectiveAt": s.effective_at, "cited": s.label in cited} for s in sources]
        last = self.index.last_sync()
        log_id = self.log_db.write(user, question, answer, state, source_rows, self.llm.model, self.s.prompt,
                                   snapshot.stamp, ms, {**timings, "degraded": degraded},
                                   conversation_id=conversation_id)
        response = {"id": log_id, "state": state, "answer": reader_text(state, answer), "sources": source_rows,
                    "index": {"syncedAt": iso_utc(last["finished_at"]) if last else None,
                              "documents": len(snapshot.versions)},
                    "model": self.llm.model, "promptVersion": self.s.prompt, "ms": ms,
                    "truncated": bool(reply and reply.get("finish") == "length"),
                    "conversationId": conversation_id}
        debug = {**debug, "timings": timings, "degraded": degraded, "state": state,
                 "cited_docs": sorted({s.document_number for s in sources if s.label in cited}),
                 "usage": (reply or {}).get("usage") or {}}
        debug.setdefault("ranked_docs", [])
        debug.setdefault("bad_citations", [])
        return AskResult(response, debug)

    def models_health(self):
        return {"llm": self.llm.ping(), "embedding": self.embedder.ping(),
                "reranker": self.reranker.ping() if self.reranker is not None else "not configured"}


def _ms(t):
    return int((time.perf_counter() - t) * 1000)


def _unique(items):
    seen, out = set(), []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out
