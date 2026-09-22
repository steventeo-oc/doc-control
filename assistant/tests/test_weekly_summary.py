from tools.weekly_summary import summarise


def row(at, user_id, state="answered", ms="1000", rating="", comment="", question="q"):
    return {"at": at, "user_id": user_id, "state": state, "ms": ms, "rating": rating, "comment": comment,
            "question": question}


def test_an_empty_file_says_so():
    assert summarise([]) == "No questions in this file."


def test_counts_users_states_and_the_date_span():
    rows = [row("2026-09-15 09:00:00", "7"), row("2026-09-16 10:00:00", "7"),
            row("2026-09-17 11:00:00", "8", state="not_found"), row("2026-09-18 12:00:00", "9", state="unavailable")]
    out = summarise(rows)
    assert "4 questions from 3 users, 2026-09-15 09:00:00 to 2026-09-18 12:00:00" in out
    assert "answered 2 (50%), not covered 1 (25%), unavailable 1 (25%)" in out
    assert "questions per active user: 1.3 average, busiest: 2 (user 7)" in out


def test_rating_share_and_the_unrated_case():
    rated = [row("t", "1", rating="up"), row("t", "1", rating="up"), row("t", "1", rating="down")]
    out = summarise(rated)
    assert "3 rated (100% of all questions), 67% of those marked helpful" in out
    assert "nobody has rated" not in summarise(rated)
    assert "nobody has rated an answer yet" in summarise([row("t", "1")])


def test_latency_percentiles_use_nearest_rank_like_the_gate():
    rows = [row("t", "1", ms=str(v)) for v in [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]]
    out = summarise(rows)
    assert "p50 500 ms" in out and "p95 1000 ms" in out


def test_not_covered_questions_are_ranked_by_how_often_they_repeat():
    rows = ([row("t", "1", state="not_found", question="leave policy")] * 3
            + [row("t", "1", state="not_found", question="reimbursement limit")])
    out = summarise(rows, top=1)
    assert "Not covered (4)" in out
    assert "3x  leave policy" in out and "reimbursement limit" not in out            # top=1 keeps only the winner


def test_thumbs_down_comments_are_listed_but_only_when_there_is_a_comment():
    rows = [row("t", "1", rating="down", comment="wrong torque value"),
            row("t", "1", rating="down"),                                            # no comment: not listed
            row("t", "1", rating="up", comment="great")]                             # not down: not listed
    out = summarise(rows)
    assert "Thumbs-down with a comment (1)" in out
    assert "'wrong torque value'" in out


def test_the_status_page_pointer_is_always_present():
    assert "admin status page" in summarise([row("t", "1")])
