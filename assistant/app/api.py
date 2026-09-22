"""The HTTP contract (plan-back 2.4). Everything lives under /api/assistant so the browser sends the api's
session cookie (its path is /api) and nginx can route by prefix."""
from __future__ import annotations

import calendar
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Callable, Literal, Optional

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from .ask import Assistant, IndexBuilding, reader_text
from .auth import Identity
from .conversations import Conversations
from .index import Index, iso_utc
from .logdb import QueryLog
from .ratelimit import RateLimiter
from .statuspage import render as render_status
from .sync import SyncLoop, Syncer


@dataclass
class Services:
    settings: object
    assistant: Assistant
    index: Index
    syncer: Syncer
    log: QueryLog
    limiter: RateLimiter
    conversations: Conversations
    authenticate: Callable[[Request], Identity]


class AskBody(BaseModel):
    question: str


class RenameBody(BaseModel):
    title: str


class FeedbackBody(BaseModel):
    id: int
    rating: Literal["up", "down"]
    comment: Optional[str] = None


def _epoch(day):
    if not day:
        return None
    try:
        return calendar.timegm(time.strptime(day, "%Y-%m-%d"))
    except ValueError:
        raise HTTPException(400, "dates must look like 2026-09-21") from None


def create_app(svc, start_sync=False):
    settings = svc.settings
    loop = SyncLoop(svc.syncer, settings.sync_minutes,
                    after=lambda: svc.log.purge_older_than(settings.log_retention_days)) if start_sync else None

    @asynccontextmanager
    async def lifespan(_app):
        if loop:
            loop.start()
        yield
        if loop:
            loop.stop()

    app = FastAPI(title="Document Control assistant", docs_url=None, redoc_url=None, openapi_url=None,
                  lifespan=lifespan)
    router = APIRouter(prefix="/api/assistant")

    def who(request: Request) -> Identity:
        return svc.authenticate(request)

    def allowed(identity):
        return settings.enabled and (not settings.allowed_departments
                                     or bool(set(identity.departments) & set(settings.allowed_departments)))

    def admin(identity: Identity = Depends(who)):
        if not identity.is_admin:
            raise HTTPException(403, "administrators only")
        return identity

    @router.get("/health")
    def health():
        return {"status": "ok"}

    @router.get("/config")
    def config(identity: Identity = Depends(who)):
        last = svc.index.last_sync()
        return {"enabled": settings.enabled, "allowed": allowed(identity), "examples": list(settings.examples),
                "maxQuestionChars": settings.max_question_chars, "documents": len(svc.index.snapshot.versions),
                "syncedAt": iso_utc(last["finished_at"]) if last else None}

    def ready_to_ask(identity, raw_question):
        """Every check a question must pass before it reaches the model, shared by a one-off /ask and both
        conversation endpoints -- same order as always: switched on, allowed, well-formed, then the rate limit (an
        invalid question never costs the asker a slot)."""
        if not settings.enabled:
            raise HTTPException(404, "the assistant is not switched on")
        if not allowed(identity):
            raise HTTPException(403, "the assistant is not available to your department yet")
        question = " ".join(raw_question.split())
        if not question:
            raise HTTPException(400, "type a question first")
        if len(question) > settings.max_question_chars:
            raise HTTPException(400, f"questions are limited to {settings.max_question_chars} characters")
        ok, retry_after = svc.limiter.check(identity.id)
        if not ok:
            raise HTTPException(429, "too many questions; please wait a moment",
                                headers={"Retry-After": str(retry_after)})
        return question

    @router.post("/ask")
    def ask(body: AskBody, identity: Identity = Depends(who)):
        question = ready_to_ask(identity, body.question)
        try:
            return svc.assistant.ask(question, identity).response
        except IndexBuilding:
            raise HTTPException(503, "the document index is still being built; try again in a few minutes") from None

    # ---- saved conversations (Phase 1) -----------------------------------------------------------------------
    # Listing, reopening, renaming and archiving a conversation are always available -- they only touch a user's
    # own saved history, unlike asking, which needs the service itself switched on.

    @router.get("/conversations")
    def list_conversations(identity: Identity = Depends(who)):
        return [{"id": c["id"], "title": c["title"], "updatedAt": iso_utc(c["updated_at"]),
                 "messageCount": c["message_count"]} for c in svc.conversations.list(identity)]

    @router.post("/conversations")
    def start_conversation(body: AskBody, identity: Identity = Depends(who)):
        question = ready_to_ask(identity, body.question)
        conversation_id = svc.conversations.create(identity, question)
        try:
            return svc.assistant.ask(question, identity, conversation_id=conversation_id).response
        except IndexBuilding:
            svc.conversations.discard(conversation_id)   # never got a first message: don't leave an empty thread
            raise HTTPException(503, "the document index is still being built; try again in a few minutes") from None

    @router.get("/conversations/{conversation_id}")
    def get_conversation(conversation_id: int, identity: Identity = Depends(who)):
        convo = svc.conversations.owned_by(identity, conversation_id)
        if not convo:
            raise HTTPException(404, "no such conversation")
        return {"id": convo["id"], "title": convo["title"], "updatedAt": iso_utc(convo["updated_at"]),
                "messages": [{"id": m["id"], "at": iso_utc(m["at"]), "question": m["question"],
                             "answer": reader_text(m["state"], m["answer"] or ""), "state": m["state"],
                             "sources": m["sources"], "rating": m["rating"], "comment": m["comment"]}
                            for m in svc.conversations.messages(conversation_id)]}

    @router.post("/conversations/{conversation_id}/messages")
    def continue_conversation(conversation_id: int, body: AskBody, identity: Identity = Depends(who)):
        if not svc.conversations.owned_by(identity, conversation_id):
            raise HTTPException(404, "no such conversation")
        question = ready_to_ask(identity, body.question)
        history = svc.conversations.history(conversation_id, settings.conversation_history_turns)
        try:
            result = svc.assistant.ask(question, identity, history=history, conversation_id=conversation_id).response
        except IndexBuilding:
            raise HTTPException(503, "the document index is still being built; try again in a few minutes") from None
        svc.conversations.touch(conversation_id)
        return result

    @router.patch("/conversations/{conversation_id}", status_code=204)
    def rename_conversation(conversation_id: int, body: RenameBody, identity: Identity = Depends(who)):
        if not svc.conversations.rename(identity, conversation_id, body.title):
            raise HTTPException(404, "no such conversation")
        return Response(status_code=204)

    @router.delete("/conversations/{conversation_id}", status_code=204)
    def delete_conversation(conversation_id: int, identity: Identity = Depends(who)):
        if not svc.conversations.archive(identity, conversation_id):
            raise HTTPException(404, "no such conversation")
        return Response(status_code=204)

    @router.post("/feedback", status_code=204)
    def feedback(body: FeedbackBody, identity: Identity = Depends(who)):
        if not svc.log.set_feedback(body.id, identity, body.rating, body.comment):
            raise HTTPException(404, "no such answer")
        return Response(status_code=204)

    def build_status():
        last = svc.index.last_sync()
        stats = svc.index.stats()
        return {"documents": {"indexed": stats["indexed"], "skipped": stats["skipped"], "failed": stats["failed"]},
                "chunks": stats["chunks"], "problems": svc.index.problem_rows(),
                "redactions": svc.index.redaction_rows(), "syncRunning": svc.syncer.running,
                "lastSync": ({**last, "startedAt": iso_utc(last["started_at"]),
                              "finishedAt": iso_utc(last["finished_at"])} if last else None),
                "models": svc.assistant.models_health(), "model": svc.assistant.llm.model,
                "promptVersion": settings.prompt, "source": settings.source}

    @router.get("/admin/status")
    def status(_identity: Identity = Depends(admin)):
        return build_status()

    @router.get("/admin/status.html", response_class=HTMLResponse)
    def status_page(_identity: Identity = Depends(admin)):
        return HTMLResponse(render_status(build_status()),
                            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    @router.post("/admin/sync", status_code=202)
    def sync_now(_identity: Identity = Depends(admin)):
        if svc.syncer.running:
            raise HTTPException(409, "a sync is already running")
        threading.Thread(target=svc.syncer.run, name="assistant-sync-now", daemon=True).start()
        return {"started": True}

    @router.get("/admin/log.csv")
    def log_csv(since: Optional[str] = None, until: Optional[str] = None, _identity: Identity = Depends(admin)):
        text = svc.log.export_csv(_epoch(since), _epoch(until))
        return Response(content="﻿" + text, media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="assistant-log.csv"'})

    app.include_router(router)
    return app
