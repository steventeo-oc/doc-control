import threading

import pytest

from app.ask import IndexBuilding, boost_document_numbers, cited_labels, reader_text, select_sources
from app.prompts import build_user_prompt, system_prompt
from conftest import sentences


def ask(env, question):
    return env.assistant.ask(question, env.user)


def test_answered_with_citations_sources_and_a_log_row(stocked):
    result = ask(stocked, "How long is the burn-in stability run?")
    r = result.response
    assert r["state"] == "answered" and "[S1]" in r["answer"]
    assert r["sources"][0]["documentNumber"] == "SOP-ENG-0001"
    assert r["sources"][0]["cited"] is True and r["sources"][0]["title"] == "Server Tray Assembly"
    assert r["model"] == "fake-llm" and r["promptVersion"] == "strict-2" and r["index"]["documents"] == 3
    assert r["index"]["syncedAt"].endswith("Z")
    row = stocked.db.one("SELECT * FROM query_log WHERE id = ?", (r["id"],))
    assert row["state"] == "answered" and row["question"].startswith("How long")
    assert result.debug["ranked_docs"][0] == "SOP-ENG-0001" and result.debug["cited_docs"] == ["SOP-ENG-0001"]


def test_a_threaded_question_sends_prior_turns_as_real_chat_turns_before_the_current_one(stocked):
    cid = stocked.conversations.create(stocked.user, "How long is the burn-in stability run?")
    history = [{"question": "How long is the burn-in stability run?", "answer": "24 hours [S1]."},
              {"question": "And for the older model?", "answer": "NOT_FOUND: not covered."}]
    result = stocked.assistant.ask("What about records retention?", stocked.user, history=history,
                                   conversation_id=cid)
    messages = stocked.llm.calls[-1]
    assert [m["role"] for m in messages] == ["system", "user", "assistant", "user", "assistant", "user"]
    assert messages[1]["content"] == history[0]["question"] and messages[2]["content"] == history[0]["answer"]
    assert messages[3]["content"] == history[1]["question"] and messages[4]["content"] == history[1]["answer"]
    assert messages[-1]["content"].endswith("QUESTION\nWhat about records retention?")   # the actual retrieval prompt
    assert result.debug["history_turns"] == 2


def test_a_threaded_answer_is_logged_against_its_conversation_and_echoes_the_id_back(stocked):
    cid = stocked.conversations.create(stocked.user, "How long is the burn-in stability run?")
    r = stocked.assistant.ask("How long is the burn-in stability run?", stocked.user, conversation_id=cid).response
    assert r["conversationId"] == cid
    row = stocked.db.one("SELECT conversation_id FROM query_log WHERE id = ?", (r["id"],))
    assert row["conversation_id"] == cid


def test_a_one_off_question_is_unaffected_by_the_new_parameters(stocked):
    with_defaults = stocked.assistant.ask("How long is the burn-in stability run?", stocked.user).response
    explicit_none = stocked.assistant.ask("How long is the burn-in stability run?", stocked.user, history=None,
                                          conversation_id=None).response
    for r in (with_defaults, explicit_none):
        assert r["conversationId"] is None
    assert stocked.llm.calls[-1][1]["role"] == "user"                       # straight from system to this question
    assert len(stocked.llm.calls[-1]) == 2


def test_history_grows_the_estimated_prompt_token_count(stocked):
    bare = stocked.assistant.ask("How long is the burn-in stability run?", stocked.user)
    threaded = stocked.assistant.ask("How long is the burn-in stability run?", stocked.user,
                                     history=[{"question": "x" * 400, "answer": "y" * 400}])
    assert threaded.debug["prompt_tokens_est"] > bare.debug["prompt_tokens_est"]


def test_an_unavailable_llm_still_logs_the_conversation_id(stocked):
    cid = stocked.conversations.create(stocked.user, "burn-in stability run")
    stocked.llm.fail = True
    r = stocked.assistant.ask("burn-in stability run", stocked.user, conversation_id=cid).response
    assert r["state"] == "unavailable" and r["conversationId"] == cid
    row = stocked.db.one("SELECT conversation_id FROM query_log WHERE id = ?", (r["id"],))
    assert row["conversation_id"] == cid


def test_not_found_keeps_the_text_and_still_lists_the_closest_sources(stocked):
    stocked.llm.reply = "NOT_FOUND: the sources cover burn-in tests but not leave entitlements."
    r = ask(stocked, "How many days of annual leave do new hires get?").response
    assert r["state"] == "not_found" and "burn-in" in r["answer"] and r["sources"]
    assert not any(s["cited"] for s in r["sources"])


def test_the_reader_never_sees_the_not_found_marker_but_the_log_keeps_it(stocked):
    stocked.llm.reply = "NOT_FOUND: the sources cover burn-in tests but not leave entitlements."
    r = ask(stocked, "How many days of annual leave do new hires get?").response
    assert r["answer"] == "the sources cover burn-in tests but not leave entitlements."
    assert stocked.db.one("SELECT answer FROM query_log WHERE id = ?", (r["id"],))["answer"].startswith("NOT_FOUND:")


@pytest.mark.parametrize("raw, shown", [
    ("NOT_FOUND", "The current documents do not answer this question."),
    ("not_found - nothing here", "nothing here"),
    ("NOT_FOUND.\nThe SOP names the tray but gives no torque.", "The SOP names the tray but gives no torque."),
])
def test_reader_text_handles_the_marker_forms(raw, shown):
    assert reader_text("not_found", raw) == shown
    assert reader_text("answered", raw) == raw                 # only a not_found reply is rewritten


def test_llm_outage_returns_unavailable_with_sources(stocked):
    stocked.llm.fail = True
    result = ask(stocked, "burn-in stability run")
    assert result.response["state"] == "unavailable" and result.response["sources"]
    assert "llm" in result.debug["degraded"] and "temporarily unavailable" in result.response["answer"]


def test_reranker_outage_degrades_but_still_answers(stocked):
    stocked.reranker.fail = True
    result = ask(stocked, "burn-in stability run")
    assert result.response["state"] == "answered" and "reranker" in result.debug["degraded"]


def test_embedding_outage_returns_unavailable_without_sources(stocked):
    stocked.embedder.fail = True
    result = ask(stocked, "burn-in stability run")
    assert result.response["state"] == "unavailable" and result.response["sources"] == []


def test_empty_index_raises_index_building(env):
    with pytest.raises(IndexBuilding):
        ask(env, "anything at all")


def test_unknown_citation_labels_are_reported_not_trusted(stocked):
    stocked.llm.reply = "It takes 24 hours [S1] and also [S9]."
    result = ask(stocked, "burn-in stability run")
    assert result.debug["bad_citations"] == ["S9"] and "S9" not in {
        s["label"] for s in result.response["sources"] if s["cited"]}


def test_credentials_in_the_model_output_are_redacted(stocked):
    stocked.llm.reply = "Log in with Password: hunter2 [S1]."
    assert "hunter2" not in ask(stocked, "burn-in stability run").response["answer"]


def test_an_empty_model_answer_is_treated_as_unavailable(stocked):
    stocked.llm.reply = lambda messages: "   "        # whitespace only, so it survives FakeLlm's fallback
    assert ask(stocked, "burn-in stability run").response["state"] == "unavailable"


def test_a_document_number_in_the_question_puts_that_document_first(stocked):
    result = ask(stocked, "what does SOP-ENG-0002 say?")
    assert result.debug["ranked_docs"][0] == "SOP-ENG-0002"


def test_boost_pulls_in_a_named_document_that_retrieval_missed(stocked):
    snap = stocked.index.snapshot
    ranking = [(snap.by_version["v-SOP-ENG-0001"][0], 1.0)]
    boosted = boost_document_numbers(snap, "tell me about WI-ENG-0010", ranking)
    assert snap.chunks[boosted[0][0]].document_number == "WI-ENG-0010"


def test_neighbouring_chunks_are_added_and_windows_are_merged(env):
    text = sentences(180).encode()                       # 60-word chunks with 10 overlap: several chunks
    env.source.put("SOP-ENG-0001", "Long", "long.txt", text, version_id="v1")
    env.sync()
    snap = env.index.snapshot
    positions = snap.by_version["v1"]
    assert len(positions) >= 4
    middle = positions[2]
    sources = select_sources(snap, [(middle, 1.0)], top_chunks=6, neighbours=1, neighbour_top=2, overlap=10)
    assert len(sources) == 1
    words = sources[0].text.split()
    assert words == snap_words(snap, positions[1:4])       # previous, hit and next chunk, overlap dropped once

    two = select_sources(snap, [(positions[1], 1.0), (positions[2], 0.9)], 6, 1, 2, 10)
    assert len(two) == 1                                   # touching windows merge into one source


def snap_words(snap, positions):
    from app.chunking import join_overlapping
    return join_overlapping([{"section": snap.chunks[p].section, "text": snap.chunks[p].text} for p in positions],
                            10).split()


def test_only_the_best_hits_get_neighbours(env):
    env.source.put("SOP-ENG-0001", "Long", "long.txt", sentences(400).encode(), version_id="v1")
    env.sync()
    snap = env.index.snapshot
    positions = snap.by_version["v1"]
    ranking = [(positions[1], 1.0), (positions[5], 0.9)]
    sources = select_sources(snap, ranking, 6, 1, neighbour_top=1, overlap=10)
    lengths = sorted(len(s.text.split()) for s in sources)
    assert lengths[0] < lengths[1]                         # the second hit is a single chunk, the first has neighbours


def test_llm_concurrency_is_capped_and_overflow_gets_a_busy_state(stocked):
    stocked.rebuild_assistant(max_concurrent=1, queue_wait_s=0)
    entered, release = threading.Event(), threading.Event()

    def slow(messages):
        entered.set()
        release.wait(3)
        return "It takes 24 hours [S1]."

    stocked.llm.reply = slow
    first = {}
    worker = threading.Thread(target=lambda: first.update(r=ask(stocked, "burn-in stability run")))
    worker.start()
    assert entered.wait(3)
    busy = ask(stocked, "burn-in stability run")
    assert busy.response["state"] == "unavailable" and "llm-busy" in busy.debug["degraded"]
    release.set()
    worker.join(5)
    assert first["r"].response["state"] == "answered"


def test_prompt_versions(stocked):
    assert "Reply in the language of the question" in system_prompt("strict-2")
    assert "credential" in system_prompt("strict-2")
    assert "Reply in the language" not in system_prompt("strict-1")
    assert "main point" in system_prompt("partial-1")
    with pytest.raises(ValueError):
        system_prompt("nope")
    ask(stocked, "burn-in stability run")
    system, user = stocked.llm.calls[-1]
    assert system["content"] == system_prompt("strict-2")
    assert user["content"].startswith("SOURCES\n\n[S1] SOP-ENG-0001 - Server Tray Assembly")
    assert user["content"].endswith("QUESTION\nburn-in stability run")
    assert stocked.llm.temperatures[-1] == 0.0                          # pinned so the server's own default cannot vary answers


def test_user_prompt_layout_and_label_parsing():
    class S:
        label, document_number, name, section, text = "S1", "SOP-QA-0010", "Calibration", "5.2 Frequency", "body"
    assert build_user_prompt("q?", [S()]) == "SOURCES\n\n[S1] SOP-QA-0010 - Calibration - 5.2 Frequency\nbody\n\nQUESTION\nq?"
    assert cited_labels("a [S1] b [S2, S3] c [x] [S10]") == ["S1", "S2", "S3", "S10"]
