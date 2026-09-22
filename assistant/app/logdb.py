"""assistant_query_log: what was asked and answered, with feedback (plan-back F8).

Deliberately not audit_log: that is the ISO trail of changes to controlled documents, and a question is not a
document-control event."""
from __future__ import annotations

import csv
import io
import json
import time

CSV_COLUMNS = ["id", "at", "user_id", "user_name", "question", "answer", "state", "sources", "model",
               "prompt_version", "index_snapshot", "ms", "rating", "comment", "conversation_id"]


class QueryLog:
    def __init__(self, db, clock=time.time):
        self.db, self.clock = db, clock

    def write(self, user, question, answer, state, sources, model, prompt_version, index_snapshot, ms, timings,
              conversation_id=None):
        with self.db.tx() as conn:
            return conn.execute(
                "INSERT INTO query_log(at, user_id, user_name, question, answer, state, sources, model, "
                "prompt_version, index_snapshot, ms, timings, conversation_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (self.clock(), str(user.id), user.name, question, answer, state, json.dumps(sources), model,
                 prompt_version, index_snapshot, int(ms), json.dumps(timings), conversation_id)).lastrowid

    def set_feedback(self, log_id, user, rating, comment):
        """Only the person who asked may rate. Returns False when the answer is not theirs or does not exist."""
        with self.db.tx() as conn:
            cur = conn.execute("UPDATE query_log SET rating = ?, comment = ? WHERE id = ? AND user_id = ?",
                               (rating, (comment or "")[:1000] or None, log_id, str(user.id)))
            return cur.rowcount == 1

    def count_since(self, user_id, since):
        return self.db.one("SELECT COUNT(*) AS n FROM query_log WHERE user_id = ? AND at >= ?",
                           (str(user_id), since))["n"]

    def purge_older_than(self, days):
        cutoff = self.clock() - days * 86400
        with self.db.tx() as conn:
            return conn.execute("DELETE FROM query_log WHERE at < ?", (cutoff,)).rowcount

    def export_csv(self, since=None, until=None):
        clauses, params = [], []
        if since is not None:
            clauses.append("at >= ?")
            params.append(since)
        if until is not None:
            clauses.append("at < ?")
            params.append(until)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(CSV_COLUMNS)
        for r in self.db.rows(f"SELECT {', '.join(CSV_COLUMNS)} FROM query_log {where} ORDER BY id", params):
            row = list(r)
            row[1] = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(row[1]))  # UTC, readable in Excel
            writer.writerow(row)
        return out.getvalue()
