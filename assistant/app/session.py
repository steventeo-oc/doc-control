"""The production sign-in check (plan-back F2).

The assistant never sees a password and never issues a session of its own: it takes the caller's `JSESSIONID`, asks
the api who that is (`GET /api/auth/me`) and remembers the answer for a minute. Logout, expiry and deactivation
therefore take effect within a minute, and each check also counts as activity for the api's session. For state-changing
requests it applies the api's own double-submit CSRF rule (the `X-XSRF-TOKEN` header must equal the `XSRF-TOKEN`
cookie) and, when the browser sends an `Origin`, requires it to be the page's own address or one listed in
ASSISTANT_ALLOWED_ORIGINS. The callable contract is (request) -> Identity, raising HTTP 401 when nobody is signed in.

This lives apart from auth.py because it needs the web stack (requests, fastapi); auth.py needs nothing, so the gate and
the terminal client can import the service on a machine that has only the document and model packages."""
from __future__ import annotations

import hashlib
import hmac
import logging
import threading
import time
from urllib.parse import urlsplit

import requests
from fastapi import HTTPException

from .auth import Identity

log = logging.getLogger(__name__)

SESSION_COOKIE = "JSESSIONID"
CSRF_COOKIE = "XSRF-TOKEN"
CSRF_HEADER = "x-xsrf-token"
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
REJECTED_TTL = 5          # seconds a refused cookie is remembered, so a bad cookie cannot make the api do the work
MAX_CACHED = 2048


class SessionAuth:
    def __init__(self, api_url, allowed_origins=(), ttl=60, timeout=5, get=None, clock=time.monotonic):
        self.url = api_url.rstrip("/") + "/auth/me"
        self.origins = frozenset(o.strip().rstrip("/").lower() for o in allowed_origins if o.strip())
        self.ttl, self.timeout = ttl, timeout
        self._get = get or requests.get         # never a shared Session: a cookie jar would mix up callers
        self._clock = clock
        self._lock = threading.Lock()
        self._cache = {}                        # sha256(session id) -> (valid until, Identity or None)

    def __call__(self, request):
        session = request.cookies.get(SESSION_COOKIE)
        if not session:
            raise HTTPException(401, "sign in required")
        if request.method in UNSAFE_METHODS:
            self._check_intent(request)
        identity = self._identity(session)
        if identity is None:
            raise HTTPException(401, "sign in required")
        return identity

    def _origin_allowed(self, origin, host):
        """The page's own address is always fine, whatever it is: for a same-origin request the browser's Origin names
        the address the reader used, and nginx forwards exactly that as Host (with its port, on this route). So the
        service needs no configuration to work behind an address nobody thought to list, such as a LAN IP or a second
        host name; ASSISTANT_ALLOWED_ORIGINS only adds to it. The scheme is not compared: a TLS terminator in front of
        nginx changes it without changing whose page it is. `Origin: null` and other sites never match."""
        origin = origin.strip().rstrip("/").lower()
        if origin in self.origins:
            return True
        return bool(host) and urlsplit(origin).netloc == host.strip().lower()

    def _check_intent(self, request):
        origin = request.headers.get("origin")
        if origin and not self._origin_allowed(origin, request.headers.get("host")):
            raise HTTPException(403, "request origin not allowed")
        cookie = request.cookies.get(CSRF_COOKIE) or ""
        header = request.headers.get(CSRF_HEADER) or ""
        if not cookie or not hmac.compare_digest(cookie.encode(), header.encode()):
            raise HTTPException(403, "missing or invalid CSRF token")

    def _identity(self, session):
        key = hashlib.sha256(session.encode()).hexdigest()
        now = self._clock()
        with self._lock:
            hit = self._cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
        identity = self._ask_api(session)
        with self._lock:
            if len(self._cache) >= MAX_CACHED:
                self._cache = {k: v for k, v in self._cache.items() if v[0] > now}
                if len(self._cache) >= MAX_CACHED:
                    self._cache.clear()
            self._cache[key] = (now + (self.ttl if identity else REJECTED_TTL), identity)
        return identity

    def _ask_api(self, session):
        """The caller's identity, or None when the api says the session is not valid. Anything else is an outage."""
        try:
            reply = self._get(self.url, headers={"Cookie": f"{SESSION_COOKIE}={session}",
                                                 "Accept": "application/json"},
                              timeout=self.timeout, allow_redirects=False)
        except requests.RequestException as exc:
            log.warning("session check failed: %s", type(exc).__name__)      # never log the cookie
            raise HTTPException(503, "cannot verify your sign-in right now; try again shortly") from None
        if reply.status_code in (401, 403):
            return None
        try:
            if reply.status_code != 200:
                raise ValueError(f"HTTP {reply.status_code}")
            data = reply.json()
        except ValueError as exc:
            log.warning("session check gave an unusable answer: %s", exc)
            raise HTTPException(503, "cannot verify your sign-in right now; try again shortly") from None
        if data.get("active") is False:
            return None
        return Identity(id=data["id"], name=data.get("name") or data.get("email") or "",
                        email=data.get("email") or "", roles=tuple(str(r) for r in data.get("roles") or ()),
                        departments=tuple(str(d["code"]) for d in data.get("departments") or () if d.get("code")))
