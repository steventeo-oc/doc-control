"""The service's own SQLite file (plan-back 2.5): the index, the query log and the sync history.

The index is derived data and can always be rebuilt; the query log and the feedback are not, so the data volume
belongs in the backup routine."""
from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS doc_version (
    version_id TEXT PRIMARY KEY,
    document_id TEXT, document_number TEXT NOT NULL, name TEXT NOT NULL,
    type_code TEXT, department_code TEXT, version_number INTEGER, effective_at TEXT, file_reference TEXT,
    state TEXT NOT NULL,                       -- indexed | skipped | failed
    reason TEXT, words INTEGER NOT NULL DEFAULT 0, chunks INTEGER NOT NULL DEFAULT 0,
    redactions INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
    next_try_at REAL, indexed_at TEXT
);
CREATE TABLE IF NOT EXISTS chunk (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id TEXT NOT NULL REFERENCES doc_version(version_id) ON DELETE CASCADE,
    ord INTEGER NOT NULL, section TEXT, text TEXT NOT NULL, embed_text TEXT NOT NULL,
    page_start INTEGER, page_end INTEGER,
    vector BLOB NOT NULL                       -- float16, L2-normalised
);
CREATE INDEX IF NOT EXISTS ix_chunk_version ON chunk(version_id, ord);
CREATE TABLE IF NOT EXISTS query_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at REAL NOT NULL, user_id TEXT, user_name TEXT,
    question TEXT NOT NULL, answer TEXT, state TEXT NOT NULL, sources TEXT,
    model TEXT, prompt_version TEXT, index_snapshot TEXT, ms INTEGER, timings TEXT,
    rating TEXT, comment TEXT
);
CREATE INDEX IF NOT EXISTS ix_query_log_user_at ON query_log(user_id, at);
CREATE TABLE IF NOT EXISTS sync_run (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at REAL NOT NULL, finished_at REAL,
    added INTEGER DEFAULT 0, removed INTEGER DEFAULT 0, refreshed INTEGER DEFAULT 0,
    skipped INTEGER DEFAULT 0, failed INTEGER DEFAULT 0, error TEXT
);
"""


class Database:
    def __init__(self, path):
        self.path = str(path)
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        with self.lock:
            self.conn.execute("PRAGMA foreign_keys=ON")
            if self.path != ":memory:":
                self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.executescript(SCHEMA)

    @contextmanager
    def tx(self):
        """One transaction, serialised with every other use of the connection."""
        with self.lock:
            try:
                yield self.conn
                self.conn.commit()
            except BaseException:
                self.conn.rollback()
                raise

    def rows(self, sql, params=()):
        with self.lock:
            return self.conn.execute(sql, params).fetchall()

    def one(self, sql, params=()):
        with self.lock:
            return self.conn.execute(sql, params).fetchone()

    def meta_get(self, key, default=None):
        row = self.one("SELECT value FROM meta WHERE key = ?", (key,))
        return row["value"] if row else default

    def meta_set(self, key, value):
        with self.tx() as conn:
            conn.execute("INSERT INTO meta(key, value) VALUES(?, ?) "
                         "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))

    def close(self):
        with self.lock:
            self.conn.close()
