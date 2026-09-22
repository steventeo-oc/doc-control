"""Test doubles and document builders. No test needs a GPU, a network or a real document."""
from __future__ import annotations

import hashlib
import io
import re
from dataclasses import replace

import numpy as np
import pytest
from docx import Document
from docx.oxml import parse_xml

from app.ask import Assistant
from app.auth import LOCAL_IDENTITY
from app.config import Settings
from app.db import Database
from app.index import Index
from app.logdb import QueryLog
from app.models import ModelError
from app.sources import VersionRef
from app.sync import Syncer
from app.textsearch import tokenize

DIM = 64


def hash_vec(text):
    v = np.zeros(DIM, dtype=np.float32)
    for tok in tokenize(text):
        v[int(hashlib.md5(tok.encode()).hexdigest(), 16) % DIM] += 1.0
    n = np.linalg.norm(v)
    return v / n if n else v


class FakeEmbedder:
    def __init__(self, model="fake-embed"):
        self.model, self.fail, self.doc_calls = model, False, 0

    def docs(self, texts):
        self.doc_calls += 1
        if self.fail:
            raise ModelError("embedding server down")
        return np.vstack([hash_vec(t) for t in texts])

    def query(self, text):
        if self.fail:
            raise ModelError("embedding server down")
        return hash_vec(text)

    def ping(self):
        return "ok"


class FakeReranker:
    def __init__(self):
        self.fail = False

    def rerank(self, query, documents):
        if self.fail:
            raise ModelError("reranker down")
        q = set(tokenize(query))
        scored = [(i, float(len(q & set(tokenize(d))))) for i, d in enumerate(documents)]
        return sorted(scored, key=lambda x: x[1], reverse=True)

    def ping(self):
        return "ok"


def extractive_reply(messages):
    """Cite the source that shares the most words with the question; NOT_FOUND when nothing does."""
    user = messages[-1]["content"]
    body, question = user.rsplit("\n\nQUESTION\n", 1)
    q = set(tokenize(question))
    best, best_score = None, 1
    for block in re.split(r"\n\n(?=\[S\d+\] )", body.split("SOURCES\n\n", 1)[-1]):
        label = re.match(r"\[(S\d+)\]", block).group(1)
        score = len(q & set(tokenize(block.split("\n", 1)[-1])))
        if score > best_score:
            best, best_score = f"{block.split(chr(10), 1)[-1][:160]} [{label}]", score
    return best or "NOT_FOUND: the sources do not cover this."


class FakeLlm:
    model = "fake-llm"

    def __init__(self, reply=None):
        self.reply, self.fail, self.calls, self.temperatures = reply, False, [], []

    def chat(self, messages, max_tokens=1200, temperature=None):
        self.calls.append(messages)
        self.temperatures.append(temperature)
        if self.fail:
            raise ModelError("LLM down")
        content = (self.reply(messages) if callable(self.reply) else self.reply) or extractive_reply(messages)
        return {"content": content, "reasoning": "", "finish": "stop", "usage": {"prompt_tokens": 100},
                "seconds": 0.0}

    def ping(self):
        return "ok"


class FakeSource:
    """A source whose versions and file contents the test controls."""

    def __init__(self):
        self.refs, self.files, self.fail_fetch = {}, {}, set()

    def put(self, number, name, filename, data, version_id=None, **kw):
        vid = version_id or f"v-{number}"
        self.refs[vid] = VersionRef(version_id=vid, document_number=number, name=name, file_reference=filename,
                                    document_id=kw.pop("document_id", None), **kw)
        self.files[vid] = data
        return vid

    def drop(self, vid):
        self.refs.pop(vid, None)
        self.files.pop(vid, None)

    def list_versions(self):
        return list(self.refs.values())

    def fetch(self, ref):
        if ref.version_id in self.fail_fetch:
            raise OSError("object missing")
        return ref.file_reference, self.files[ref.version_id]


def make_docx(paragraphs=(), table=None, textbox=None):
    """paragraphs: [("h" | "p", text)]; table: [[cell, ...], ...]; textbox: [text, ...] stored the way Word does
    (a DrawingML copy plus a VML fallback), which the extractor must read once."""
    doc = Document()
    for kind, text in paragraphs:
        doc.add_heading(text, level=2) if kind == "h" else doc.add_paragraph(text)
    if table:
        t = doc.add_table(rows=len(table), cols=len(table[0]))
        for r, row in enumerate(table):
            for c, cell in enumerate(row):
                t.cell(r, c).text = cell
    if textbox:
        inner = "".join(f"<w:p><w:r><w:t>{t}</w:t></w:r></w:p>" for t in textbox)
        xml = ('<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
               'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
               'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
               'xmlns:v="urn:schemas-microsoft-com:vml"><mc:AlternateContent>'
               f'<mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent>{inner}</w:txbxContent></wps:txbx>'
               '</w:drawing></mc:Choice>'
               f'<mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent>{inner}</w:txbxContent></v:textbox>'
               '</v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>')
        doc.add_paragraph()._p.append(parse_xml(xml))
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _pdf_escape(text):
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_pdf(lines):
    """A one-page PDF with a real text layer (Helvetica), built by hand so no PDF library is needed."""
    body = "".join(f"({_pdf_escape(line)}) Tj T* " for line in lines)
    stream = f"BT /F1 12 Tf 72 740 Td 16 TL {body}ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        "/Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{obj}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def sentences(n, prefix="word"):
    """n distinct words, so chunk boundaries are predictable."""
    return " ".join(f"{prefix}{i}" for i in range(n))


@pytest.fixture
def mock_url():
    """The stand-in model server (tools/mock_models.py) on a free port: embeddings, reranker and LLM at /v1."""
    import threading
    from http.server import ThreadingHTTPServer

    from tools import mock_models

    server = ThreadingHTTPServer(("127.0.0.1", 0), mock_models.Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


@pytest.fixture
def settings():
    return Settings(enabled=True, source="folder", auth="none", data_dir=".", prompt="strict-2", chunk_words=60,
                    overlap=10, top_chunks=6, neighbours=1, neighbour_top=2, queue_wait_s=0, max_concurrent=2,
                    rate_per_min=100, examples=("How long does the test take?",))


@pytest.fixture
def db():
    database = Database(":memory:")
    yield database
    database.close()


class Env:
    """Everything wired with fakes; tests poke at the parts."""

    def __init__(self, settings, db):
        self.settings, self.db = settings, db
        self.index = Index(db)
        self.embedder, self.reranker, self.llm = FakeEmbedder(), FakeReranker(), FakeLlm()
        self.source = FakeSource()
        self.clock = [1_000_000.0]
        self.log = QueryLog(db, clock=lambda: self.clock[0])
        self.syncer = Syncer(settings, self.index, self.source, self.embedder, clock=lambda: self.clock[0])
        self.assistant = Assistant(settings, self.index, self.embedder, self.reranker, self.llm, self.log)
        self.user = LOCAL_IDENTITY

    def sync(self):
        return self.syncer.run()

    def rebuild_assistant(self, **changes):
        self.settings = replace(self.settings, **changes)
        self.syncer.s = self.settings
        self.assistant = Assistant(self.settings, self.index, self.embedder, self.reranker, self.llm, self.log)
        return self.assistant


@pytest.fixture
def env(settings, db):
    return Env(settings, db)


@pytest.fixture
def stocked(env):
    """An environment whose index holds three small documents."""
    env.source.put("SOP-ENG-0001", "Server Tray Assembly", "a.txt",
                   b"# 4.4 Testing\n\nBurn-in test: 24 hour stability run under 90 percent load.\n\n"
                   b"# 6 Records\n\nRecords shall be retained for a minimum of 7 years.")
    env.source.put("SOP-ENG-0002", "Test Software Release", "b.txt",
                   b"# 5 Records\n\nRecords shall be retained for a minimum of 7 years or per customer contract.\n\n"
                   b"# 4 Procedure\n\nTest software must be validated before release to production.")
    env.source.put("WI-ENG-0010", "H8230 Assembly Process", "c.txt",
                   b"Remove the protective blue film from all GPUs before installation. Torque is not stated here.")
    result = env.sync()
    assert result.added == 3, result
    return env
