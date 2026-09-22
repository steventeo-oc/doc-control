"""The grounding prompt. Versions are named so every logged answer says which wording produced it.

strict-1  exactly the prompt the spike measured (12/12 NOT_FOUND on unanswerable questions).
strict-2  strict-1 plus two rules: reply in the question's language; never repeat credentials (plan-back F5, F7).
partial-1 / partial-2  the sharper rule 2 ("NOT_FOUND only when the main point is unanswered"), not yet measured.

A change of wording is a change of behaviour: run the release gate (app/gate.py) before switching."""
from __future__ import annotations

HEAD = (
    "You are the Document Control assistant for a manufacturing company (ISO 9001). Answer the user's "
    "question using ONLY the numbered SOURCES provided; they are the current, approved versions of the "
    "company's controlled documents.\n\n"
    "Rules:\n"
    "1. Never use outside knowledge, general industry practice or assumptions, even when you know the "
    "usual answer. If a detail is not in the SOURCES, say it is not stated.\n"
)
RULE_2 = {
    "strict": ("2. If the SOURCES do not answer the question, begin your reply with NOT_FOUND: and say briefly "
               "what the SOURCES do cover.\n"),
    "partial": ("2. If the SOURCES do not answer the question's main point, begin your reply with NOT_FOUND: and "
                "say briefly what the SOURCES do cover; related material that does not answer the question does "
                "not count. If the SOURCES do answer the main point, answer it even when the wording differs "
                "or a minor detail is missing, and end with a line starting 'Not stated in the SOURCES:' that "
                "names what is missing. Never begin with NOT_FOUND when your reply contains the answer.\n"),
}
TAIL = (
    "3. Cite every factual statement with its source label in square brackets, for example [S2]. Give "
    "document numbers, intervals, limits and form numbers exactly as written.\n"
    "4. If sources conflict, say so and cite both.\n"
    "5. Be concise. Use a short numbered list for procedural steps."
)
EXTRA_RULES = (
    "\n6. Reply in the language of the question.\n"
    "7. Never repeat a password, PIN, API key or other credential, even when a source contains one; say "
    "that the document contains a credential and where to find it."
)

PROMPTS = {
    "strict-1": HEAD + RULE_2["strict"] + TAIL,
    "strict-2": HEAD + RULE_2["strict"] + TAIL + EXTRA_RULES,
    "partial-1": HEAD + RULE_2["partial"] + TAIL,
    "partial-2": HEAD + RULE_2["partial"] + TAIL + EXTRA_RULES,
}


def system_prompt(version):
    try:
        return PROMPTS[version]
    except KeyError:
        raise ValueError(f"unknown prompt version {version!r}; choose one of {sorted(PROMPTS)}") from None


def build_user_prompt(question, sources):
    """SOURCES (each headed '[S1] SOP-QA-0010 - Title - Section') followed by the QUESTION."""
    parts = ["SOURCES"]
    for s in sources:
        head = f"[{s.label}] {s.document_number} - {s.name}"
        head += f" - {s.section}" if s.section else ""
        parts.append(f"{head}\n{s.text}")
    parts.append(f"QUESTION\n{question}")
    return "\n\n".join(parts)
