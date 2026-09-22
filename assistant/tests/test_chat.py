import subprocess
import sys
from pathlib import Path

import pytest

from app import chat
from app.chat import render_answer

ROOT = Path(__file__).resolve().parent.parent


def source(label, number, title, section="", version=1, effective=None, cited=False):
    return {"label": label, "documentId": None, "documentNumber": number, "title": title, "section": section,
            "version": version, "effectiveAt": effective, "cited": cited}


def response(state="answered", answer="Twenty four hours [S1].", sources=None, truncated=False):
    return {"id": 1, "state": state, "answer": answer, "truncated": truncated, "ms": 1840, "model": "m",
            "promptVersion": "strict-2", "sources": sources if sources is not None else [
                source("S1", "SOP-ENG-0001", "Tray Assembly", "4.4 Testing", 2, "2026-09-04", cited=True),
                source("S2", "WI-ENG-0003", "Torque Check")]}


def test_an_answer_shows_state_timing_words_and_only_the_cited_sources():
    text = render_answer(response())
    assert text.startswith("[answered]  1.8 s  |  m  |  prompt strict-2")
    assert "Twenty four hours [S1]." in text
    assert "S1  SOP-ENG-0001  Tray Assembly  (4.4 Testing / v2 / effective 2026-09-04)" in text
    assert "also searched: WI-ENG-0003" in text and "S2" not in text


def test_not_covered_says_so_and_lists_the_closest_documents_once_each():
    text = render_answer(response("not_found", "The SOP gives no torque.", [
        source("S1", "SOP-ENG-0001", "Tray Assembly"), source("S2", "SOP-ENG-0001", "Tray Assembly", "6 Tools"),
        source("S3", "WI-ENG-0003", "Torque Check")]))
    assert "[NOT COVERED by the documents]" in text and "Not covered by the current documents." in text
    assert "Closest documents" in text and text.count("SOP-ENG-0001") == 1 and "S1 " not in text


def test_unavailable_and_truncated_are_visible():
    text = render_answer(response("unavailable", "The assistant is busy.", truncated=True))
    assert "[UNAVAILABLE]" in text and "(The answer was cut short" in text and "Closest documents" in text


def test_passages_can_be_shown():
    text = render_answer(response(), passages=[{"label": "S1", "document_number": "SOP-ENG-0001", "section": "4.4 Testing",
                                                "text": "Burn-in runs 24 hours."}])
    assert "Passages the model was shown" in text and "[S1] SOP-ENG-0001 / 4.4 Testing" in text
    assert "Burn-in runs 24 hours." in text


@pytest.fixture
def folder(tmp_path):
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "SOP-ENG-0001 Tray Assembly Rev 0.txt").write_text(
        "# 4 Testing\n\nBurn-in test runs for 24 hours under full load.\n\nRecord the result in the build log.")
    (docs / "WI-ENG-0003 Torque Driver Check.txt").write_text(
        "Check the torque driver against the calibration label before every job starts.")
    return docs


@pytest.fixture
def on_mock(monkeypatch, mock_url):
    for name in ("ASSISTANT_LLM_BASE_URL", "ASSISTANT_EMB_BASE_URL", "ASSISTANT_RERANK_BASE_URL"):
        monkeypatch.setenv(name, f"{mock_url}/v1")
    monkeypatch.setenv("ASSISTANT_LLM_MODEL", "mock-model")


def test_the_terminal_client_indexes_a_folder_and_answers(folder, tmp_path, on_mock, capsys):
    chat.main(["--docs", str(folder), "--data", str(tmp_path / "data"), "--context",
               "--ask", "How long does the burn-in test run?", "--ask", "What is the reimbursement limit for client dinners?"])
    out = capsys.readouterr().out
    assert "2 documents searchable, 0 skipped, 0 failed" in out
    assert "[answered]" in out and "Burn-in test runs for 24 hours" in out and "SOP-ENG-0001  Tray Assembly" in out
    assert "Passages the model was shown" in out                       # --context
    assert "[NOT COVERED by the documents]" in out


def test_the_terminal_client_reads_questions_until_an_empty_line(folder, tmp_path, on_mock, capsys, monkeypatch):
    typed = iter(["How long does the burn-in test run?", ""])
    monkeypatch.setattr("builtins.input", lambda prompt="": next(typed))
    chat.main(["--docs", str(folder), "--data", str(tmp_path / "data")])
    out = capsys.readouterr().out
    assert "Type a question and press Enter" in out and out.count("[answered]") == 1


def test_it_says_plainly_when_the_embedding_server_is_not_there(folder, tmp_path, monkeypatch):
    monkeypatch.setenv("ASSISTANT_EMB_BASE_URL", "http://127.0.0.1:1/v1")
    with pytest.raises(SystemExit) as stop:
        chat.main(["--docs", str(folder), "--data", str(tmp_path / "data"), "--ask", "hello"])
    assert "cannot index" in str(stop.value) or "nothing was indexed" in str(stop.value)


def test_the_gate_and_the_terminal_client_need_no_web_packages():
    """The box's spike environment has only the document and model packages. The gate and this client must import there:
    a module-level import of fastapi, uvicorn, psycopg or minio in what they use would break the release gate."""
    code = ("import sys\n"
            "for name in ('fastapi', 'uvicorn', 'psycopg', 'minio', 'pydantic', 'starlette'):\n"
            "    sys.modules[name] = None\n"
            "import app.gate, app.chat\n"
            "print('imported')\n")
    done = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert done.stdout.strip() == "imported", done.stderr[-600:]
