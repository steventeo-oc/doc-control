"""Credentials that sit in plain text inside documents are replaced before anything is indexed (plan-back F7).

The spike found an assistant repeating a default login it had read in a work instruction, once while refusing a
different question. Anyone allowed to open the document can read it, so this is hygiene, not access control; it
also keeps credentials out of the query log. Over-redaction is the safe direction."""
from __future__ import annotations

import re

REDACTED = "[redacted]"
_LABEL = r"(?:password|passwd|pwd|kata\s+laluan)"
# label (with an optional closing bracket, as in "Kata Laluan (Password): x"), then a separator, then the value
# up to whitespace or trailing punctuation.
PASSWORD_RE = re.compile(
    rf"(?P<label>\b{_LABEL}\)?\s*[:=]\s*)(?P<value>[^\s\"',;)]+?)(?=[.,;)]*(?:\s|$))", re.IGNORECASE)


def redact(text):
    """Returns (text with credential values replaced, number of replacements)."""
    count = 0

    def replace(match):
        nonlocal count
        if match.group("value") == REDACTED:
            return match.group(0)
        count += 1
        return match.group("label") + REDACTED

    return PASSWORD_RE.sub(replace, text), count
