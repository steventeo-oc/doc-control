"""Passages of about 260 words that never cross a heading, each with a header that says where it lives."""
from __future__ import annotations


def chunk_blocks(blocks, chunk_words=260, overlap=40):
    """Word-window chunks that never cross a heading; each remembers its section and page span. Consecutive
    chunks of one section share `overlap` words, so a sentence on a boundary is whole in at least one of them."""
    overlap = min(overlap, chunk_words - 1)
    chunks, current, section, chunk_section, fresh = [], [], "", "", 0

    def flush(keep_overlap):
        nonlocal current, fresh
        if current and fresh:
            pages = [p for _, p in current if p is not None]
            chunks.append({"section": chunk_section,
                           "page_start": min(pages) if pages else None,
                           "page_end": max(pages) if pages else None,
                           "text": " ".join(w for w, _ in current)})
        current = current[-overlap:] if keep_overlap and overlap else []
        fresh = 0

    for kind, text, page in blocks:
        if kind == "h":
            flush(False)
            section = text
            continue
        for word in text.split():
            if not current:
                chunk_section = section
            current.append((word, page))
            fresh += 1
            if len(current) >= chunk_words:
                flush(True)
    flush(False)
    return chunks


def header_for(document_number, title, section):
    """'SOP-QA-0010 - Calibration Control - 5.2 Frequency': prepended to a chunk before it is embedded, so the
    chunk knows its document (model names often live only in the title)."""
    return f"{document_number} - {title}" + (f" - {section}" if section else "")


def join_overlapping(chunks, overlap):
    """Rebuild running text from consecutive chunks of one version. Where two chunks of the same section
    overlap, the repeated words are dropped once; where the section changes, its heading is written as a line
    of its own (headings are not part of chunk text, so the reader would otherwise not see the boundary)."""
    text, previous_words, previous_section = "", None, None
    for chunk in chunks:
        words = chunk["text"].split()
        if previous_words is None:
            text = " ".join(words)
        elif chunk["section"] == previous_section:
            k = min(overlap, len(previous_words), len(words))
            if k and previous_words[-k:] == words[:k]:
                words = words[k:]
            text += " " + " ".join(words) if words else ""
        else:
            heading = f"## {chunk['section']}\n" if chunk["section"] else ""
            text += "\n" + heading + " ".join(words)
        previous_words, previous_section = chunk["text"].split(), chunk["section"]
    return text
