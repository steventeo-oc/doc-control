"""Per-user limits that protect the shared LLM (plan-back F9): a per-minute window, and an optional daily cap
that is off by default (owner decision: no daily cap)."""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self, per_minute, per_day, log, clock=time.time):
        self.per_minute, self.per_day, self.log, self.clock = per_minute, per_day, log, clock
        self._hits = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, user_id):
        """(allowed, retry_after_seconds). Records the attempt when allowed."""
        now = self.clock()
        with self._lock:
            hits = self._hits[str(user_id)]
            while hits and hits[0] <= now - 60:
                hits.popleft()
            if self.per_minute > 0 and len(hits) >= self.per_minute:
                return False, max(1, int(hits[0] + 60 - now) + 1)
            if self.per_day > 0 and self.log.count_since(user_id, now - 86400) >= self.per_day:
                return False, 3600
            hits.append(now)
        return True, 0
