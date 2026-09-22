"""Who is asking: the identity the rest of the service works with, and the development identity.

The production check that produces an Identity from a browser's session lives in session.py, which needs the web stack
(requests, fastapi). This module needs nothing, so the release gate and the terminal client can import the service on a
machine that has only the document and model packages (the box's spike environment)."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Identity:
    id: object
    name: str
    email: str = ""
    roles: tuple = ()
    departments: tuple = ()

    @property
    def is_admin(self):
        return "Admin" in self.roles


# Used only when ASSISTANT_AUTH=none, which Settings only allows together with the folder source.
LOCAL_IDENTITY = Identity(0, "Local user", "local@localhost", ("Admin",), ())


def no_auth(_request):
    return LOCAL_IDENTITY
