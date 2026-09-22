"""Keyword search (BM25) and rank fusion: the parts of retrieval that need no model."""
from __future__ import annotations

import math
import re
from collections import Counter, defaultdict

STOP = set("a an and are as at be by for from has have in is it its of on or that the to was were will with".split())
TOKEN_RE = re.compile(r"[A-Za-z0-9]+(?:[-_/.][A-Za-z0-9]+)*")
SPLIT_RE = re.compile(r"[-_/.]")


def tokenize(text):
    """Lowercase tokens; hyphenated ids such as SOP-QA-0010 also contribute their parts, so a search for
    'SOP-QA-0010' and one for '0010' both find it."""
    out = []
    for match in TOKEN_RE.finditer(text.lower()):
        token = match.group(0)
        if token not in STOP:
            out.append(token)
        if SPLIT_RE.search(token):
            out.extend(part for part in SPLIT_RE.split(token) if part and part not in STOP)
    return out


def approx_tokens(text):
    return max(1, len(text) // 4)


class BM25:
    def __init__(self, corpus, k1=1.5, b=0.75):
        self.k1, self.b, self.n = k1, b, len(corpus)
        self.lengths = [len(doc) for doc in corpus]
        self.avgdl = (sum(self.lengths) / self.n) if self.n else 1.0
        self.postings = defaultdict(list)
        for i, doc in enumerate(corpus):
            for term, tf in Counter(doc).items():
                self.postings[term].append((i, tf))

    def topk(self, query_tokens, k):
        scores = defaultdict(float)
        for term in set(query_tokens):
            plist = self.postings.get(term)
            if not plist:
                continue
            idf = math.log(1 + (self.n - len(plist) + 0.5) / (len(plist) + 0.5))
            for i, tf in plist:
                norm = tf + self.k1 * (1 - self.b + self.b * self.lengths[i] / self.avgdl)
                scores[i] += idf * tf * (self.k1 + 1) / norm
        return sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:k]


def rrf(rankings, k=60):
    """Reciprocal rank fusion over ranked (id, score) lists: an item near the top of several lists wins."""
    fused = defaultdict(float)
    for ranking in rankings:
        for rank, (i, _) in enumerate(ranking, start=1):
            fused[i] += 1.0 / (k + rank)
    return sorted(fused.items(), key=lambda kv: kv[1], reverse=True)
