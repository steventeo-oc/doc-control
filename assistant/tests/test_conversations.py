import sqlite3

import pytest

from app.auth import Identity
from app.conversations import Conversations
from app.db import Database

ALICE = Identity(1, "Alice")
BOB = Identity(2, "Bob")


@pytest.fixture
def convos(db):
    clock = [1_000_000.0]
    return Conversations(db, clock=lambda: clock[0]), clock


def log_row(db, user_id, conversation_id, question="q", answer="a", state="answered", at=1_000_000.0):
    with db.tx() as conn:
        conn.execute(
            "INSERT INTO query_log(at, user_id, user_name, question, answer, state, sources, conversation_id) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (at, user_id, "name", question, answer, state, "[]", conversation_id))


def test_a_new_conversation_is_titled_from_its_first_question(convos):
    c, _clock = convos
    cid = c.create(ALICE, "  How long   does the burn-in test run?  ")
    [row] = c.list(ALICE)
    assert row["id"] == cid and row["title"] == "How long does the burn-in test run?" and row["message_count"] == 0


def test_a_long_first_question_is_capped_for_the_title(convos):
    c, _clock = convos
    cid = c.create(ALICE, "x" * 200)
    title = c.list(ALICE)[0]["title"]
    assert len(title) == 80 and title.endswith("…")


def test_only_the_owner_sees_or_reaches_their_conversation(convos):
    c, _clock = convos
    cid = c.create(ALICE, "alice's question")
    assert c.owned_by(ALICE, cid) is not None
    assert c.owned_by(BOB, cid) is None
    assert c.list(BOB) == []
    assert c.rename(BOB, cid, "hijacked") is False
    assert c.archive(BOB, cid) is False
    assert c.list(ALICE)[0]["title"] == "alice's question"        # untouched by Bob's attempts


def test_owned_by_a_missing_id_is_none_not_an_error(convos):
    c, _clock = convos
    assert c.owned_by(ALICE, 999999) is None


def test_listing_is_most_recently_active_first_and_counts_messages(convos, db):
    c, clock = convos
    first = c.create(ALICE, "first")
    clock[0] += 10
    second = c.create(ALICE, "second")
    log_row(db, "1", first, at=clock[0])
    log_row(db, "1", first, at=clock[0])
    log_row(db, "1", second, at=clock[0])

    rows = c.list(ALICE)
    assert [r["id"] for r in rows] == [second, first]             # not touched since creation: still newest first
    assert {r["id"]: r["message_count"] for r in rows} == {first: 2, second: 1}

    clock[0] += 10
    c.touch(first)
    assert [r["id"] for r in c.list(ALICE)] == [first, second]    # touching brings it back to the top


def test_renaming_trims_and_caps_and_a_blank_title_falls_back(convos):
    c, _clock = convos
    cid = c.create(ALICE, "original")
    assert c.rename(ALICE, cid, "  new   title  ") is True
    assert c.list(ALICE)[0]["title"] == "new title"
    c.rename(ALICE, cid, "y" * 200)
    assert len(c.list(ALICE)[0]["title"]) == 80
    c.rename(ALICE, cid, "   ")
    assert c.list(ALICE)[0]["title"] == "Untitled"


def test_archiving_hides_a_conversation_but_leaves_its_log_rows(convos, db):
    c, _clock = convos
    cid = c.create(ALICE, "to be archived")
    log_row(db, "1", cid)
    assert c.archive(ALICE, cid) is True
    assert c.list(ALICE) == [] and c.owned_by(ALICE, cid) is None
    assert c.archive(ALICE, cid) is False                          # already archived: nothing to do a second time
    still_there = db.one("SELECT COUNT(*) AS n FROM query_log WHERE conversation_id = ?", (cid,))
    assert still_there["n"] == 1                                   # the admin log is not a user's to delete


def test_history_is_oldest_first_capped_and_skips_unavailable_turns(convos, db):
    c, clock = convos
    cid = c.create(ALICE, "first")
    for i, state in enumerate(["answered", "unavailable", "not_found", "answered", "answered"]):
        clock[0] += 1
        log_row(db, "1", cid, question=f"q{i}", answer=f"a{i}", state=state, at=clock[0])

    assert c.history(cid, 0) == []
    all_real = c.history(cid, 10)
    assert [h["question"] for h in all_real] == ["q0", "q2", "q3", "q4"]   # q1 (unavailable) is excluded
    capped = c.history(cid, 2)
    assert [h["question"] for h in capped] == ["q3", "q4"]                 # the most recent 2, oldest first


def test_messages_parses_sources_and_keeps_everything_in_order(convos, db):
    c, clock = convos
    cid = c.create(ALICE, "first")
    with db.tx() as conn:
        conn.execute(
            "INSERT INTO query_log(at, user_id, user_name, question, answer, state, sources, rating, comment, "
            "conversation_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (clock[0], "1", "Alice", "q1", "a1", "answered", '[{"label": "S1"}]', "up", "great", cid))
        clock[0] += 1
        conn.execute(
            "INSERT INTO query_log(at, user_id, user_name, question, answer, state, sources, conversation_id) "
            "VALUES (?,?,?,?,?,?,?,?)", (clock[0], "1", "Alice", "q2", "a2", "answered", None, cid))

    rows = c.messages(cid)
    assert [r["question"] for r in rows] == ["q1", "q2"]
    assert rows[0]["sources"] == [{"label": "S1"}] and rows[0]["rating"] == "up" and rows[0]["comment"] == "great"
    assert rows[1]["sources"] == []                                        # no sources stored: an empty list, not None


def test_discard_removes_an_empty_conversation_entirely(convos, db):
    c, _clock = convos
    cid = c.create(ALICE, "never got an answer")
    c.discard(cid)
    assert c.owned_by(ALICE, cid) is None and c.list(ALICE) == []
    assert db.one("SELECT COUNT(*) AS n FROM conversation WHERE id = ?", (cid,))["n"] == 0   # a real delete


def test_a_conversation_from_one_user_never_appears_in_another_users_history_lookup(convos, db):
    c, _clock = convos
    mine = c.create(ALICE, "mine")
    yours = c.create(BOB, "yours")
    log_row(db, "1", mine, question="alice q")
    log_row(db, "2", yours, question="bob q")
    # history() takes a bare id (Assistant.ask already knows which conversation it is asking within, via the
    # ownership-checked id the API handed it); the API layer is what stops id 2 leaking into Alice's request.
    assert [h["question"] for h in c.history(mine, 10)] == ["alice q"]
    assert [h["question"] for h in c.history(yours, 10)] == ["bob q"]


# ---------------------------------------------------------------- db.py migration safety

def test_a_pre_existing_database_without_conversation_id_is_upgraded_in_place(tmp_path):
    path = tmp_path / "old.db"
    # The schema exactly as it shipped before this feature: no conversation table, no conversation_id column.
    raw = sqlite3.connect(str(path))
    raw.execute("CREATE TABLE query_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at REAL NOT NULL, user_id TEXT, "
               "user_name TEXT, question TEXT NOT NULL, answer TEXT, state TEXT NOT NULL, sources TEXT, "
               "model TEXT, prompt_version TEXT, index_snapshot TEXT, ms INTEGER, timings TEXT, "
               "rating TEXT, comment TEXT)")
    raw.execute("INSERT INTO query_log(at, question, state) VALUES (1.0, 'an old question', 'answered')")
    raw.commit()
    raw.close()

    db = Database(path)                                            # opening it must migrate, not crash
    columns = {r["name"] for r in db.rows("PRAGMA table_info(query_log)")}
    assert "conversation_id" in columns
    row = db.one("SELECT question, conversation_id FROM query_log")
    assert row["question"] == "an old question" and row["conversation_id"] is None   # the old row survives, untouched

    c = Conversations(db)
    cid = c.create(ALICE, "a new threaded question")
    with db.tx() as conn:
        conn.execute("UPDATE query_log SET conversation_id = ? WHERE question = 'an old question'", (cid,))
    assert [h["question"] for h in c.history(cid, 10)] == ["an old question"]        # the new column actually works

    db.close()
    reopened = Database(path)                                      # opening an already-migrated file is a no-op
    assert {r["name"] for r in reopened.rows("PRAGMA table_info(query_log)")} == columns
    reopened.close()


def test_a_fresh_database_already_has_the_column(db):
    columns = {r["name"] for r in db.rows("PRAGMA table_info(query_log)")}
    assert "conversation_id" in columns
