"""The production source: the `assistant_indexable_version` view in Postgres, and the MinIO bucket that holds the
files it points at (plan-back F4).

Two read-only credentials and two read-only operations, one SELECT and one GET: nothing here can change
document-control. The view already applies the visibility rule (F3: not trashed, approved or released, the current
version), so this module has no filter of its own; if a document leaves the view, the next sync drops it."""
from __future__ import annotations

from urllib.parse import urlparse

from .sources import VersionRef, strip_revision

# The columns of the view (migration V12). AssistantIndexViewTests pins the same list on the Java side.
COLUMNS = ("document_id", "document_number", "document_name", "type_code", "department_code", "version_id",
           "version_number", "file_reference", "effective_at", "uploaded_at", "document_updated_at")
QUERY = ("SELECT " + ", ".join(COLUMNS) +
         " FROM assistant_indexable_version ORDER BY document_number, version_id")


def clean_name(name, number):
    """The index header wants the title alone: neither the document number (it is added separately) nor a trailing
    'Rev N' (the system owns both). Falls back to the number for a document that has no other name."""
    title = (name or "").replace(number, "", 1).strip(" -_") if number else (name or "").strip()
    return strip_revision(title) or number


def _iso(value):
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def _ref(row):
    number = str(row["document_number"])
    return VersionRef(version_id=str(row["version_id"]), document_number=number,
                      name=clean_name(row["document_name"], number), file_reference=row["file_reference"],
                      document_id=str(row["document_id"]), type_code=row["type_code"],
                      department_code=row["department_code"], version_number=row["version_number"],
                      effective_at=_iso(row["effective_at"]))


def parse_endpoint(endpoint):
    """'http://minio:9000' -> ('minio:9000', False); a bare 'minio:9000' is plain http."""
    parsed = urlparse(endpoint if "://" in endpoint else "http://" + endpoint)
    return parsed.netloc, parsed.scheme == "https"


class MinioStorage:
    def __init__(self, endpoint, access_key, secret_key, bucket, client=None):
        self.bucket = bucket
        if client is None:
            from minio import Minio            # only the production source needs the SDK
            host, secure = parse_endpoint(endpoint)
            client = Minio(host, access_key=access_key, secret_key=secret_key, secure=secure)
        self._client = client

    def get(self, key):
        response = self._client.get_object(self.bucket, key)
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()


def postgres_connector(settings):
    """A function that opens a fresh read-only connection. One per sync: an outage heals itself and no connection
    sits idle for five minutes."""
    def connect():
        import psycopg                         # only the production source needs the driver
        options = {"connect_timeout": settings.db_timeout, "autocommit": True,
                   "options": "-c default_transaction_read_only=on -c statement_timeout=30000"}
        if settings.db_password:
            options["password"] = settings.db_password
        return psycopg.connect(settings.db_url, **options)
    return connect


class DocControlSource:
    def __init__(self, connect, storage):
        self._connect, self._storage = connect, storage

    @classmethod
    def from_settings(cls, s):
        missing = [name for name, value in (("ASSISTANT_DB_URL", s.db_url),
                                            ("ASSISTANT_MINIO_ENDPOINT", s.minio_endpoint),
                                            ("ASSISTANT_MINIO_ACCESS_KEY", s.minio_access_key),
                                            ("ASSISTANT_MINIO_SECRET_KEY", s.minio_secret_key)) if not value]
        if missing:
            raise RuntimeError("ASSISTANT_SOURCE=doccontrol needs " + ", ".join(missing) +
                               " (the read-only role and MinIO user from the RUNBOOK)")
        storage = MinioStorage(s.minio_endpoint, s.minio_access_key, s.minio_secret_key, s.minio_bucket)
        return cls(postgres_connector(s), storage)

    def list_versions(self):
        connection = self._connect()
        try:
            cursor = connection.cursor()
            cursor.execute(QUERY)
            rows = cursor.fetchall()
        finally:
            connection.close()
        return [_ref(dict(zip(COLUMNS, row))) for row in rows]

    def fetch(self, ref):
        # The object key ends with the original file name (documents/{documentId}/{versionId}/{fileName}).
        return ref.file_reference.rsplit("/", 1)[-1], self._storage.get(ref.file_reference)
