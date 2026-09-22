import os
import threading
import time

from app.config import Settings
from app.db import Database
from app.index import Index
from app.sources import FolderSource, split_title
from app.sync import BACKOFF_SECONDS, Syncer
from conftest import FakeEmbedder, FakeSource, hash_vec, make_docx


def test_split_title_drops_the_revision_and_the_number():
    assert split_title("SOP-ENG-0001 Server Tray Rack Assembly Rev 0") == ("SOP-ENG-0001", "Server Tray Rack Assembly")
    assert split_title("WI-ENG-0012 FGT-000011-001_R863A CX8 Assembly Process") == \
        ("WI-ENG-0012", "FGT-000011-001_R863A CX8 Assembly Process")
    assert split_title("Plain name") == ("Plain name", "Plain name")


def test_folder_source_lists_files_and_ignores_lock_files(tmp_path):
    (tmp_path / "SOP-QA-0010 Calibration Rev 1.txt").write_text("body text is here for the test")
    (tmp_path / "~$SOP-QA-0011 Lock.docx").write_bytes(b"lock")
    (tmp_path / ".hidden").write_text("x")
    refs = FolderSource(tmp_path).list_versions()
    assert [(r.document_number, r.name) for r in refs] == [("SOP-QA-0010", "Calibration")]
    name, data = FolderSource(tmp_path).fetch(refs[0])
    assert name.endswith(".txt") and b"body text" in data


def test_first_sync_indexes_and_second_sync_changes_nothing(stocked):
    stats = stocked.index.stats()
    assert stats["indexed"] == 3 and stats["chunks"] >= 3
    again = stocked.sync()
    assert (again.added, again.removed, again.refreshed) == (0, 0, 0)
    assert stocked.index.snapshot.stamp.startswith("3v-")


def test_a_version_that_leaves_the_source_is_removed_and_no_longer_searchable(stocked):
    stocked.source.drop("v-WI-ENG-0010")
    result = stocked.sync()
    assert result.removed == 1
    snap = stocked.index.snapshot
    assert "wi-eng-0010" not in snap.numbers
    assert all(c.document_number != "WI-ENG-0010" for c in snap.chunks)
    assert stocked.index.stats()["chunks"] == len(snap.chunks)


def test_a_new_version_replaces_the_old_one(env):
    env.source.put("SOP-ENG-0001", "Tray", "a.txt", b"first revision text about trays", version_id="v1")
    env.sync()
    env.source.drop("v1")
    env.source.put("SOP-ENG-0001", "Tray", "a.txt", b"second revision text about racks", version_id="v2")
    result = env.sync()
    assert (result.added, result.removed) == (1, 1)
    texts = [c.text for c in env.index.snapshot.chunks]
    assert texts == ["second revision text about racks"]


def test_unsupported_and_textless_files_are_skipped_with_a_reason_and_not_retried(env):
    env.source.put("DWG-ENG-0001", "Drawing", "part.dwg", b"\x00\x01")
    env.source.put("SOP-ENG-0003", "Scan", "scan.txt", b"  \n\n ")
    result = env.sync()
    assert result.skipped == 2 and result.added == 0
    reasons = {p["document_number"]: p["reason"] for p in env.index.problem_rows()}
    assert "file type .dwg" in reasons["DWG-ENG-0001"]
    assert "no text" in reasons["SOP-ENG-0003"]
    calls = env.embedder.doc_calls
    env.sync()
    assert env.embedder.doc_calls == calls          # skipped for good: nothing is embedded again


def test_failed_versions_retry_with_backoff(env):
    vid = env.source.put("SOP-ENG-0001", "Tray", "a.txt", b"text about trays and racks", version_id="v1")
    env.source.fail_fetch.add(vid)
    first = env.sync()
    assert first.failed == 1
    row = env.index.versions()[vid]
    assert row["state"] == "failed" and row["attempts"] == 1
    assert row["next_try_at"] == env.clock[0] + BACKOFF_SECONDS[0]

    env.source.fail_fetch.clear()
    env.clock[0] += 60                               # too early: not retried
    assert env.sync().added == 0
    env.clock[0] += BACKOFF_SECONDS[0]               # now due
    assert env.sync().added == 1
    assert env.index.versions()[vid]["state"] == "indexed"


def test_an_embedding_outage_marks_versions_failed_without_losing_others(env):
    env.source.put("SOP-ENG-0001", "Tray", "a.txt", b"text about trays and racks", version_id="v1")
    env.sync()
    env.source.put("SOP-ENG-0002", "Rack", "b.txt", b"text about racks and power", version_id="v2")
    env.embedder.fail = True
    result = env.sync()
    assert result.failed == 1 and env.index.versions()["v1"]["state"] == "indexed"
    assert "v1" in env.index.snapshot.versions


def test_renaming_a_document_re_embeds_its_chunks(env):
    env.source.put("WI-ENG-0002", "OCES85ZZG6 Assembly", "a.txt", b"install the airflow cover carefully", version_id="v1")
    env.sync()
    before = env.index.snapshot.chunks[0].embed_text
    env.source.refs["v1"] = type(env.source.refs["v1"])(**{**env.source.refs["v1"].__dict__,
                                                          "name": "H8230 Assembly"})
    result = env.sync()
    assert result.refreshed == 1
    after = env.index.snapshot.chunks[0]
    assert "OCES85ZZG6" in before and "H8230" in after.embed_text and after.name == "H8230 Assembly"


def test_a_new_embedding_model_rebuilds_the_whole_index(stocked):
    stocked.embedder.model = "another-model"
    result = stocked.sync()
    assert result.added == 3 and stocked.index.stats()["indexed"] == 3
    assert stocked.index.db.meta_get("embedding_model") == "another-model"


def test_credentials_are_redacted_before_indexing_and_counted(env):
    env.source.put("WI-ENG-0009", "Reflash BMC", "w.txt",
                   b"Login using Username: ADMIN and Password: hunter2. Then click Firmware Update.")
    env.sync()
    text = env.index.snapshot.chunks[0].text
    assert "hunter2" not in text and "Password: [redacted]" in text and "Firmware Update" in text
    assert env.index.redaction_rows()[0]["redactions"] == 1


def test_redaction_can_be_switched_off(settings, db):
    from conftest import Env
    e = Env(Settings(**{**settings.__dict__, "redact_secrets": False}), db)
    e.source.put("WI-ENG-0009", "Reflash BMC", "w.txt", b"Password: hunter2 is the default login here")
    e.sync()
    assert "hunter2" in e.index.snapshot.chunks[0].text


def test_the_index_survives_a_restart(tmp_path, settings):
    path = tmp_path / "assistant.db"
    db = Database(path)
    index = Index(db)
    source = FakeSource()
    source.put("SOP-ENG-0001", "Tray", "a.txt", b"burn in test runs twenty four hours", version_id="v1")
    Syncer(settings, index, source, FakeEmbedder()).run()
    before = index.snapshot
    db.close()

    reopened = Index(Database(path))
    assert reopened.snapshot.stamp == before.stamp
    q = hash_vec("burn in test")
    assert reopened.snapshot.dense(q, 1)[0][0] == 0


def test_only_one_sync_runs_at_a_time(env):
    env.source.put("SOP-ENG-0001", "Tray", "a.txt", b"text about trays and racks", version_id="v1")
    gate, entered = threading.Event(), threading.Event()
    original = env.source.list_versions

    def slow():
        entered.set()
        gate.wait(2)
        return original()

    env.source.list_versions = slow
    worker = threading.Thread(target=env.syncer.run)
    worker.start()
    assert entered.wait(2)
    assert env.syncer.running and env.syncer.run() is None      # a second pass is refused, not queued
    gate.set()
    worker.join(5)
    assert not env.syncer.running


def test_a_source_outage_is_recorded_and_does_not_touch_the_index(stocked):
    def boom():
        raise ConnectionError("database unreachable")

    stocked.source.list_versions = boom
    result = stocked.sync()
    assert "database unreachable" in result.errors[0]
    assert stocked.index.stats()["indexed"] == 3
    assert "database unreachable" in (stocked.index.last_sync().get("error") or "")


def test_folder_source_content_change_creates_a_new_version(tmp_path):
    path = tmp_path / "SOP-QA-0010 Calibration.txt"
    path.write_text("first text of the procedure")
    first = FolderSource(tmp_path).list_versions()[0].version_id
    time.sleep(0.01)
    path.write_text("second and longer text of the procedure")
    assert FolderSource(tmp_path).list_versions()[0].version_id != first
    assert os.path.exists(path)


def test_an_embedding_server_that_is_down_at_sync_time_is_a_recorded_outage_not_a_crash(stocked):
    from app.models import ModelError

    class Down:
        @property
        def model(self):
            raise ModelError("cannot reach http://embedding:8011/v1/models")

    stocked.syncer.embedder = Down()
    result = stocked.sync()
    assert result.errors and "embedding server not available" in result.errors[0]
    assert stocked.index.stats()["indexed"] == 3                # nothing was removed because of the outage
    assert "embedding server not available" in stocked.index.last_sync()["error"]


def test_a_short_document_is_not_mistaken_for_a_scan(env):
    env.source.put("FRM-ENG-0001", "Sign-off form", "form.txt", b"Signed and dated")
    env.sync()
    assert env.index.problem_rows()[0]["reason"] == "too little text to search (3 words)"
