#!/usr/bin/env python3
"""Tiny OpenAI-compatible mock (models, embeddings, rerank, chat with reasoning_content and SSE) so
rag_spike.py can be dry-run anywhere without a GPU:

    python mock_server.py [--port 18010] [--key test-key]

The 'embedding' is a hashed bag of words and the 'LLM' quotes the best-matching sentence, so the
numbers it produces prove the plumbing, not the quality of any real model."""
import argparse
import hashlib
import json
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DIM = 256
STOP = set("a an and are as at be by for from has have in is it its of on or that the to was were will with "
           "what how often must does do i my we".split())
KEY = None
REJECT_TOP_EFFORT = False  # simulate a server that only accepts low/medium/high as top-level reasoning_effort
FLAKY = False              # every 4th chat request fails with HTTP 500
REAL_LIKE = False          # mimic the observed DeepSeek/SGLang behaviour (see thinking_words)
chat_calls = 0


def thinking_words(req):
    """How many words of fake reasoning to emit for this request."""
    kwargs = req.get("chat_template_kwargs") or {}
    top = req.get("reasoning_effort")
    if REAL_LIKE:  # off by default; string levels or thinking=true switch it on; integer kwargs alone do nothing
        if isinstance(top, str):
            return {"low": 10, "medium": 20, "high": 30}.get(top, 10)
        if kwargs.get("thinking") is True:
            effort = kwargs.get("reasoning_effort")
            return 5 + (effort // 4 if isinstance(effort, int) else 10)
        return 0
    if kwargs.get("thinking") is False:  # legacy mock: always thinks, integers set the amount
        return 0
    effort = top if top is not None else kwargs.get("reasoning_effort", 20)
    return effort if isinstance(effort, int) else 20


def toks(text):
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in STOP]


def embed(text):
    vec = [0.0] * DIM
    for t in toks(text):
        vec[int(hashlib.md5(t.encode()).hexdigest(), 16) % DIM] += 1.0
    norm = sum(x * x for x in vec) ** 0.5 or 1.0
    return [x / norm for x in vec]


synth_calls = {"direct": 0}


def sentences(text):
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


def passages_in(prompt):
    return re.findall(r'"""\n(.*?)\n"""', prompt, re.S)


def pick_fact(sentence):
    m = re.search(r"[A-Z]{2,6}-[A-Z]{2,6}-\d{3,5}", sentence) or re.search(r"\d+(?:\.\d+)?\s?[A-Za-z%]+", sentence)
    return m.group(0) if m else None


def first_fact(text):
    return next((f for f in (pick_fact(s) for s in sentences(text)) if f), None)


def plain_words(text, n):
    return [w for w in toks(text) if not any(ch.isdigit() for ch in w)][:n]


def synth_reply(prompt):
    """Answers for synth_questions.py, with deliberate bad outputs so its filters get exercised."""
    if "Do the passages contain the information needed" in prompt:
        body = prompt.split("PASSAGES\n", 1)[1]
        passages, question = body.split("\n\nQUESTION\n", 1)
        q = set(toks(question.split("\n\nReturn JSON", 1)[0]))
        overlap = len(q & set(toks(passages))) / max(1, len(q))
        return json.dumps({"answerable": overlap >= 0.6, "reason": f"mock word overlap {overlap:.2f}"})
    if "Write ONE question that a colleague could really ask" in prompt:
        synth_calls["direct"] += 1
        n = synth_calls["direct"]
        text = passages_in(prompt)[0]
        if n % 7 == 0:
            return "Sorry, I cannot produce JSON for this."                    # unparseable path
        sentence = next((s for s in sentences(text) if re.search(r"\d", s)), sentences(text)[0])
        fact = pick_fact(sentence) or "a value that is not in the passage"
        if n % 5 == 0:
            fact = "a value that is not in the passage"                        # fact-not-verbatim path
        question = sentence if n % 4 == 0 else "What is required regarding " + " ".join(plain_words(sentence, 3)) + "?"
        return json.dumps({"question": question, "expected_facts": [fact]})   # n % 4 == 0 leaks the answer
    if "needs BOTH passages" in prompt:
        a, b = passages_in(prompt)[:2]
        if not (set(toks(a)) & set(toks(b))):
            return json.dumps({"question": None})
        fa, fb = first_fact(a), first_fact(b)
        return json.dumps({"question": "How do " + " and ".join(plain_words(a, 2)) + " relate to "
                                       + " and ".join(plain_words(b, 2)) + "?",
                           "facts_from_first": [fa] if fa else [], "facts_from_second": [fb] if fb else []})
    if "does NOT answer" in prompt:
        return json.dumps({"question": "Who is the escalation contact for "
                                       + " ".join(plain_words(passages_in(prompt)[0], 2)) + " issues?"})
    if "common industry or ISO practice" in prompt:
        return json.dumps({"question": "What is the usual industry practice for "
                                       + " ".join(plain_words(passages_in(prompt)[0], 2)) + " checks?"})
    if "NONE of these procedures would answer" in prompt:
        return json.dumps({"questions": ["What is the reimbursement limit for client dinners?",
                                         "Where is the fire assembly point?", "How do I reset my laptop password?",
                                         "How many vacation days do new hires get?",
                                         "Which printer should I use for large drawings?"]})
    return None


def reply_text(prompt):
    synth = synth_reply(prompt)
    if synth is not None:
        return synth
    if "You are grading" in prompt:
        return json.dumps({"faithful": True, "unsupported_claims": [], "correct": True, "reason": "mock"})
    if "pong" in prompt:
        return "pong"
    if "Incoming lots are sampled" in prompt:
        return "46 units are sampled in total, and the 640-unit lot uses the 20-unit sample."
    if "SOURCES\n\n" in prompt and "\n\nQUESTION\n" in prompt:
        body, question = prompt.split("SOURCES\n\n", 1)[1].rsplit("\n\nQUESTION\n", 1)
        q = set(toks(question))
        best, best_score = None, 0
        for source in re.split(r"\n\n(?=\[S\d+\] )", body):
            label = re.match(r"\[(S\d+)\]", source).group(1)
            for sentence in re.split(r"(?<=[.!?])\s+", source.split("\n", 1)[-1]):
                score = len(q & set(toks(sentence)))
                if score > best_score:
                    best, best_score = f"{sentence.strip()} [{label}]", score
        return best if best_score >= 2 else "NOT_FOUND: the sources do not cover this."
    if "gauge type G-77" in prompt:
        return "9"
    return "ok"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        if KEY and self.headers.get("Authorization") != f"Bearer {KEY}":
            self._send(401, {"error": "invalid api key"})
            return False
        return True

    def do_GET(self):
        if self._authorized() and self.path.endswith("/models"):
            self._send(200, {"data": [{"id": "mock-model"}]})

    def do_POST(self):
        if not self._authorized():
            return
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if self.path.endswith("/embeddings"):
            inputs = req["input"] if isinstance(req["input"], list) else [req["input"]]
            self._send(200, {"data": [{"index": i, "embedding": embed(t)} for i, t in enumerate(inputs)]})
        elif self.path.endswith("/rerank"):
            q = set(toks(req["query"]))
            scored = [{"index": i, "score": float(len(q & set(toks(d))))} for i, d in enumerate(req["documents"])]
            self._send(200, sorted(scored, key=lambda r: r["score"], reverse=True))
        elif self.path.endswith("/chat/completions"):
            self._chat(req)
        else:
            self._send(404, {"error": "not found"})

    def _chat(self, req):
        global chat_calls
        chat_calls += 1
        if FLAKY and chat_calls % 4 == 0:
            self._send(500, {"error": "boom"})
            return
        if (REJECT_TOP_EFFORT or REAL_LIKE) and isinstance(req.get("reasoning_effort"), int):
            self._send(400, {"object": "error", "message": "reasoning_effort must be one of low, medium, high"})
            return
        prompt = req["messages"][-1]["content"]
        thinking = "hmm " * thinking_words(req)
        content = reply_text(prompt)
        usage = {"prompt_tokens": len(prompt) // 4, "reasoning_tokens": len(thinking.split()),
                 "completion_tokens": len(thinking.split()) + len(content.split())}
        if not req.get("stream"):
            message = {"role": "assistant", "content": content}
            if thinking:
                message["reasoning_content"] = thinking.strip()
            self._send(200, {"choices": [{"message": message, "finish_reason": "stop"}], "usage": usage})
            return
        if req.get("stream_options", {}).get("bad"):
            self._send(400, {"error": "unsupported"})
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()

        def emit(obj):
            self.wfile.write(f"data: {json.dumps(obj)}\n\n".encode())
            self.wfile.flush()
            time.sleep(0.002)

        for word in thinking.split():
            emit({"choices": [{"delta": {"reasoning_content": word + " "}}]})
        for word in re.findall(r"\S+\s*", content):
            emit({"choices": [{"delta": {"content": word}}]})
        emit({"choices": [{"delta": {}, "finish_reason": "stop"}]})
        if req.get("stream_options", {}).get("include_usage"):
            emit({"choices": [], "usage": usage})
        self.wfile.write(b"data: [DONE]\n\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=18010)
    parser.add_argument("--key", default=None, help="require this bearer token")
    parser.add_argument("--reject-top-effort", action="store_true", help="422 on integer top-level reasoning_effort")
    parser.add_argument("--flaky", action="store_true", help="every 4th chat request returns HTTP 500")
    parser.add_argument("--real-like", action="store_true",
                        help="mimic the real server: thinking off by default, string efforts switch it on")
    args = parser.parse_args()
    KEY, REJECT_TOP_EFFORT, FLAKY, REAL_LIKE = args.key, args.reject_top_effort, args.flaky, args.real_like
    print(f"mock OpenAI-compatible server on http://127.0.0.1:{args.port}/v1 (key {'required' if KEY else 'not required'})")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
