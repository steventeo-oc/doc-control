"""Turn a stored file into blocks of text: ("h" | "p", text, page).

Ported from the spike, which found two things worth remembering: python-docx silently skips Word text boxes
(flowcharts and picture captions are usually drawn as text boxes: 1,372 words missed in 25 documents), and
Word stores every text box twice (a DrawingML copy and a VML fallback), so the fallback must be ignored."""
from __future__ import annotations

import io
import re
from pathlib import Path

SUPPORTED = {".pdf", ".docx", ".txt", ".md"}
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006"
NUM_HEADING_RE = re.compile(r"^\d+(?:\.\d+)*[.)]?\s+[A-Za-z]")


class UnsupportedType(Exception):
    """The file type cannot be read as text (DWG, images, .msg, ...)."""


def looks_like_heading(line):
    s = line.strip()
    words = s.split()
    if not s or len(s) > 90 or len(words) > 10 or s.endswith((".", ",", ";")):
        return False
    if NUM_HEADING_RE.match(s):
        return True
    letters = [c for c in s if c.isalpha()]
    return len(words) <= 8 and len(letters) >= 3 and s.isupper()


def textbox_items(element):
    """Text inside Word text boxes and shapes under `element`; a box nested in another box is read as part of
    its parent and the VML fallback copy of a box is ignored."""
    box_tag, fallback_tag = f"{{{W_NS}}}txbxContent", f"{{{MC_NS}}}Fallback"
    items = []
    for box in element.iter(box_tag):
        if any(a.tag in (box_tag, fallback_tag) for a in box.iterancestors()):
            continue
        for para in box.iter(f"{{{W_NS}}}p"):
            text = " ".join("".join(t.text or "" for t in para.iter(f"{{{W_NS}}}t")).split())
            if text:
                items.append(text)
    return items


def diagram_block(element):
    items = textbox_items(element)
    return [("p", "Diagram text: " + " | ".join(items), None)] if items else []


def extract_docx(source):
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    document = docx.Document(source)
    blocks = []
    for child in document.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            para = Paragraph(child, document)
            text = para.text.strip()
            if text:
                style = para.style.name if para.style is not None and para.style.name else ""
                heading = style.startswith("Heading") or style == "Title" or looks_like_heading(text)
                blocks.append(("h" if heading else "p", text, None))
            blocks.extend(diagram_block(child))
        elif tag == "tbl":
            for row in Table(child, document).rows:
                seen, cells = [], []
                for cell in row.cells:
                    if any(cell._tc is s for s in seen):
                        continue  # merged cells repeat
                    seen.append(cell._tc)
                    text = " ".join(cell.text.split())
                    if text:
                        cells.append(text)
                if cells:
                    blocks.append(("p", " | ".join(cells), None))
            blocks.extend(diagram_block(child))
    return blocks, None


def extract_pdf(source):
    import pypdf
    reader = pypdf.PdfReader(source)
    blocks = []
    for page_no, page in enumerate(reader.pages, start=1):
        paragraph = []
        for line in (page.extract_text() or "").splitlines():
            line = line.strip()
            if not line:
                continue
            if looks_like_heading(line):
                if paragraph:
                    blocks.append(("p", " ".join(paragraph), page_no))
                    paragraph = []
                blocks.append(("h", line, page_no))
            else:
                paragraph.append(line)
        if paragraph:
            blocks.append(("p", " ".join(paragraph), page_no))
    return blocks, len(reader.pages)


def extract_text(text):
    blocks = []
    for para in re.split(r"\n\s*\n", text):
        lines = para.strip().splitlines()
        if not lines:
            continue
        if len(lines) == 1 and (lines[0].lstrip().startswith("#") or looks_like_heading(lines[0])):
            blocks.append(("h", lines[0].lstrip("# ").strip(), None))
        else:
            blocks.append(("p", " ".join(" ".join(lines).split()), None))
    return blocks, None


def extract(filename, data):
    """Blocks and page count for a file's bytes. Raises UnsupportedType for anything that is not text."""
    ext = Path(filename).suffix.lower()
    if ext == ".docx":
        return extract_docx(io.BytesIO(data))
    if ext == ".pdf":
        return extract_pdf(io.BytesIO(data))
    if ext in {".txt", ".md"}:
        return extract_text(data.decode("utf-8", errors="replace"))
    raise UnsupportedType(ext or "(no extension)")
