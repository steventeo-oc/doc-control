"""Saved, resumable conversations (AI_Assistant_Conversations_PlanBack.md, Phase 1): a user's own questions,
grouped under a title, that they can reopen. This module owns the `conversation` table and reads the `query_log`
rows that belong to one; QueryLog still owns writing those rows -- it just gained an optional conversation_id.

Deleting a conversation archives it (matches document-control's own soft-delete convention, `deleted_at`): it
disappears from the owner's list, but its query_log rows are untouched. That log is the admin's audit and weekly
review, and it is not a user's to rewrite by deleting their side of it."""
from __future__ import annotations

import json
import time

TITLE_MAX = 80


def _title_from(question):
    """The conversation's name, before anyone renames it: the first question, tidied and capped."""
    question = " ".join(question.split())
    return question if len(question) <= TITLE_MAX else question[:TITLE_MAX - 1].rstrip() + "…"


class Conversations:
    def __init__(self, db, clock=time.time):
        self.db, self.clock = db, clock

    def create(self, user, first_question):
        """A new conversation, titled from its first question. Returns the new id."""
        now = self.clock()
        with self.db.tx() as conn:
            return conn.execute(
                "INSERT INTO conversation(user_id, title, created_at, updated_at) VALUES (?,?,?,?)",
                (str(user.id), _title_from(first_question), now, now)).lastrowid

    def touch(self, conversation_id):
        with self.db.tx() as conn:
            conn.execute("UPDATE conversation SET updated_at = ? WHERE id = ?", (self.clock(), conversation_id))

    def discard(self, conversation_id):
        """Removes a conversation that never got even one message -- used when starting one fails outright (an
        empty index, a model outage), so the failure does not leave a phantom empty conversation in the user's
        list. A hard delete, unlike archive(): there is no log row yet for anything to preserve."""
        with self.db.tx() as conn:
            conn.execute("DELETE FROM conversation WHERE id = ?", (conversation_id,))

    def owned_by(self, user, conversation_id):
        """The conversation's row if it exists, is not archived, and belongs to this user; otherwise None. Existence
        is not leaked to anyone else -- a stranger's id and a wrong id look identical from the outside."""
        row = self.db.one("SELECT * FROM conversation WHERE id = ? AND user_id = ? AND archived_at IS NULL",
                          (conversation_id, str(user.id)))
        return dict(row) if row else None

    def list(self, user):
        """The caller's own conversations, most recently active first."""
        rows = self.db.rows(
            "SELECT c.id, c.title, c.created_at, c.updated_at, COUNT(q.id) AS message_count "
            "FROM conversation c LEFT JOIN query_log q ON q.conversation_id = c.id "
            "WHERE c.user_id = ? AND c.archived_at IS NULL "
            "GROUP BY c.id ORDER BY c.updated_at DESC", (str(user.id),))
        return [dict(r) for r in rows]

    def history(self, conversation_id, turns):
        """The last `turns` real exchanges, oldest first -- what Assistant.ask needs to build a multi-turn prompt.
        'unavailable' turns are left out: no answer was actually written, so there is nothing to remind the model
        of, and including the "temporarily unavailable" text as if it were a real answer would only mislead it."""
        if turns <= 0:
            return []
        rows = self.db.rows(
            "SELECT question, answer FROM query_log WHERE conversation_id = ? AND state != 'unavailable' "
            "ORDER BY id DESC LIMIT ?", (conversation_id, turns))
        return [{"question": r["question"], "answer": r["answer"]} for r in reversed(rows)]

    def messages(self, conversation_id):
        """Every exchange in the conversation, oldest first, for reopening it."""
        rows = self.db.rows(
            "SELECT id, at, question, answer, state, sources, rating, comment FROM query_log "
            "WHERE conversation_id = ? ORDER BY id", (conversation_id,))
        out = []
        for r in rows:
            row = dict(r)
            row["sources"] = json.loads(row["sources"]) if row["sources"] else []
            out.append(row)
        return out

    def rename(self, user, conversation_id, title):
        """True if renamed; False if the conversation is not this user's (or does not exist)."""
        title = " ".join((title or "").split())[:TITLE_MAX] or "Untitled"
        with self.db.tx() as conn:
            cur = conn.execute(
                "UPDATE conversation SET title = ? WHERE id = ? AND user_id = ? AND archived_at IS NULL",
                (title, conversation_id, str(user.id)))
            return cur.rowcount == 1

    def archive(self, user, conversation_id):
        """True if archived; False if the conversation is not this user's (or does not exist, or already is)."""
        with self.db.tx() as conn:
            cur = conn.execute(
                "UPDATE conversation SET archived_at = ? WHERE id = ? AND user_id = ? AND archived_at IS NULL",
                (self.clock(), conversation_id, str(user.id)))
            return cur.rowcount == 1
