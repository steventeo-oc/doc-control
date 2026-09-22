"""The searchable index: durable in SQLite, searched from memory.

A Snapshot is immutable (a matrix of unit vectors plus a BM25 index) and is swapped in atomically after every
change, so a question in flight never sees a half-updated index."""
from __future__ import annotations

import hashlib
import threading
import time
from collections import defaultdict
from contextlib import contextmanager
from dataclasses import dataclass

import numpy as np

from .textsearch import BM25, rrf, tokenize


@dataclass(frozen=True)
class ChunkRec:
    cid: int
    version_id: str
    ord: int
    section: str
    text: str
    embed_text: str
    page_start: int | None
    page_end: int | None
    document_number: str
    name: str


class Snapshot:
    def __init__(self, chunks, vectors, versions):
        self.chunks = chunks
        self.vectors = vectors
        self.versions = versions                       # version_id -> row (dict) of the indexed versions
        self.bm25 = BM25([tokenize(c.embed_text) for c in chunks])
        self.by_version = defaultdict(list)            # version_id -> chunk positions, in reading order
        self.slot = {}                                 # chunk position -> index within its version
        for pos, chunk in enumerate(chunks):
            self.slot[pos] = len(self.by_version[chunk.version_id])
            self.by_version[chunk.version_id].append(pos)
        self.numbers = {v["document_number"].lower(): vid for vid, v in versions.items()}
        digest = hashlib.sha1("|".join(sorted(versions)).encode()).hexdigest()[:10]
        self.stamp = f"{len(versions)}v-{len(chunks)}c-{digest}"

    @property
    def empty(self):
        return not self.chunks

    @classmethod
    def blank(cls):
        return cls([], np.zeros((0, 1), dtype=np.float32), {})

    def dense(self, qvec, k):
        if self.empty:
            return []
        sims = self.vectors @ qvec
        return [(int(i), float(sims[i])) for i in np.argsort(-sims)[:k]]

    def sparse(self, tokens, k):
        return self.bm25.topk(tokens, k)

    def search(self, qvec, tokens, k_each=50, k_fused=30):
        dense, sparse = self.dense(qvec, k_each), self.sparse(tokens, k_each)
        return {"dense": dense, "sparse": sparse, "fused": rrf([dense, sparse])[:k_fused]}


class Index:
    def __init__(self, db):
        self.db = db
        self._snapshot = Snapshot.blank()
        self._batch = 0
        self._batch_lock = threading.Lock()
        self.rebuild()

    @property
    def snapshot(self):
        return self._snapshot

    @contextmanager
    def batch(self):
        """Many changes, one rebuild of the in-memory snapshot at the end."""
        with self._batch_lock:
            self._batch += 1
        try:
            yield self
        finally:
            with self._batch_lock:
                self._batch -= 1
                last = self._batch == 0
            if last:
                self.rebuild()

    def _changed(self):
        if self._batch == 0:
            self.rebuild()

    def rebuild(self):
        versions = {r["version_id"]: dict(r) for r in
                    self.db.rows("SELECT * FROM doc_version WHERE state = 'indexed'")}
        rows = self.db.rows(
            "SELECT c.id, c.version_id, c.ord, c.section, c.text, c.embed_text, c.page_start, c.page_end, "
            "c.vector, v.document_number, v.name FROM chunk c JOIN doc_version v ON v.version_id = c.version_id "
            "WHERE v.state = 'indexed' ORDER BY c.version_id, c.ord")
        chunks, vectors = [], []
        for r in rows:
            chunks.append(ChunkRec(r["id"], r["version_id"], r["ord"], r["section"] or "", r["text"],
                                   r["embed_text"], r["page_start"], r["page_end"], r["document_number"], r["name"]))
            vectors.append(np.frombuffer(r["vector"], dtype=np.float16).astype(np.float32))
        if vectors:
            matrix = np.vstack(vectors)
            matrix /= np.clip(np.linalg.norm(matrix, axis=1, keepdims=True), 1e-12, None)
        else:
            matrix = np.zeros((0, 1), dtype=np.float32)
        self._snapshot = Snapshot(chunks, matrix, versions)

    # ------------------------------------------------------------------ reading
    def versions(self):
        return {r["version_id"]: dict(r) for r in self.db.rows("SELECT * FROM doc_version")}

    def chunk_rows(self, version_id):
        return self.db.rows("SELECT ord, section, text, page_start, page_end FROM chunk WHERE version_id = ? "
                            "ORDER BY ord", (version_id,))

    def stats(self):
        by_state = {r["state"]: r["n"] for r in self.db.rows(
            "SELECT state, COUNT(*) AS n FROM doc_version GROUP BY state")}
        chunks = self.db.one("SELECT COUNT(*) AS n FROM chunk")["n"]
        return {"indexed": by_state.get("indexed", 0), "skipped": by_state.get("skipped", 0),
                "failed": by_state.get("failed", 0), "chunks": chunks}

    def problem_rows(self):
        return [dict(r) for r in self.db.rows(
            "SELECT version_id, document_number, name, state, reason, attempts, next_try_at FROM doc_version "
            "WHERE state IN ('skipped', 'failed') ORDER BY state, document_number")]

    def redaction_rows(self):
        return [dict(r) for r in self.db.rows(
            "SELECT document_number, name, redactions FROM doc_version WHERE redactions > 0 "
            "ORDER BY redactions DESC")]

    # ------------------------------------------------------------------ writing
    @staticmethod
    def _meta_params(meta):
        return (meta["version_id"], meta.get("document_id"), meta["document_number"], meta["name"],
                meta.get("type_code"), meta.get("department_code"), meta.get("version_number"),
                meta.get("effective_at"), meta.get("file_reference"))

    def add_version(self, meta, chunks, vectors, words=0, redactions=0):
        """Store an indexed version with its chunks. `vectors` holds one unit vector per chunk (float32)."""
        now = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        with self.db.tx() as conn:
            conn.execute("DELETE FROM doc_version WHERE version_id = ?", (meta["version_id"],))
            conn.execute(
                "INSERT INTO doc_version(version_id, document_id, document_number, name, type_code, "
                "department_code, version_number, effective_at, file_reference, state, words, chunks, redactions, "
                "attempts, indexed_at) VALUES (?,?,?,?,?,?,?,?,?, 'indexed', ?, ?, ?, 0, ?)",
                self._meta_params(meta) + (words, len(chunks), redactions, now))
            for ord_, (chunk, vector) in enumerate(zip(chunks, vectors)):
                conn.execute(
                    "INSERT INTO chunk(version_id, ord, section, text, embed_text, page_start, page_end, vector) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (meta["version_id"], ord_, chunk["section"], chunk["text"], chunk["embed_text"],
                     chunk.get("page_start"), chunk.get("page_end"),
                     np.asarray(vector, dtype=np.float16).tobytes()))
        self._changed()

    def set_state(self, meta, state, reason, attempts=0, next_try_at=None):
        """Record a version that is not searchable (skipped for good, or failed and to be retried)."""
        with self.db.tx() as conn:
            conn.execute("DELETE FROM doc_version WHERE version_id = ?", (meta["version_id"],))
            conn.execute(
                "INSERT INTO doc_version(version_id, document_id, document_number, name, type_code, "
                "department_code, version_number, effective_at, file_reference, state, reason, attempts, "
                "next_try_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                self._meta_params(meta) + (state, reason, attempts, next_try_at))
        self._changed()

    def remove_version(self, version_id):
        with self.db.tx() as conn:
            conn.execute("DELETE FROM doc_version WHERE version_id = ?", (version_id,))
        self._changed()

    def update_meta(self, version_id, fields):
        allowed = {"document_id", "type_code", "department_code", "version_number", "effective_at",
                   "file_reference", "document_number", "name"}
        fields = {k: v for k, v in fields.items() if k in allowed}
        if not fields:
            return
        assignments = ", ".join(f"{k} = ?" for k in fields)
        with self.db.tx() as conn:
            conn.execute(f"UPDATE doc_version SET {assignments} WHERE version_id = ?",
                         tuple(fields.values()) + (version_id,))
        self._changed()

    def replace_embeddings(self, version_id, embed_texts, vectors):
        """Re-embed a version's chunks after its header changed (a rename)."""
        rows = self.db.rows("SELECT id FROM chunk WHERE version_id = ? ORDER BY ord", (version_id,))
        with self.db.tx() as conn:
            for row, text, vector in zip(rows, embed_texts, vectors):
                conn.execute("UPDATE chunk SET embed_text = ?, vector = ? WHERE id = ?",
                             (text, np.asarray(vector, dtype=np.float16).tobytes(), row["id"]))
        self._changed()

    def reset(self):
        """Forget every version (the embedding model changed, so old vectors are not comparable)."""
        with self.db.tx() as conn:
            conn.execute("DELETE FROM doc_version")
        self._changed()

    # ------------------------------------------------------------------ sync history
    def sync_started(self):
        with self.db.tx() as conn:
            return conn.execute("INSERT INTO sync_run(started_at) VALUES (?)", (time.time(),)).lastrowid

    def sync_finished(self, run_id, added, removed, refreshed, skipped, failed, error=None):
        with self.db.tx() as conn:
            conn.execute("UPDATE sync_run SET finished_at = ?, added = ?, removed = ?, refreshed = ?, skipped = ?, "
                         "failed = ?, error = ? WHERE id = ?",
                         (time.time(), added, removed, refreshed, skipped, failed, error, run_id))

    def last_sync(self):
        row = self.db.one("SELECT * FROM sync_run WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1")
        return dict(row) if row else None



def iso_utc(ts):
    return None if ts is None else time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))
