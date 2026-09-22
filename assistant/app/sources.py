"""Where the current documents come from.

`FolderSource` reads a directory (development and the release gate). The production source, which reads the
`assistant_indexable_version` view and MinIO, arrives in Phase B behind the same two methods."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

DOC_NUMBER_RE = re.compile(r"\b[A-Z]{2,6}-[A-Z]{2,6}-\d{3,5}\b")
_TRAILING_REV = re.compile(r"\s+Rev\.?\s*\d+\s*$", re.IGNORECASE)


@dataclass(frozen=True)
class VersionRef:
    version_id: str
    document_number: str
    name: str
    file_reference: str                   # object key, or a path relative to the folder
    document_id: str | None = None
    type_code: str | None = None
    department_code: str | None = None
    version_number: int | None = None
    effective_at: str | None = None
    size: int | None = None

    def as_meta(self):
        return {"version_id": self.version_id, "document_id": self.document_id,
                "document_number": self.document_number, "name": self.name, "type_code": self.type_code,
                "department_code": self.department_code, "version_number": self.version_number,
                "effective_at": self.effective_at, "file_reference": self.file_reference}


def strip_revision(title):
    """The revision is the system's business, not part of the title (convention 5): drop a trailing 'Rev N'."""
    return _TRAILING_REV.sub("", title).strip()


def split_title(stem):
    """'SOP-ENG-0001 Server Tray Assembly Rev 0' -> ('SOP-ENG-0001', 'Server Tray Assembly')."""
    match = DOC_NUMBER_RE.search(stem)
    number = match.group(0) if match else stem
    title = stem.replace(number, "", 1).strip(" -_") if match else stem
    title = strip_revision(title) or number
    return number, title


class FolderSource:
    def __init__(self, root):
        self.root = Path(root)

    def list_versions(self):
        refs = []
        for path in sorted(p for p in self.root.rglob("*") if p.is_file()):
            if path.name.startswith(("~$", ".")):
                continue                  # Word lock files and hidden files
            stat = path.stat()
            relative = path.relative_to(self.root).as_posix()
            number, title = split_title(path.stem)
            digest = hashlib.sha1(f"{relative}|{stat.st_size}|{stat.st_mtime_ns}".encode()).hexdigest()[:16]
            refs.append(VersionRef(version_id=f"f{digest}", document_number=number, name=title,
                                   file_reference=relative, version_number=1, size=stat.st_size))
        return refs

    def fetch(self, ref):
        path = self.root / ref.file_reference
        return path.name, path.read_bytes()
