"""The stand-in model server (tools/mock_models.py) must work with the real clients in app/models.py: the compose
profile `mock-models` and smoke section 16 depend on it."""
from app.ask import Assistant
from app.auth import LOCAL_IDENTITY
from app.index import Index
from app.logdb import QueryLog
from app.models import Embedder, Llm, Reranker
from app.sync import Syncer
from conftest import FakeSource


def test_the_real_clients_talk_to_the_mock(mock_url):
    embedder = Embedder(f"{mock_url}/v1", "", "", "", "")
    vectors = embedder.docs(["burn in test runs", "power supply check"])
    assert vectors.shape[0] == 2 and embedder.ping() == "ok"
    ranked = Reranker(f"{mock_url}/v1", "", "").rerank("burn in test", ["power supply", "burn in test runs"])
    assert ranked[0][0] == 1
    reply = Llm(f"{mock_url}/v1", "", "", "none", 10).chat([{"role": "user", "content": "say something"}])
    assert reply["content"] == "ok"


def test_the_pinned_temperature_actually_reaches_the_wire(mock_url):
    # A falsy-but-present 0.0 is exactly the value a careless `if temperature:` guard would silently drop.
    reply = Llm(f"{mock_url}/v1", "", "", "none", 10).chat([{"role": "user", "content": "hi"}], temperature=0.0)
    assert reply["content"] == "ok"

    import requests
    sent = requests.post(f"{mock_url}/v1/chat/completions",
                         json={"model": "m", "messages": [{"role": "user", "content": "hi"}],
                               "temperature": 0.0, "reasoning_effort": "none"}).json()
    assert sent["received"] == {"temperature": 0.0, "reasoning_effort": "none"}


def test_a_whole_question_runs_against_the_mock(mock_url, settings, db):
    index = Index(db)
    embedder = Embedder(f"{mock_url}/v1", "", "", "", "")
    source = FakeSource()
    source.put("SOP-ENG-0001", "Tray Assembly", "a.txt",
               b"# 4 Testing\n\nBurn-in test runs for 24 hours under full load.")
    Syncer(settings, index, source, embedder).run()
    assistant = Assistant(settings, index, embedder, Reranker(f"{mock_url}/v1", "", ""),
                          Llm(f"{mock_url}/v1", "", "", "none", 10), QueryLog(db))

    found = assistant.ask("How long does the burn-in test run?", LOCAL_IDENTITY).response
    assert found["state"] == "answered" and found["sources"][0]["documentNumber"] == "SOP-ENG-0001"
    assert found["sources"][0]["cited"] is True

    missing = assistant.ask("Which printer should I use for large drawings?", LOCAL_IDENTITY).response
    assert missing["state"] == "not_found"
