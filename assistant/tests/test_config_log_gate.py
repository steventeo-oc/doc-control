import pytest

from app.ask import AskResult
from app.auth import Identity
from app.config import DEFAULT_QUERY_PREFIX, Settings
from app.gate import THRESHOLDS, evaluate, failures, summarise, verdicts
from app.logdb import QueryLog
from app.ratelimit import RateLimiter

ALICE, BOB = Identity(1, "Alice"), Identity(2, "Bob")


# ---------------------------------------------------------------- settings
def test_defaults_match_the_plan_back():
    s = Settings.from_env({})
    assert (s.top_chunks, s.neighbours, s.neighbour_top, s.chunk_words, s.overlap) == (8, 1, 3, 260, 40)
    assert (s.sync_minutes, s.max_concurrent, s.rate_per_min, s.rate_per_day) == (5, 2, 10, 0)
    assert (s.llm_effort, s.prompt, s.redact_secrets, s.enabled) == ("none", "strict-2", True, False)
    assert s.llm_temperature == 0.0                    # pinned: the server's own default must not vary answers
    assert s.emb_query_prefix == DEFAULT_QUERY_PREFIX and s.allowed_departments == ()


def test_environment_overrides_and_escapes():
    s = Settings.from_env({"DOCCONTROL_ASSISTANT_ENABLED": "true", "ASSISTANT_LLM_BASE_URL": "http://llm:8000/v1/",
                           "ASSISTANT_EMB_QUERY_PREFIX": "Query:\\n", "ASSISTANT_ALLOWED_DEPARTMENTS": "QA, ENG",
                           "ASSISTANT_EXAMPLES": "One?|Two?", "ASSISTANT_RATE_PER_DAY": "40",
                           "ASSISTANT_REDACT_SECRETS": "false", "ASSISTANT_LLM_API_KEY": "  secret  ",
                           "ASSISTANT_LLM_TEMPERATURE": "0.3"})
    assert s.enabled and s.llm_base_url == "http://llm:8000/v1" and s.emb_query_prefix == "Query:\n"
    assert s.allowed_departments == ("QA", "ENG") and s.examples == ("One?", "Two?")
    assert s.rate_per_day == 40 and s.redact_secrets is False and s.llm_api_key == "secret"
    assert s.llm_temperature == 0.3


@pytest.mark.parametrize("env", [
    {"ASSISTANT_SOURCE": "nowhere"},
    {"ASSISTANT_AUTH": "maybe"},
    {"ASSISTANT_AUTH": "none"},                      # no login against the real corpus, ever
    {"ASSISTANT_TOP_CHUNKS": "0"},
    {"ASSISTANT_OVERLAP": "500"},
    {"ASSISTANT_MAX_CONCURRENT": "0"},
    {"ASSISTANT_SYNC_MINUTES": "soon"},
    {"ASSISTANT_LLM_TEMPERATURE": "-0.1"},
    {"ASSISTANT_LLM_TEMPERATURE": "2.1"},
    {"ASSISTANT_LLM_TEMPERATURE": "warm"},
])
def test_bad_settings_are_refused(env):
    with pytest.raises(ValueError):
        Settings.from_env(env)


def test_no_auth_is_allowed_only_with_the_folder_source():
    assert Settings.from_env({"ASSISTANT_AUTH": "none", "ASSISTANT_SOURCE": "folder"}).auth == "none"


# ---------------------------------------------------------------- query log and limits
def test_log_feedback_export_and_purge(db):
    now = [1_000_000.0]
    log = QueryLog(db, clock=lambda: now[0])
    first = log.write(ALICE, "q1", "a1", "answered", [{"label": "S1"}], "m", "strict-2", "snap", 1200, {"llm_ms": 900})
    now[0] += 86400 * 400
    second = log.write(BOB, "q,2", "a2", "not_found", [], "m", "strict-2", "snap", 900, {})
    assert log.set_feedback(second, BOB, "up", "thanks") is True
    assert log.set_feedback(second, ALICE, "down", None) is False          # not hers
    assert log.set_feedback(999, ALICE, "down", None) is False
    csv_text = log.export_csv()
    assert csv_text.splitlines()[0].startswith("id,at,user_id") and '"q,2"' in csv_text and "thanks" in csv_text
    assert log.export_csv(since=now[0] - 10).count("\n") == 2
    assert log.purge_older_than(365) == 1
    assert db.one("SELECT COUNT(*) AS n FROM query_log")["n"] == 1 and first != second


def test_rate_limiter_window_and_daily_cap(db):
    now = [1000.0]
    log = QueryLog(db, clock=lambda: now[0])
    limiter = RateLimiter(2, 3, log, clock=lambda: now[0])
    assert limiter.check(1) == (True, 0) and limiter.check(1) == (True, 0)
    allowed, retry = limiter.check(1)
    assert not allowed and 1 <= retry <= 61
    assert limiter.check(2) == (True, 0)                                 # another user is unaffected
    now[0] += 61
    assert limiter.check(1)[0] is True
    for _ in range(3):
        log.write(ALICE, "q", "a", "answered", [], "m", "p", "s", 1, {})
    now[0] += 61
    assert limiter.check(1) == (False, 3600)                             # the optional daily cap


def test_no_daily_cap_by_default(db):
    log = QueryLog(db)
    limiter = RateLimiter(0, 0, log)
    for _ in range(50):
        log.write(ALICE, "q", "a", "answered", [], "m", "p", "s", 1, {})
        assert limiter.check(1)[0]


# ---------------------------------------------------------------- release gate arithmetic
def result(state="answered", answer="It is 24 hours [S1]", ranked=("SOP-ENG-0001",), cited=("SOP-ENG-0001",), bad=(),
           ms=1500):
    return AskResult({"state": state, "answer": answer, "ms": ms},
                     {"ranked_docs": list(ranked), "cited_docs": list(cited), "bad_citations": list(bad),
                      "usage": {"prompt_tokens": 2000}, "degraded": []})


GOOD = {"id": "c1", "kind": "lookup", "question": "q", "answerable": True, "expected_docs": ["SOP-ENG-0001"],
        "expected_facts": ["24 hours"]}
NEG = {"id": "c2", "kind": "neg", "question": "q", "answerable": False}


def test_a_good_run_passes_every_threshold():
    rows = [evaluate(GOOD, result()), evaluate(NEG, result(state="not_found", answer="NOT_FOUND: nope"))]
    summary = summarise(rows)
    checks = verdicts(summary)
    assert all(ok for _v, ok in checks.values()) and set(checks) == set(THRESHOLDS)
    assert summary["right_document_first"] == 1.0 and summary["abstained_on_unanswerable"] == 1.0
    assert failures(rows) == []


def test_each_kind_of_failure_is_detected():
    wrong_first = evaluate(GOOD, result(ranked=("SOP-ENG-0002", "SOP-ENG-0001"), cited=("SOP-ENG-0002",)))
    assert wrong_first["rank"] == 2 and wrong_first["cited_expected"] is False
    answered_negative = evaluate(NEG, result(answer="Ten days"))
    bad_label = evaluate(GOOD, result(bad=("S9",)))
    unavailable = evaluate(GOOD, result(state="unavailable"))
    slow = evaluate(GOOD, result(ms=9000))
    rows = [wrong_first, answered_negative, bad_label, unavailable, slow]
    text = "\n".join(failures(rows))
    for needle in ("ranked 2", "did not cite", "answered a question the documents do not cover",
                   "source label that was not provided", "unavailable"):
        assert needle in text
    checks = verdicts(summarise(rows))
    assert not checks["abstained_on_unanswerable"][1] and not checks["invalid_citations"][1]
    assert not checks["unavailable"][1] and not checks["p95_ms"][1] and not checks["right_document_first"][1]


def test_facts_are_matched_ignoring_case_and_spacing():
    row = evaluate(GOOD, result(answer="The run lasts   24   HOURS [S1]"))
    assert row["facts_ok"] is True
    assert evaluate(GOOD, result(answer="Twenty four hours [S1]"))["facts_ok"] is False
