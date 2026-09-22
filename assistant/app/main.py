"""Wiring for the real service: `uvicorn app.main:create --factory --host 0.0.0.0 --port 8000`."""
from __future__ import annotations

import logging
from pathlib import Path

from .api import Services, create_app
from .ask import Assistant
from .auth import no_auth
from .config import Settings
from .conversations import Conversations
from .db import Database
from .doccontrol import DocControlSource
from .index import Index
from .logdb import QueryLog
from .models import Embedder, Llm, Reranker
from .ratelimit import RateLimiter
from .session import SessionAuth
from .sources import FolderSource
from .sync import Syncer

log = logging.getLogger("assistant")


def build_source(settings):
    if settings.source == "folder":
        return FolderSource(settings.folder)
    return DocControlSource.from_settings(settings)


def build_authenticator(settings):
    if settings.auth == "none":
        log.warning("ASSISTANT_AUTH=none: every request is treated as a local administrator (development only)")
        return no_auth
    return SessionAuth(settings.api_url, settings.allowed_origins, settings.session_cache_s)


def build_services(settings):
    Path(settings.data_dir).mkdir(parents=True, exist_ok=True)
    db = Database(Path(settings.data_dir) / "assistant.db")
    index = Index(db)
    embedder = Embedder(settings.emb_base_url, settings.emb_api_key, settings.emb_model,
                        settings.emb_query_prefix, settings.emb_doc_prefix)
    reranker = Reranker(settings.rerank_base_url, settings.rerank_api_key, settings.rerank_model)
    llm = Llm(settings.llm_base_url, settings.llm_api_key, settings.llm_model, settings.llm_effort,
              settings.llm_timeout)
    log_db = QueryLog(db)
    return Services(settings=settings, assistant=Assistant(settings, index, embedder, reranker, llm, log_db),
                    index=index, syncer=Syncer(settings, index, build_source(settings), embedder), log=log_db,
                    limiter=RateLimiter(settings.rate_per_min, settings.rate_per_day, log_db),
                    conversations=Conversations(db), authenticate=build_authenticator(settings))


def create():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = Settings.from_env()
    return create_app(build_services(settings), start_sync=True)
