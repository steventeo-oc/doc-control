"""Clients for the three model servers (OpenAI-compatible HTTP): embeddings, reranker and the LLM.

Every failure surfaces as ModelError, so callers can degrade (skip the reranker, answer from sources only)
instead of crashing."""
from __future__ import annotations

import time

import numpy as np
import requests


class ModelError(RuntimeError):
    """A model server is unreachable, slow or answered with an error."""


def _headers(key):
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


class _Client:
    def __init__(self, base, key="", session=None, timeout=(5, 60)):
        self.base = base.rstrip("/")
        self.key = key
        self.session = session or requests.Session()
        self.timeout = timeout

    def post(self, path, payload):
        url = f"{self.base}{path}"
        try:
            resp = self.session.post(url, json=payload, headers=_headers(self.key), timeout=self.timeout)
        except requests.RequestException as exc:
            raise ModelError(f"cannot reach {url}: {exc}") from exc
        if resp.status_code >= 400:
            raise ModelError(f"HTTP {resp.status_code} from {url}: {resp.text[:300]}")
        try:
            return resp.json()
        except ValueError as exc:
            raise ModelError(f"{url} did not return JSON") from exc

    def get(self, path, timeout=(3, 5)):
        url = f"{self.base}{path}"
        try:
            resp = self.session.get(url, headers=_headers(self.key), timeout=timeout)
        except requests.RequestException as exc:
            raise ModelError(f"cannot reach {url}: {exc}") from exc
        if resp.status_code >= 400:
            raise ModelError(f"HTTP {resp.status_code} from {url}")
        return resp.json()

    def first_model(self):
        data = self.get("/models").get("data", [])
        if not data:
            raise ModelError(f"{self.base}/models lists no model")
        return data[0]["id"]

    def ping(self):
        """'ok' or the reason the server cannot be used, for the status page."""
        try:
            self.get("/models")
            return "ok"
        except (ModelError, ValueError) as exc:
            return f"error: {exc}"


class Embedder(_Client):
    def __init__(self, base, key="", model="", query_prefix="", doc_prefix="", **kw):
        super().__init__(base, key, **kw)
        self._model = model
        self.query_prefix, self.doc_prefix = query_prefix, doc_prefix

    @property
    def model(self):
        if not self._model:
            self._model = self.first_model()
        return self._model

    def _embed(self, texts, batch=32):
        vectors = []
        for start in range(0, len(texts), batch):
            part = texts[start:start + batch]
            try:
                data = self.post("/embeddings", {"model": self.model, "input": part})["data"]
            except ModelError:
                if len(part) == 1:
                    raise
                # some servers only take one string per call
                data = [self.post("/embeddings", {"model": self.model, "input": t})["data"][0] for t in part]
            data.sort(key=lambda d: d.get("index", 0))
            vectors.extend(d["embedding"] for d in data)
        arr = np.asarray(vectors, dtype=np.float32)
        return arr / np.clip(np.linalg.norm(arr, axis=1, keepdims=True), 1e-12, None)

    def docs(self, texts):
        return self._embed([self.doc_prefix + t for t in texts])

    def query(self, text):
        return self._embed([self.query_prefix + text])[0]


class Reranker(_Client):
    """A cross-encoder behind /v1/rerank (bge-reranker-v2-m3): reads the question and a passage together."""

    def __init__(self, base, key="", model="", **kw):
        super().__init__(base, key, **kw)
        self._model = model

    @property
    def model(self):
        if not self._model:
            self._model = self.first_model()
        return self._model

    def rerank(self, query, documents):
        data = self.post("/rerank", {"model": self.model, "query": query, "documents": documents,
                                     "return_documents": False})
        rows = data if isinstance(data, list) else (data.get("results") or data.get("data") or [])
        scored = [(int(r["index"]), float(r.get("score", r.get("relevance_score", 0.0)))) for r in rows]
        return sorted(scored, key=lambda x: x[1], reverse=True)


class Llm(_Client):
    def __init__(self, base, key="", model="", effort="none", timeout_s=45, **kw):
        super().__init__(base, key, timeout=(5, timeout_s), **kw)
        self.model = model
        self.effort = effort

    def chat(self, messages, max_tokens=1200, temperature=None):
        body = {"model": self.model, "messages": messages, "max_tokens": max_tokens}
        if temperature is not None:
            body["temperature"] = temperature
        if self.effort:
            body["reasoning_effort"] = self.effort
        started = time.perf_counter()
        data = self.post("/chat/completions", body)
        try:
            choice = data["choices"][0]
            message = choice.get("message") or {}
        except (KeyError, IndexError, TypeError) as exc:
            raise ModelError("unexpected chat response shape") from exc
        return {"content": message.get("content") or "",
                "reasoning": message.get("reasoning_content") or message.get("reasoning") or "",
                "finish": choice.get("finish_reason"), "usage": data.get("usage") or {},
                "seconds": time.perf_counter() - started}
