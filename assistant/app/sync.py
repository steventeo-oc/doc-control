"""Keep the index equal to what the source says is current (plan-back F4, 2.2).

The sync reads state and diffs it; it never listens for events. That is what makes it self-healing: whatever
happened to a document while the service was down, the next run converges on the source."""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from .chunking import chunk_blocks, header_for
from .extract import SUPPORTED, UnsupportedType, extract
from .models import ModelError
from .redact import redact

log = logging.getLogger("assistant.sync")
BACKOFF_SECONDS = (3600, 6 * 3600, 24 * 3600)
MIN_WORDS = 5


@dataclass
class SyncResult:
    added: int = 0
    removed: int = 0
    refreshed: int = 0
    skipped: int = 0
    failed: int = 0
    seconds: float = 0.0
    errors: list = field(default_factory=list)


class Syncer:
    def __init__(self, settings, index, source, embedder, clock=time.time):
        self.s, self.index, self.source, self.embedder, self.clock = settings, index, source, embedder, clock
        self._running = threading.Lock()

    @property
    def running(self):
        return self._running.locked()

    def run(self):
        """One reconcile pass. Returns None if another pass is already running."""
        if not self._running.acquire(blocking=False):
            return None
        started = time.perf_counter()
        run_id = self.index.sync_started()
        result, error = SyncResult(), None
        try:
            self._reconcile(result)
        except ModelError as exc:  # an outage, not a bug: one line, and the next tick tries again
            log.warning("sync skipped: %s", str(exc)[:200])
            error = f"ModelError: {exc}"[:300]
            result.errors.append(error)
        except Exception as exc:  # the loop must survive a source outage; it retries on the next tick
            log.exception("sync failed")
            error = f"{type(exc).__name__}: {exc}"[:300]
            result.errors.append(error)
        finally:
            result.seconds = time.perf_counter() - started
            self.index.sync_finished(run_id, result.added, result.removed, result.refreshed, result.skipped,
                                     result.failed, error)
            self._running.release()
        return result

    # ------------------------------------------------------------------
    def _reconcile(self, result):
        desired = {ref.version_id: ref for ref in self.source.list_versions()}
        self._check_embedding_model()
        have = self.index.versions()
        now = self.clock()
        with self.index.batch():
            for version_id in [v for v in have if v not in desired]:
                self.index.remove_version(version_id)
                result.removed += 1
            for version_id, ref in desired.items():
                row = have.get(version_id)
                if row is None:
                    self._ingest(ref, 0, result)
                elif row["state"] == "failed":
                    if (row["next_try_at"] or 0) <= now:
                        self._ingest(ref, row["attempts"], result)
                    else:
                        result.failed += 1
                elif row["state"] == "indexed":
                    self._refresh(ref, row, result)
                else:  # skipped for good; only the metadata can change
                    self.index.update_meta(version_id, ref.as_meta())
                    result.skipped += 1

    def _check_embedding_model(self):
        """Vectors from different models are not comparable: a new model means re-embedding everything."""
        try:
            current = self.embedder.model
        except ModelError as exc:
            raise ModelError(f"embedding server not available: {exc}") from exc
        stored = self.index.db.meta_get("embedding_model")
        if stored and stored != current:
            log.warning("embedding model changed from %s to %s: rebuilding the index", stored, current)
            self.index.reset()
        self.index.db.meta_set("embedding_model", current)

    def _refresh(self, ref, row, result):
        version_id = ref.version_id
        if (row["document_number"], row["name"]) != (ref.document_number, ref.name):
            # the header of every chunk changed, so re-embed (cheap) instead of serving stale vectors
            rows = self.index.chunk_rows(version_id)
            embed_texts = [f"{header_for(ref.document_number, ref.name, r['section'] or '')}\n{r['text']}"
                           for r in rows]
            try:
                vectors = self.embedder.docs(embed_texts)
            except ModelError as exc:
                log.warning("re-embedding %s failed: %s", ref.document_number, exc)
                return
            self.index.replace_embeddings(version_id, embed_texts, vectors)
            result.refreshed += 1
        self.index.update_meta(version_id, ref.as_meta())

    def _fail(self, ref, attempts, reason, result):
        delay = BACKOFF_SECONDS[min(attempts, len(BACKOFF_SECONDS) - 1)]
        self.index.set_state(ref.as_meta(), "failed", reason[:300], attempts + 1, self.clock() + delay)
        result.failed += 1
        result.errors.append(f"{ref.document_number}: {reason[:120]}")

    def _ingest(self, ref, attempts, result):
        meta = ref.as_meta()
        suffix = Path(ref.file_reference).suffix.lower()
        if suffix not in SUPPORTED:
            self.index.set_state(meta, "skipped", f"not searchable: file type {suffix or '(none)'}")
            result.skipped += 1
            return
        try:
            filename, data = self.source.fetch(ref)
        except Exception as exc:
            self._fail(ref, attempts, f"could not read the file: {exc}", result)
            return
        if len(data) > self.s.max_file_mb * 1024 * 1024:
            self.index.set_state(meta, "skipped", f"file larger than {self.s.max_file_mb} MB")
            result.skipped += 1
            return
        try:
            blocks, _pages = extract(filename, data)
        except UnsupportedType as exc:
            self.index.set_state(meta, "skipped", f"not searchable: file type {exc}")
            result.skipped += 1
            return
        except Exception as exc:
            self._fail(ref, attempts, f"extraction failed: {type(exc).__name__}: {exc}", result)
            return
        redactions = 0
        if self.s.redact_secrets:
            cleaned = []
            for kind, text, page in blocks:
                text, n = redact(text)
                redactions += n
                cleaned.append((kind, text, page))
            blocks = cleaned
        chunks = chunk_blocks(blocks, self.s.chunk_words, self.s.overlap)
        words = sum(len(text.split()) for kind, text, _ in blocks if kind == "p")
        if not chunks or words < MIN_WORDS:
            # A scan has no words at all; a short form or checklist has a few, and should not look like it needs OCR.
            reason = ("no text (a scan or image-only file?)" if words == 0
                      else f"too little text to search ({words} words)")
            self.index.set_state(meta, "skipped", reason)
            result.skipped += 1
            return
        for chunk in chunks:
            chunk["embed_text"] = (f"{header_for(ref.document_number, ref.name, chunk['section'])}\n"
                                   f"{chunk['text']}")
        try:
            vectors = self.embedder.docs([c["embed_text"] for c in chunks])
        except ModelError as exc:
            self._fail(ref, attempts, f"embedding failed: {exc}", result)
            return
        self.index.add_version(meta, chunks, vectors, words=words, redactions=redactions)
        result.added += 1


class SyncLoop:
    """Runs the sync now and then every `minutes`, on a daemon thread; `after` runs once per tick (housekeeping)."""

    def __init__(self, syncer, minutes, after=None):
        self.syncer, self.interval, self.after = syncer, max(1, minutes) * 60, after
        self._stop = threading.Event()
        self._thread = None

    def start(self):
        self._thread = threading.Thread(target=self._loop, name="assistant-sync", daemon=True)
        self._thread.start()

    def _loop(self):
        while not self._stop.is_set():
            try:
                self.syncer.run()
                if self.after:
                    self.after()
            except Exception:  # never let the thread die
                log.exception("unexpected sync loop error")
            self._stop.wait(self.interval)

    def stop(self):
        self._stop.set()
