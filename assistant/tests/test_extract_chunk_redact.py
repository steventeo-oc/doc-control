import pytest

from app.chunking import chunk_blocks, header_for, join_overlapping
from app.extract import UnsupportedType, extract, looks_like_heading
from app.redact import REDACTED, redact
from app.textsearch import BM25, rrf, tokenize
from conftest import make_docx, make_pdf, sentences


# ---------------------------------------------------------------- extraction
def test_docx_headings_paragraphs_and_tables():
    data = make_docx([("h", "1. Purpose"), ("p", "Define the process."), ("p", "Second paragraph.")],
                     table=[["Role", "Duty"], ["QA", "Inspect"]])
    blocks, pages = extract("x.docx", data)
    assert pages is None
    assert ("h", "1. Purpose", None) in blocks
    assert ("p", "Define the process.", None) in blocks
    assert ("p", "Role | Duty", None) in blocks and ("p", "QA | Inspect", None) in blocks


def test_docx_text_box_is_read_once_although_word_stores_it_twice():
    data = make_docx([("p", "Flow chart follows.")], textbox=["Escalate to QA", "IE (Process)"])
    blocks, _ = extract("flow.docx", data)
    diagrams = [text for kind, text, _ in blocks if text.startswith("Diagram text:")]
    assert diagrams == ["Diagram text: Escalate to QA | IE (Process)"]


def test_pdf_text_layer_and_page_count():
    blocks, pages = extract("a.pdf", make_pdf(["Torque is 6.5 kgf.", "Second line"]))
    assert pages == 1
    assert any("Torque is 6.5 kgf." in text for _, text, _ in blocks)
    assert all(page == 1 for _, _, page in blocks)


def test_plain_text_headings_and_unsupported_types():
    blocks, _ = extract("n.md", b"# Title\n\nSome body text here.")
    assert blocks[0][0] == "h" and blocks[1][0] == "p"
    for name in ("drawing.dwg", "mail.msg", "picture.png", "noextension"):
        with pytest.raises(UnsupportedType):
            extract(name, b"binary")


def test_looks_like_heading():
    assert looks_like_heading("3.2.1 DUT cannot power on")
    assert looks_like_heading("SAFETY AND COMPLIANCE")
    assert not looks_like_heading("This sentence ends with a full stop.")
    assert not looks_like_heading("x " * 20)


# ---------------------------------------------------------------- chunking
def test_chunks_never_cross_a_heading_and_share_the_overlap():
    blocks = [("h", "First", None), ("p", sentences(130), None), ("h", "Second", None), ("p", "short text", None)]
    chunks = chunk_blocks(blocks, chunk_words=60, overlap=10)
    assert [c["section"] for c in chunks] == ["First", "First", "First", "Second"]
    assert chunks[3]["text"] == "short text"
    assert chunks[0]["text"].split()[-10:] == chunks[1]["text"].split()[:10]


def test_joining_overlapping_chunks_rebuilds_the_original_text():
    original = sentences(200)
    chunks = chunk_blocks([("h", "S", None), ("p", original, None)], chunk_words=60, overlap=10)
    assert len(chunks) > 3
    assert join_overlapping(chunks, 10) == original


def test_joining_across_sections_marks_the_new_heading():
    chunks = chunk_blocks([("h", "A", None), ("p", "alpha one two", None), ("h", "B", None),
                           ("p", "beta three four", None)], 60, 10)
    joined = join_overlapping(chunks, 10)
    assert joined == "alpha one two\n## B\nbeta three four"


def test_no_text_gives_no_chunks_and_header_format():
    assert chunk_blocks([("h", "Only a heading", None)]) == []
    assert header_for("SOP-QA-0010", "Calibration", "5.2 Frequency") == "SOP-QA-0010 - Calibration - 5.2 Frequency"
    assert header_for("SOP-QA-0010", "Calibration", "") == "SOP-QA-0010 - Calibration"


# ---------------------------------------------------------------- redaction
@pytest.mark.parametrize("text, expected, count", [
    ("Login with Password: hunter2 now", f"Login with Password: {REDACTED} now", 1),
    ("account/password: user/secret", f"account/password: {REDACTED}", 1),
    ("run the script (Password: hunter2)", f"run the script (Password: {REDACTED})", 1),
    ("Username: bob and Password: hunter2.", f"Username: bob and Password: {REDACTED}.", 1),
    ("Kata Laluan (Password): rahsia", f"Kata Laluan (Password): {REDACTED}", 1),
    ("pwd=abc123, then continue", f"pwd={REDACTED}, then continue", 1),
    ("Enter the password to log in to the setup menu.", "Enter the password to log in to the setup menu.", 0),
    ("nothing sensitive here", "nothing sensitive here", 0),
])
def test_redaction(text, expected, count):
    assert redact(text) == (expected, count)


def test_redaction_is_idempotent():
    once, _ = redact("Password: hunter2 and PASSWORD: other")
    assert redact(once) == (once, 0)


# ---------------------------------------------------------------- keyword search
def test_tokenize_keeps_ids_and_their_parts():
    tokens = tokenize("See SOP-QA-0010 for GE1/0/5")
    assert "sop-qa-0010" in tokens and "0010" in tokens and "ge1/0/5" in tokens


def test_bm25_prefers_the_rare_term_and_rrf_rewards_agreement():
    bm25 = BM25([tokenize("common words only"), tokenize("common words plus swot03"), tokenize("common again")])
    assert bm25.topk(tokenize("swot03"), 3)[0][0] == 1
    fused = rrf([[(1, 0.9), (2, 0.5)], [(3, 0.9), (1, 0.4)]])
    assert fused[0][0] == 1
