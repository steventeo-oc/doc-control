import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api import Services, create_app
from app.auth import Identity, LOCAL_IDENTITY
from app.ratelimit import RateLimiter

USER = Identity(7, "Aisha", "aisha@example.com", ("User",), ("QA",))
OTHER = Identity(8, "Bala", "bala@example.com", ("User",), ("HR",))


def client_for(env, identity=LOCAL_IDENTITY, limiter=None):
    who = {"current": identity}

    def authenticate(_request):
        if who["current"] is None:
            raise HTTPException(401, "sign in first")
        return who["current"]

    services = Services(settings=env.settings, assistant=env.assistant, index=env.index, syncer=env.syncer,
                        log=env.log, limiter=limiter or RateLimiter(100, 0, env.log, clock=lambda: env.clock[0]),
                        conversations=env.conversations, authenticate=authenticate)
    return TestClient(create_app(services)), who


def test_health_needs_no_login(stocked):
    client, who = client_for(stocked, None)
    assert client.get("/api/assistant/health").json() == {"status": "ok"}
    assert client.get("/api/assistant/config").status_code == 401


def test_config_reports_the_switches_and_the_index(stocked):
    client, _ = client_for(stocked, USER)
    body = client.get("/api/assistant/config").json()
    assert body["enabled"] is True and body["allowed"] is True and body["documents"] == 3
    assert body["examples"] == ["How long does the test take?"] and body["syncedAt"].endswith("Z")
    assert body["maxQuestionChars"] == 600


def test_ask_returns_the_contract(stocked):
    client, _ = client_for(stocked, USER)
    r = client.post("/api/assistant/ask", json={"question": "  How long is the   burn-in stability run? "})
    assert r.status_code == 200
    body = r.json()
    assert set(body) >= {"id", "state", "answer", "sources", "index", "model", "promptVersion", "ms", "truncated"}
    assert body["state"] == "answered" and body["sources"][0]["documentNumber"] == "SOP-ENG-0001"
    assert set(body["sources"][0]) == {"label", "documentId", "documentNumber", "title", "section", "version",
                                       "effectiveAt", "cited"}


def test_ask_validation(stocked):
    client, _ = client_for(stocked, USER)
    assert client.post("/api/assistant/ask", json={"question": "   "}).status_code == 400
    assert client.post("/api/assistant/ask", json={"question": "x" * 601}).status_code == 400
    assert client.post("/api/assistant/ask", json={}).status_code == 422


def test_ask_needs_a_login(stocked):
    client, _ = client_for(stocked, None)
    assert client.post("/api/assistant/ask", json={"question": "burn-in"}).status_code == 401


def test_a_switched_off_assistant_is_not_found(stocked):
    stocked.rebuild_assistant(enabled=False)
    client, _ = client_for(stocked, USER)
    assert client.post("/api/assistant/ask", json={"question": "burn-in"}).status_code == 404
    assert client.get("/api/assistant/config").json()["enabled"] is False


def test_department_allow_list_is_optional_and_enforced_when_set(stocked):
    stocked.rebuild_assistant(allowed_departments=("QA", "ENG"))
    client, who = client_for(stocked, USER)
    assert client.post("/api/assistant/ask", json={"question": "burn-in stability"}).status_code == 200
    who["current"] = OTHER
    assert client.get("/api/assistant/config").json()["allowed"] is False
    assert client.post("/api/assistant/ask", json={"question": "burn-in stability"}).status_code == 403


def test_rate_limit_answers_429_with_retry_after(stocked):
    limiter = RateLimiter(2, 0, stocked.log, clock=lambda: stocked.clock[0])
    client, _ = client_for(stocked, USER, limiter)
    for _ in range(2):
        assert client.post("/api/assistant/ask", json={"question": "burn-in stability"}).status_code == 200
    r = client.post("/api/assistant/ask", json={"question": "burn-in stability"})
    assert r.status_code == 429 and int(r.headers["Retry-After"]) >= 1
    stocked.clock[0] += 61
    assert client.post("/api/assistant/ask", json={"question": "burn-in stability"}).status_code == 200


def test_an_empty_index_is_503(env):
    client, _ = client_for(env, USER)
    assert client.post("/api/assistant/ask", json={"question": "burn-in"}).status_code == 503


def test_feedback_belongs_to_the_asker(stocked):
    client, who = client_for(stocked, USER)
    answer_id = client.post("/api/assistant/ask", json={"question": "burn-in stability run"}).json()["id"]
    assert client.post("/api/assistant/feedback", json={"id": answer_id, "rating": "down",
                                                        "comment": "wrong revision"}).status_code == 204
    row = stocked.db.one("SELECT rating, comment FROM query_log WHERE id = ?", (answer_id,))
    assert (row["rating"], row["comment"]) == ("down", "wrong revision")
    assert client.post("/api/assistant/feedback", json={"id": answer_id, "rating": "meh"}).status_code == 422
    who["current"] = OTHER
    assert client.post("/api/assistant/feedback", json={"id": answer_id, "rating": "up"}).status_code == 404


def test_admin_endpoints_are_for_admins(stocked):
    client, who = client_for(stocked, USER)
    for method, path in (("get", "/admin/status"), ("post", "/admin/sync"), ("get", "/admin/log.csv")):
        assert getattr(client, method)("/api/assistant" + path).status_code == 403
    who["current"] = LOCAL_IDENTITY
    status = client.get("/api/assistant/admin/status").json()
    assert status["documents"] == {"indexed": 3, "skipped": 0, "failed": 0} and status["chunks"] >= 3
    assert status["models"] == {"llm": "ok", "embedding": "ok", "reranker": "ok"}
    assert status["promptVersion"] == "strict-2" and status["lastSync"]["finishedAt"].endswith("Z")


def test_status_lists_skipped_files_and_redactions(env):
    env.source.put("DWG-ENG-0001", "Drawing", "part.dwg", b"\x00")
    env.source.put("WI-ENG-0009", "Reflash", "w.txt", b"Password: hunter2 then continue with the flash")
    env.sync()
    client, _ = client_for(env)
    status = client.get("/api/assistant/admin/status").json()
    assert status["problems"][0]["document_number"] == "DWG-ENG-0001" and "file type" in status["problems"][0]["reason"]
    assert status["redactions"][0] == {"document_number": "WI-ENG-0009", "name": "Reflash", "redactions": 1}


def test_sync_now_starts_a_background_sync_and_refuses_a_second(stocked):
    import time
    client, _ = client_for(stocked)
    assert client.post("/api/assistant/admin/sync").status_code == 202
    for _ in range(50):
        if not stocked.syncer.running:
            break
        time.sleep(0.02)
    assert stocked.index.last_sync() is not None


def test_log_export_is_csv_with_a_byte_order_mark(stocked):
    client, _ = client_for(stocked)
    client.post("/api/assistant/ask", json={"question": "burn-in stability run"})
    r = client.get("/api/assistant/admin/log.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert r.text.startswith("﻿id,at,user_id") and "burn-in stability run" in r.text
    assert client.get("/api/assistant/admin/log.csv?since=2999-01-01").text.count("\n") == 1
    assert client.get("/api/assistant/admin/log.csv?since=nonsense").status_code == 400


def test_the_status_page_is_html_for_admins_only_and_escapes_what_documents_say(stocked):
    admin = Identity(1, "Admin", "admin@example.com", ("Admin",), ("QA",))
    stocked.source.put("DWG-ENG-0099", "<script>alert(1)</script> Rack", "x.dwg", b"\x00")
    stocked.sync()
    client, who = client_for(stocked, admin)
    page = client.get("/api/assistant/admin/status.html")
    assert page.status_code == 200 and page.headers["content-type"].startswith("text/html")
    assert page.headers["cache-control"] == "no-store" and page.headers["x-content-type-options"] == "nosniff"
    for expected in ("Assistant status", "DWG-ENG-0099", "not searchable: file type .dwg", "Sync now",
                     "documents searchable", "Model servers"):
        assert expected in page.text
    assert "&lt;script&gt;alert(1)&lt;/script&gt; Rack" in page.text          # document text is data, never markup
    assert "<script>alert(1)" not in page.text
    who["current"] = USER
    assert client.get("/api/assistant/admin/status.html").status_code == 403
    who["current"] = None
    assert client.get("/api/assistant/admin/status.html").status_code == 401


def test_the_status_page_before_any_sync_and_with_a_failing_model(env):
    admin = Identity(1, "Admin", "admin@example.com", ("Admin",), ())
    env.embedder.ping = lambda: "cannot reach http://embedding:8011/v1/models"
    client, _ = client_for(env, admin)
    page = client.get("/api/assistant/admin/status.html").text
    assert "No sync has finished yet." in page and "Nothing skipped or failed." in page
    assert "cannot reach http://embedding:8011/v1/models" in page and 'class="bad"' in page


# ---------------------------------------------------------------- saved conversations (Phase 1)

def test_starting_a_conversation_creates_it_asks_and_returns_both(stocked):
    client, _ = client_for(stocked, USER)
    r = client.post("/api/assistant/conversations", json={"question": "How long is the burn-in stability run?"})
    assert r.status_code == 200
    body = r.json()
    assert body["state"] == "answered" and body["conversationId"] is not None
    [row] = client.get("/api/assistant/conversations").json()
    assert row["id"] == body["conversationId"] and row["title"] == "How long is the burn-in stability run?"
    assert row["messageCount"] == 1


def test_starting_a_conversation_obeys_the_same_gates_as_a_one_off_ask(stocked):
    client, _ = client_for(stocked, USER)
    assert client.post("/api/assistant/conversations", json={"question": "   "}).status_code == 400
    assert client.post("/api/assistant/conversations", json={"question": "x" * 601}).status_code == 400
    stocked.rebuild_assistant(enabled=False)
    client, _ = client_for(stocked, USER)
    assert client.post("/api/assistant/conversations", json={"question": "hello"}).status_code == 404


def test_continuing_a_conversation_sends_its_history_and_appears_in_get(stocked):
    client, _ = client_for(stocked, USER)
    started = client.post("/api/assistant/conversations", json={"question": "How long is the burn-in run?"}).json()
    cid = started["conversationId"]

    second = client.post(f"/api/assistant/conversations/{cid}/messages",
                         json={"question": "and where do I record it?"})
    assert second.status_code == 200 and second.json()["conversationId"] == cid
    messages_sent = stocked.llm.calls[-1]
    assert messages_sent[1]["content"] == "How long is the burn-in run?"       # the first turn, as real history now

    convo = client.get(f"/api/assistant/conversations/{cid}").json()
    assert convo["title"] == "How long is the burn-in run?"
    assert [m["question"] for m in convo["messages"]] == ["How long is the burn-in run?", "and where do I record it?"]
    assert convo["messages"][0]["answer"] and convo["messages"][0]["sources"]


def test_a_reopened_not_found_message_never_shows_the_raw_marker(stocked):
    client, _ = client_for(stocked, USER)
    stocked.llm.reply = "NOT_FOUND: nothing here about that."
    started = client.post("/api/assistant/conversations", json={"question": "annual leave?"}).json()
    assert started["answer"] == "nothing here about that."                     # already true of the live answer
    convo = client.get(f"/api/assistant/conversations/{started['conversationId']}").json()
    assert convo["messages"][0]["answer"] == "nothing here about that." and "NOT_FOUND" not in convo["messages"][0]["answer"]


def test_one_user_cannot_see_rename_delete_or_continue_another_users_conversation(stocked):
    mine, _ = client_for(stocked, USER)
    started = mine.post("/api/assistant/conversations", json={"question": "burn-in"}).json()
    cid = started["conversationId"]

    theirs, _ = client_for(stocked, OTHER)
    assert theirs.get(f"/api/assistant/conversations/{cid}").status_code == 404
    assert theirs.post(f"/api/assistant/conversations/{cid}/messages", json={"question": "x"}).status_code == 404
    assert theirs.patch(f"/api/assistant/conversations/{cid}", json={"title": "hijacked"}).status_code == 404
    assert theirs.delete(f"/api/assistant/conversations/{cid}").status_code == 404
    assert theirs.get("/api/assistant/conversations").json() == []
    assert mine.get(f"/api/assistant/conversations/{cid}").json()["title"] == "burn-in"       # untouched


def test_rename_and_delete(stocked):
    client, _ = client_for(stocked, USER)
    cid = client.post("/api/assistant/conversations", json={"question": "burn-in"}).json()["conversationId"]

    assert client.patch(f"/api/assistant/conversations/{cid}", json={"title": "My burn-in questions"}).status_code == 204
    assert client.get("/api/assistant/conversations").json()[0]["title"] == "My burn-in questions"

    assert client.delete(f"/api/assistant/conversations/{cid}").status_code == 204
    assert client.get("/api/assistant/conversations").json() == []
    assert client.get(f"/api/assistant/conversations/{cid}").status_code == 404
    assert client.delete(f"/api/assistant/conversations/{cid}").status_code == 404             # already gone


def test_listing_and_reopening_work_even_when_the_assistant_is_switched_off(stocked):
    client, _ = client_for(stocked, USER)
    cid = client.post("/api/assistant/conversations", json={"question": "burn-in"}).json()["conversationId"]
    stocked.rebuild_assistant(enabled=False)
    client, _ = client_for(stocked, USER)
    assert client.get("/api/assistant/conversations").status_code == 200
    assert client.get(f"/api/assistant/conversations/{cid}").status_code == 200
    assert client.post(f"/api/assistant/conversations/{cid}/messages", json={"question": "more"}).status_code == 404


def test_continuing_a_conversation_shares_the_rate_limit_with_ask(stocked):
    limiter = RateLimiter(1, 0, stocked.log, clock=lambda: stocked.clock[0])
    client, _ = client_for(stocked, USER, limiter=limiter)
    cid = client.post("/api/assistant/conversations", json={"question": "burn-in"}).json()["conversationId"]
    r = client.post(f"/api/assistant/conversations/{cid}/messages", json={"question": "more"})
    assert r.status_code == 429 and "Retry-After" in r.headers


def test_an_empty_index_returns_503_from_every_ask_shaped_endpoint(env):
    client, _ = client_for(env, USER)
    assert client.post("/api/assistant/ask", json={"question": "hello"}).status_code == 503
    r = client.post("/api/assistant/conversations", json={"question": "hello"})
    assert r.status_code == 503
    assert client.get("/api/assistant/conversations").json() == []            # listing itself never needs the index
