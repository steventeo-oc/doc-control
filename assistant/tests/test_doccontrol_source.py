import sqlite3
import sys
import types

import pytest

from app.config import Settings
from app.doccontrol import COLUMNS, DocControlSource, MinioStorage, clean_name, parse_endpoint, postgres_connector
from app.sync import Syncer
from conftest import make_docx


class ViewDb:
    """A file-backed stand-in for the Postgres view. Like production, every call opens a fresh connection."""

    def __init__(self, path):
        self.path = str(path)
        con = sqlite3.connect(self.path)
        con.execute("CREATE TABLE assistant_indexable_version (" + ", ".join(COLUMNS) + ")")
        con.commit()
        con.close()

    def add(self, version_id, number, name, file_reference, document_id=1, type_code="SOP", department="ENG",
            version_number=1, effective="2026-09-01"):
        con = sqlite3.connect(self.path)
        con.execute("INSERT INTO assistant_indexable_version VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (document_id, number, name, type_code, department, version_id, version_number, file_reference,
                     effective, "2026-08-30 10:00:00", "2026-09-01 09:00:00"))
        con.commit()
        con.close()

    def remove(self, version_id):
        con = sqlite3.connect(self.path)
        con.execute("DELETE FROM assistant_indexable_version WHERE version_id = ?", (version_id,))
        con.commit()
        con.close()

    def connect(self):
        return sqlite3.connect(self.path)


class FakeStorage:
    def __init__(self):
        self.files, self.gets = {}, []

    def get(self, key):
        self.gets.append(key)
        if key not in self.files:
            raise OSError(f"NoSuchKey: {key}")
        return self.files[key]


class FakeResponse:
    def __init__(self, data):
        self.data, self.closed, self.released = data, False, False

    def read(self):
        return self.data

    def close(self):
        self.closed = True

    def release_conn(self):
        self.released = True


class FakeMinio:
    def __init__(self):
        self.calls, self.response = [], FakeResponse(b"bytes")

    def get_object(self, bucket, key):
        self.calls.append((bucket, key))
        return self.response


def test_rows_of_the_view_become_version_refs(tmp_path):
    view = ViewDb(tmp_path / "v.db")
    view.add(17, "SOP-ENG-0001", "Server Tray Assembly Rev 0", "documents/3/17/SOP-ENG-0001 Tray.docx",
             document_id=3, version_number=2)
    [ref] = DocControlSource(view.connect, FakeStorage()).list_versions()
    assert (ref.version_id, ref.document_id, ref.document_number) == ("17", "3", "SOP-ENG-0001")
    assert ref.name == "Server Tray Assembly"                     # the revision is the system's business
    assert (ref.type_code, ref.department_code, ref.version_number, ref.effective_at) == ("SOP", "ENG", 2, "2026-09-01")
    assert ref.file_reference == "documents/3/17/SOP-ENG-0001 Tray.docx"


@pytest.mark.parametrize("name, expected", [
    ("Server Tray Assembly Rev 0", "Server Tray Assembly"),
    ("SOP-ENG-0001 - Server Tray Assembly", "Server Tray Assembly"),
    ("FGT-000011-001_R863A CX8 Assembly Process", "FGT-000011-001_R863A CX8 Assembly Process"),
    ("", "SOP-ENG-0001"),
    (None, "SOP-ENG-0001"),
])
def test_clean_name_keeps_the_title_and_the_product_model(name, expected):
    assert clean_name(name, "SOP-ENG-0001") == expected


def test_fetch_takes_the_file_name_from_the_key_tail(tmp_path):
    view, storage = ViewDb(tmp_path / "v.db"), FakeStorage()
    key = "documents/3/17/SOP-ENG-0001 Tray Rev 0.docx"
    storage.files[key] = b"data"
    view.add(17, "SOP-ENG-0001", "Tray", key)
    source = DocControlSource(view.connect, storage)
    assert source.fetch(source.list_versions()[0]) == ("SOP-ENG-0001 Tray Rev 0.docx", b"data")


def test_missing_settings_are_named_in_the_error():
    with pytest.raises(RuntimeError) as err:
        DocControlSource.from_settings(Settings())
    for name in ("ASSISTANT_DB_URL", "ASSISTANT_MINIO_ENDPOINT", "ASSISTANT_MINIO_ACCESS_KEY",
                 "ASSISTANT_MINIO_SECRET_KEY"):
        assert name in str(err.value)


def test_the_sync_follows_the_view(env, tmp_path):
    view, storage = ViewDb(tmp_path / "v.db"), FakeStorage()
    tray = "documents/1/10/SOP-ENG-0001 Tray Rev 0.docx"
    storage.files[tray] = make_docx([("h", "4 Testing"), ("p", "Burn-in runs for 24 hours under full load.")])
    view.add(10, "SOP-ENG-0001", "Tray Assembly Rev 0", tray, document_id=1)
    view.add(20, "DWG-ENG-0005", "Rack drawing", "documents/2/20/rack.dwg", document_id=2, type_code="DWG")
    syncer = Syncer(env.settings, env.index, DocControlSource(view.connect, storage), env.embedder,
                    clock=lambda: env.clock[0])

    first = syncer.run()
    assert (first.added, first.skipped) == (1, 1)
    chunk = env.index.snapshot.chunks[0]
    assert (chunk.document_number, chunk.name) == ("SOP-ENG-0001", "Tray Assembly")
    assert "Rev 0" not in chunk.embed_text and "Burn-in runs for 24 hours" in chunk.text
    assert storage.gets == [tray]                                 # the drawing was skipped without a download
    assert "file type .dwg" in env.index.problem_rows()[0]["reason"]

    # a new revision is released: the view now lists version 11 instead of 10
    view.remove(10)
    newer = "documents/1/11/SOP-ENG-0001 Tray Rev 1.docx"
    storage.files[newer] = make_docx([("p", "Burn-in runs for 48 hours under full load and hot ambient air.")])
    view.add(11, "SOP-ENG-0001", "Tray Assembly Rev 1", newer, document_id=1, version_number=2)
    second = syncer.run()
    assert (second.added, second.removed) == (1, 1)
    assert [c.text for c in env.index.snapshot.chunks] == ["Burn-in runs for 48 hours under full load and hot ambient air."]

    # a file that has gone missing from MinIO fails visibly, keeps the rest of the index and retries later
    view.add(30, "SOP-ENG-0002", "Rack Assembly", "documents/3/30/missing.docx", document_id=3)
    third = syncer.run()
    assert third.failed == 1 and env.index.versions()["30"]["state"] == "failed"
    assert "NoSuchKey" in env.index.versions()["30"]["reason"] and env.index.stats()["indexed"] == 1


def test_minio_storage_reads_one_object_and_frees_the_connection():
    client = FakeMinio()
    storage = MinioStorage("http://minio:9000", "user", "secret", "doccontrol", client=client)
    assert storage.get("documents/1/1/a.pdf") == b"bytes"
    assert client.calls == [("doccontrol", "documents/1/1/a.pdf")]
    assert client.response.closed and client.response.released


@pytest.mark.parametrize("endpoint, expected", [
    ("http://minio:9000", ("minio:9000", False)),
    ("http://minio:9000/", ("minio:9000", False)),
    ("https://files.example.com", ("files.example.com", True)),
    ("minio:9000", ("minio:9000", False)),
])
def test_parse_endpoint(endpoint, expected):
    assert parse_endpoint(endpoint) == expected


def test_the_postgres_connection_is_read_only_and_short_lived(monkeypatch):
    seen = {}
    fake = types.SimpleNamespace(connect=lambda url, **kw: seen.update(url=url, **kw) or "connection")
    monkeypatch.setitem(sys.modules, "psycopg", fake)
    settings = Settings(db_url="postgresql://assistant_ro@postgres:5432/doccontrol", db_password="s3cret",
                        db_timeout=7)
    assert postgres_connector(settings)() == "connection"
    assert seen["url"].startswith("postgresql://assistant_ro@") and seen["password"] == "s3cret"
    assert seen["autocommit"] is True and seen["connect_timeout"] == 7
    assert "default_transaction_read_only=on" in seen["options"]

    seen.clear()
    postgres_connector(Settings(db_url="postgresql://assistant_ro@postgres/doccontrol"))()
    assert "password" not in seen                                 # only sent when configured


def test_source_and_session_settings_come_from_the_environment_and_secrets_stay_out_of_repr():
    s = Settings.from_env({
        "ASSISTANT_DB_URL": "postgresql://assistant_ro@postgres:5432/doccontrol", "ASSISTANT_DB_PASSWORD": "db-secret",
        "ASSISTANT_MINIO_ENDPOINT": "http://minio:9000", "ASSISTANT_MINIO_ACCESS_KEY": "reader",
        "ASSISTANT_MINIO_SECRET_KEY": "minio-secret", "ASSISTANT_MINIO_BUCKET": "docs",
        "ASSISTANT_ALLOWED_ORIGINS": "http://a.example, https://b.example/", "ASSISTANT_SESSION_CACHE_S": "30",
        "ASSISTANT_LLM_API_KEY": "llm-secret"})
    assert (s.db_password, s.minio_bucket, s.session_cache_s) == ("db-secret", "docs", 30)
    assert s.allowed_origins == ("http://a.example", "https://b.example/")
    assert s.minio_endpoint == "http://minio:9000" and s.minio_access_key == "reader"
    text = repr(s)
    for secret in ("db-secret", "minio-secret", "llm-secret", "assistant_ro"):
        assert secret not in text
