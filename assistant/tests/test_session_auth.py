import types

import pytest
import requests
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api import Services, create_app
from app.session import SessionAuth
from app.ratelimit import RateLimiter

ME = {"id": 7, "name": "Aisha", "email": "aisha@example.com", "active": True, "roles": ["User"],
      "departments": [{"id": 1, "code": "QA", "label": "Quality", "active": True, "level": "COLLABORATOR"}]}
ORIGIN = "http://localhost:3000"


class FakeReply:
    def __init__(self, status, body=None):
        self.status_code, self._body = status, body

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


class FakeApi:
    """Stands in for requests.get: records what was sent and answers as the test says."""

    def __init__(self):
        self.calls, self.reply, self.error = [], FakeReply(200, ME), None

    def __call__(self, url, headers=None, timeout=None, allow_redirects=None):
        self.calls.append((url, dict(headers or {})))
        if self.error:
            raise self.error
        return self.reply


def req(method="GET", cookies=None, headers=None):
    return types.SimpleNamespace(method=method, cookies=cookies or {},
                                 headers={k.lower(): v for k, v in (headers or {}).items()})


def make(origins=(ORIGIN,), ttl=60):
    api, clock = FakeApi(), [0.0]
    return SessionAuth("http://api:8080/api", origins, ttl, get=api, clock=lambda: clock[0]), api, clock


def status_of(auth, request):
    with pytest.raises(HTTPException) as err:
        auth(request)
    return err.value.status_code


def test_a_request_without_a_session_cookie_is_not_signed_in():
    auth, api, _ = make()
    assert status_of(auth, req()) == 401
    assert api.calls == []                                        # nothing to ask the api about


def test_a_valid_session_becomes_an_identity_and_only_the_session_cookie_is_forwarded():
    auth, api, _ = make()
    who = auth(req(cookies={"JSESSIONID": "abc", "XSRF-TOKEN": "t", "other": "x"}))
    assert (who.id, who.name, who.email, who.roles, who.departments) == (
        7, "Aisha", "aisha@example.com", ("User",), ("QA",))
    assert not who.is_admin
    url, headers = api.calls[0]
    assert url == "http://api:8080/api/auth/me" and headers["Cookie"] == "JSESSIONID=abc"


def test_the_admin_role_makes_an_admin():
    auth, api, _ = make()
    api.reply = FakeReply(200, {**ME, "roles": ["Admin", "User"]})
    assert auth(req(cookies={"JSESSIONID": "abc"})).is_admin


def test_the_answer_is_remembered_for_the_configured_time_and_then_asked_again():
    auth, api, clock = make(ttl=60)
    request = req(cookies={"JSESSIONID": "abc"})
    auth(request)
    auth(request)
    assert len(api.calls) == 1
    clock[0] += 61
    auth(request)
    assert len(api.calls) == 2


def test_different_sessions_do_not_share_an_answer():
    auth, api, _ = make()
    auth(req(cookies={"JSESSIONID": "one"}))
    api.reply = FakeReply(200, {**ME, "id": 8, "name": "Bala"})
    assert auth(req(cookies={"JSESSIONID": "two"})).id == 8
    assert auth(req(cookies={"JSESSIONID": "one"})).id == 7


def test_a_session_the_api_refuses_is_401_and_briefly_remembered():
    auth, api, clock = make()
    api.reply = FakeReply(401)
    request = req(cookies={"JSESSIONID": "stale"})
    assert status_of(auth, request) == 401
    assert status_of(auth, request) == 401
    assert len(api.calls) == 1                                    # a bad cookie cannot make the api do the work
    clock[0] += 6
    assert status_of(auth, request) == 401
    assert len(api.calls) == 2


def test_a_deactivated_user_is_not_signed_in():
    auth, api, _ = make()
    api.reply = FakeReply(200, {**ME, "active": False})
    assert status_of(auth, req(cookies={"JSESSIONID": "abc"})) == 401


@pytest.mark.parametrize("failure", ["down", "server-error", "not-json"])
def test_an_api_outage_is_503_never_a_logout_and_is_not_remembered(failure):
    auth, api, _ = make()
    request = req(cookies={"JSESSIONID": "abc"})
    if failure == "down":
        api.error = requests.ConnectionError("refused")
    elif failure == "server-error":
        api.reply = FakeReply(500)
    else:
        api.reply = FakeReply(200)                                # 200 without a JSON body
    assert status_of(auth, request) == 503
    api.error, api.reply = None, FakeReply(200, ME)
    assert auth(request).id == 7                                  # the very next request is fine again
    assert len(api.calls) == 2


def test_the_session_cookie_is_never_kept_in_the_clear():
    auth, _api, _ = make()
    auth(req(cookies={"JSESSIONID": "super-secret-cookie"}))
    assert all("super-secret-cookie" not in key for key in auth._cache)


def test_state_changing_requests_need_the_double_submit_token():
    auth, _api, _ = make()
    cookies = {"JSESSIONID": "abc", "XSRF-TOKEN": "tok"}
    assert status_of(auth, req("POST", cookies)) == 403                                        # no header
    assert status_of(auth, req("POST", cookies, {"X-XSRF-TOKEN": "other"})) == 403             # not the cookie's value
    assert status_of(auth, req("POST", {"JSESSIONID": "abc"}, {"X-XSRF-TOKEN": "tok"})) == 403  # no cookie
    assert auth(req("POST", cookies, {"X-XSRF-TOKEN": "tok"})).id == 7
    assert auth(req("GET", {"JSESSIONID": "abc"})).id == 7                                     # reads need none


def test_the_origin_header_is_checked_when_the_browser_sends_one():
    auth, _api, _ = make(origins=(ORIGIN,))
    cookies, header = {"JSESSIONID": "abc", "XSRF-TOKEN": "tok"}, {"X-XSRF-TOKEN": "tok"}
    assert status_of(auth, req("POST", cookies, {**header, "Origin": "http://evil.example"})) == 403
    assert auth(req("POST", cookies, {**header, "Origin": "http://LOCALHOST:3000/"})).id == 7
    assert auth(req("POST", cookies, header)).id == 7             # no Origin: not a browser cross-site request


def test_the_pages_own_address_needs_no_configuration():
    # The box serves the app on port 3001 under an address nobody listed; a real browser's Origin is that address and
    # nginx forwards it as Host, so it must pass with an empty list (and a wrong APP_BASE_URL must not lock anyone out).
    auth, _api, _ = make(origins=())
    cookies = {"JSESSIONID": "abc", "XSRF-TOKEN": "tok"}
    same = {"X-XSRF-TOKEN": "tok", "Host": "192.168.9.138:3001", "Origin": "http://192.168.9.138:3001"}
    assert auth(req("POST", cookies, same)).id == 7
    assert auth(req("POST", cookies, {**same, "Origin": "HTTP://192.168.9.138:3001/"})).id == 7
    assert auth(req("POST", cookies, {**same, "Origin": "https://192.168.9.138:3001"})).id == 7   # a TLS terminator in front


def test_other_origins_are_refused_even_when_nothing_is_listed():
    auth, _api, _ = make(origins=())
    cookies = {"JSESSIONID": "abc", "XSRF-TOKEN": "tok"}
    same = {"X-XSRF-TOKEN": "tok", "Host": "192.168.9.138:3001", "Origin": "http://192.168.9.138:3001"}
    for origin in ("http://evil.example", "http://192.168.9.138:3000", "http://192.168.9.138", "null",
                   "http://192.168.9.138:3001@evil.example"):
        assert status_of(auth, req("POST", cookies, {**same, "Origin": origin})) == 403, origin
    no_host = {"X-XSRF-TOKEN": "tok", "Origin": "http://192.168.9.138:3001"}
    assert status_of(auth, req("POST", cookies, no_host)) == 403                       # nothing to compare it with
    assert status_of(auth, req("POST", cookies, {"Host": "192.168.9.138:3001",
                                                "Origin": "http://192.168.9.138:3001"})) == 403   # the token is still needed


def test_a_listed_origin_still_works_when_the_host_differs():
    auth, _api, _ = make(origins=("https://docs.example.com",))
    cookies = {"JSESSIONID": "abc", "XSRF-TOKEN": "tok"}
    behind_proxy = {"X-XSRF-TOKEN": "tok", "Host": "web:80", "Origin": "https://docs.example.com"}
    assert auth(req("POST", cookies, behind_proxy)).id == 7
    assert status_of(auth, req("POST", cookies, {**behind_proxy, "Origin": "https://other.example.com"})) == 403


def app_client(env, auth):
    services = Services(settings=env.settings, assistant=env.assistant, index=env.index, syncer=env.syncer,
                        log=env.log, limiter=RateLimiter(100, 0, env.log, clock=lambda: env.clock[0]),
                        conversations=env.conversations, authenticate=auth)
    return TestClient(create_app(services))


def test_the_http_api_uses_the_session_check(stocked):
    auth, api, _ = make()
    client = app_client(stocked, auth)
    user = {"Cookie": "JSESSIONID=abc; XSRF-TOKEN=tok"}
    question = {"question": "How long is the burn-in stability run?"}

    assert client.get("/api/assistant/health").status_code == 200                              # needs no login
    assert client.get("/api/assistant/config").status_code == 401
    assert client.get("/api/assistant/config", headers=user).json()["allowed"] is True
    assert client.post("/api/assistant/ask", json=question, headers=user).status_code == 403   # no CSRF header
    answered = client.post("/api/assistant/ask", json=question,
                           headers={**user, "X-XSRF-TOKEN": "tok", "Origin": ORIGIN})
    assert answered.status_code == 200 and answered.json()["state"] == "answered"
    assert client.get("/api/assistant/admin/status", headers=user).status_code == 403          # a plain user

    api.reply = FakeReply(200, {**ME, "id": 1, "name": "Admin", "roles": ["Admin"]})
    admin = {"Cookie": "JSESSIONID=boss; XSRF-TOKEN=tok"}
    assert client.get("/api/assistant/admin/status", headers=admin).status_code == 200
    assert client.get("/api/assistant/admin/status.html", headers=admin).status_code == 200

    api.error = requests.ConnectionError("api restarting")
    assert client.get("/api/assistant/config", headers={"Cookie": "JSESSIONID=new"}).status_code == 503
