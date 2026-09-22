#!/usr/bin/env python3
"""A tiny OpenAI-compatible stand-in for the three model servers, so the whole assistant flow can run on a machine
with no GPU: the compose profile `mock-models` and smoke section 16 use it.

The "embedding" is a hashed bag of words, the "reranker" counts shared words, and the "LLM" quotes the best-matching
sentence of the best source with its [S#] label (NOT_FOUND when nothing shares two words with the question). It
proves the plumbing, never the quality of any real model.

    python tools/mock_models.py [--host 0.0.0.0] [--port 8010] [--key secret]"""
import argparse
import hashlib
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DIM = 256
STOP = set("a an and are as at be by for from has have in is it its of on or that the to was were will with "
           "what how often must does do i my we".split())
KEY = None


def toks(text):
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in STOP]


def embed(text):
    vec = [0.0] * DIM
    for token in toks(text):
        vec[int(hashlib.md5(token.encode()).hexdigest(), 16) % DIM] += 1.0
    norm = sum(x * x for x in vec) ** 0.5 or 1.0
    return [x / norm for x in vec]


def chat_reply(prompt):
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
        if self.path == "/health":
            self._send(200, {"status": "ok"})
        elif self._authorized() and self.path.endswith("/models"):
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
            prompt = req["messages"][-1]["content"]
            content = chat_reply(prompt)
            usage = {"prompt_tokens": len(prompt) // 4, "completion_tokens": len(content.split())}
            # echoed back so a test can prove what the client actually sent (a falsy-but-present 0.0 is easy to drop
            # by accident, e.g. `if temperature:` instead of `if temperature is not None:`)
            self._send(200, {"choices": [{"message": {"role": "assistant", "content": content},
                                          "finish_reason": "stop"}], "usage": usage,
                             "received": {"temperature": req.get("temperature"), "reasoning_effort": req.get("reasoning_effort")}})
        else:
            self._send(404, {"error": "not found"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8010)
    parser.add_argument("--key", default=None, help="require this bearer token")
    args = parser.parse_args()
    KEY = args.key
    print(f"mock model server on http://{args.host}:{args.port}/v1 (key {'required' if KEY else 'not required'})",
          flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
