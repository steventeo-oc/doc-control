"""Settings from environment variables (plan-back section 2.7). Secrets only ever come from the environment."""
from __future__ import annotations

import os
from dataclasses import dataclass, field

# Qwen3-Embedding wants an instruction in front of the query (not in front of documents). Other embedding
# models need a different prefix, hence a setting; a literal backslash-n in an env file becomes a newline.
DEFAULT_QUERY_PREFIX = ("Instruct: Given a question about company procedures, retrieve the passages that "
                        "answer it\nQuery: ")


def _text(env, name, default=""):
    value = env.get(name)
    return default if value is None or value.strip() == "" else value.strip()


def _int(env, name, default):
    raw = env.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a whole number, got {raw!r}") from exc


def _float(env, name, default):
    raw = env.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a number, got {raw!r}") from exc


def _bool(env, name, default):
    raw = env.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _list(env, name, sep=","):
    return tuple(part.strip() for part in env.get(name, "").split(sep) if part.strip())


@dataclass(frozen=True)
class Settings:
    enabled: bool = False
    source: str = "doccontrol"            # doccontrol | folder (development and evaluation)
    folder: str = "/data/docs"
    data_dir: str = "/data"
    auth: str = "session"                 # session | none (folder source only)
    api_url: str = "http://api:8080/api"
    allowed_origins: tuple = ()           # extra browser origins accepted on POSTs; the page's own address always is
    session_cache_s: int = 60

    # Secrets are excluded from repr() so a logged Settings or a failing test never prints them.
    db_url: str = field(default="", repr=False)   # postgresql://assistant_ro@postgres:5432/doccontrol (read-only role)
    db_password: str = field(default="", repr=False)   # kept out of the URL so the URL itself can be shared
    db_timeout: int = 10
    minio_endpoint: str = ""              # http://minio:9000 (a read-only user)
    minio_access_key: str = ""
    minio_secret_key: str = field(default="", repr=False)
    minio_bucket: str = "doccontrol"

    llm_base_url: str = "http://127.0.0.1:8010/v1"
    llm_api_key: str = field(default="", repr=False)
    llm_model: str = "deepseek-v4.1-flash"
    llm_effort: str = "none"              # pinned so a change of the server default cannot alter behaviour
    # Pinned to 0 for the same reason (found 2026-09-22): with no temperature sent, the server's own default applies,
    # which is not 0 — the real model was seen to answer an English question in Chinese, then correctly in English on
    # two later tries with materially the same question, pointing at sampling variance rather than a language rule
    # miss. Greedy decoding also suits grounded, cited answers better than creative variation.
    llm_temperature: float = 0.0
    llm_timeout: int = 45
    max_tokens: int = 1200

    emb_base_url: str = "http://127.0.0.1:8011/v1"
    emb_api_key: str = field(default="", repr=False)
    emb_model: str = ""                   # empty: use the first model the server lists
    emb_query_prefix: str = DEFAULT_QUERY_PREFIX
    emb_doc_prefix: str = ""
    rerank_base_url: str = "http://127.0.0.1:8012/v1"
    rerank_api_key: str = field(default="", repr=False)
    rerank_model: str = ""

    prompt: str = "strict-2"
    top_chunks: int = 8
    neighbours: int = 1                   # chunks added on each side of a top hit
    neighbour_top: int = 3                # how many of the top hits get neighbours
    chunk_words: int = 260
    overlap: int = 40
    sync_minutes: int = 5
    max_file_mb: int = 50

    max_concurrent: int = 2               # simultaneous LLM calls (prefill is serialized on the shared server)
    queue_wait_s: int = 20
    rate_per_min: int = 10
    rate_per_day: int = 0                 # 0 = no daily cap (owner decision, 2026-09-21)
    max_question_chars: int = 600
    allowed_departments: tuple = ()       # empty = every signed-in user
    log_retention_days: int = 365
    redact_secrets: bool = True
    examples: tuple = ()
    # Saved conversations, Phase 1 (AI_Assistant_Conversations_PlanBack.md F3): exchanges kept in the prompt for a
    # threaded question. Retrieval is unaffected either way -- Phase 1 doesn't rewrite follow-ups before searching.
    conversation_history_turns: int = 6

    @classmethod
    def from_env(cls, env=None):
        env = os.environ if env is None else env
        defaults = cls()
        settings = cls(
            enabled=_bool(env, "DOCCONTROL_ASSISTANT_ENABLED", defaults.enabled),
            source=_text(env, "ASSISTANT_SOURCE", defaults.source),
            folder=_text(env, "ASSISTANT_FOLDER", defaults.folder),
            data_dir=_text(env, "ASSISTANT_DATA_DIR", defaults.data_dir),
            auth=_text(env, "ASSISTANT_AUTH", defaults.auth),
            api_url=_text(env, "ASSISTANT_API_URL", defaults.api_url).rstrip("/"),
            allowed_origins=_list(env, "ASSISTANT_ALLOWED_ORIGINS"),
            session_cache_s=_int(env, "ASSISTANT_SESSION_CACHE_S", defaults.session_cache_s),
            db_url=_text(env, "ASSISTANT_DB_URL"),
            db_password=_text(env, "ASSISTANT_DB_PASSWORD"),
            db_timeout=_int(env, "ASSISTANT_DB_TIMEOUT", defaults.db_timeout),
            minio_endpoint=_text(env, "ASSISTANT_MINIO_ENDPOINT"),
            minio_access_key=_text(env, "ASSISTANT_MINIO_ACCESS_KEY"),
            minio_secret_key=_text(env, "ASSISTANT_MINIO_SECRET_KEY"),
            minio_bucket=_text(env, "ASSISTANT_MINIO_BUCKET", defaults.minio_bucket),
            llm_base_url=_text(env, "ASSISTANT_LLM_BASE_URL", defaults.llm_base_url).rstrip("/"),
            llm_api_key=_text(env, "ASSISTANT_LLM_API_KEY"),
            llm_model=_text(env, "ASSISTANT_LLM_MODEL", defaults.llm_model),
            llm_effort=_text(env, "ASSISTANT_LLM_EFFORT", defaults.llm_effort),
            llm_temperature=_float(env, "ASSISTANT_LLM_TEMPERATURE", defaults.llm_temperature),
            llm_timeout=_int(env, "ASSISTANT_LLM_TIMEOUT", defaults.llm_timeout),
            max_tokens=_int(env, "ASSISTANT_MAX_TOKENS", defaults.max_tokens),
            emb_base_url=_text(env, "ASSISTANT_EMB_BASE_URL", defaults.emb_base_url).rstrip("/"),
            emb_api_key=_text(env, "ASSISTANT_EMB_API_KEY"),
            emb_model=_text(env, "ASSISTANT_EMB_MODEL"),
            emb_query_prefix=(env.get("ASSISTANT_EMB_QUERY_PREFIX") or defaults.emb_query_prefix).replace("\\n", "\n"),
            emb_doc_prefix=(env.get("ASSISTANT_EMB_DOC_PREFIX") or "").replace("\\n", "\n"),
            rerank_base_url=_text(env, "ASSISTANT_RERANK_BASE_URL", defaults.rerank_base_url).rstrip("/"),
            rerank_api_key=_text(env, "ASSISTANT_RERANK_API_KEY"),
            rerank_model=_text(env, "ASSISTANT_RERANK_MODEL"),
            prompt=_text(env, "ASSISTANT_PROMPT", defaults.prompt),
            top_chunks=_int(env, "ASSISTANT_TOP_CHUNKS", defaults.top_chunks),
            neighbours=_int(env, "ASSISTANT_NEIGHBOURS", defaults.neighbours),
            neighbour_top=_int(env, "ASSISTANT_NEIGHBOUR_TOP", defaults.neighbour_top),
            chunk_words=_int(env, "ASSISTANT_CHUNK_WORDS", defaults.chunk_words),
            overlap=_int(env, "ASSISTANT_OVERLAP", defaults.overlap),
            sync_minutes=_int(env, "ASSISTANT_SYNC_MINUTES", defaults.sync_minutes),
            max_file_mb=_int(env, "ASSISTANT_MAX_FILE_MB", defaults.max_file_mb),
            max_concurrent=_int(env, "ASSISTANT_MAX_CONCURRENT", defaults.max_concurrent),
            queue_wait_s=_int(env, "ASSISTANT_QUEUE_WAIT_S", defaults.queue_wait_s),
            rate_per_min=_int(env, "ASSISTANT_RATE_PER_MIN", defaults.rate_per_min),
            rate_per_day=_int(env, "ASSISTANT_RATE_PER_DAY", defaults.rate_per_day),
            max_question_chars=_int(env, "ASSISTANT_MAX_QUESTION_CHARS", defaults.max_question_chars),
            allowed_departments=_list(env, "ASSISTANT_ALLOWED_DEPARTMENTS"),
            log_retention_days=_int(env, "ASSISTANT_LOG_RETENTION_DAYS", defaults.log_retention_days),
            redact_secrets=_bool(env, "ASSISTANT_REDACT_SECRETS", defaults.redact_secrets),
            examples=_list(env, "ASSISTANT_EXAMPLES", sep="|"),
            conversation_history_turns=_int(env, "ASSISTANT_CONVERSATION_HISTORY_TURNS",
                                            defaults.conversation_history_turns),
        )
        settings.validate()
        return settings

    def validate(self):
        if self.source not in {"doccontrol", "folder"}:
            raise ValueError(f"ASSISTANT_SOURCE must be doccontrol or folder, got {self.source!r}")
        if self.auth not in {"session", "none"}:
            raise ValueError(f"ASSISTANT_AUTH must be session or none, got {self.auth!r}")
        if self.auth == "none" and self.source != "folder":
            # Without a login the service would answer from the real corpus for anyone who can reach it.
            raise ValueError("ASSISTANT_AUTH=none is only allowed with ASSISTANT_SOURCE=folder")
        if self.top_chunks < 1 or self.chunk_words < 20 or not 0 <= self.overlap < self.chunk_words:
            raise ValueError("ASSISTANT_TOP_CHUNKS, ASSISTANT_CHUNK_WORDS and ASSISTANT_OVERLAP are inconsistent")
        if self.max_concurrent < 1:
            raise ValueError("ASSISTANT_MAX_CONCURRENT must be at least 1")
        if not 0 <= self.llm_temperature <= 2:
            raise ValueError("ASSISTANT_LLM_TEMPERATURE must be between 0 and 2")
        if self.conversation_history_turns < 0:
            raise ValueError("ASSISTANT_CONVERSATION_HISTORY_TURNS must not be negative")
