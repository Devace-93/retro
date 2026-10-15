"""Key / slug validation and slugification for projects and boards.

Rules come straight from CONTRACT.md:

* project keys:  ``^[a-z0-9][a-z0-9-]{0,62}$`` (unique per account)
* board slugs:   ``^[a-z0-9][a-z0-9-]{1,62}$`` (globally unique, not reserved)

Board slugs are the path segment of ``/b/<slug>``; the reserved list keeps
them from colliding with the app's own top-level routes.
"""
from __future__ import annotations

import re
import secrets
import unicodedata

PROJECT_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
BOARD_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")

# Top-level routes of the web app (and the API/MCP mounts) a board must not shadow.
RESERVED_BOARD_SLUGS = frozenset(
    {"api", "b", "widget", "dashboard", "login", "signup", "logout", "info", "blog",
     "sponsors", "mcp", "settings", "billing", "assets", "build", "healthz"}
)


def is_valid_project_key(key: str) -> bool:
    return bool(PROJECT_KEY_RE.match(key or ""))


def is_valid_board_slug(slug: str) -> bool:
    return bool(BOARD_SLUG_RE.match(slug or ""))


def is_reserved_board_slug(slug: str) -> bool:
    return slug in RESERVED_BOARD_SLUGS


def slugify(name: str, max_len: int = 63) -> str:
    """``"Web App (EU)"`` -> ``"web-app-eu"``. Lowercase ASCII, dashes between
    words, trimmed to ``max_len``; empty input yields ``""`` (caller decides)."""
    text = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return text[:max_len].rstrip("-")


def suffixed(slug: str, max_len: int = 63) -> str:
    """``slug`` + ``-xxxx`` (4 random lowercase alphanumerics), kept within ``max_len``."""
    alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
    tail = "".join(secrets.choice(alphabet) for _ in range(4))
    return f"{slug[: max_len - 5].rstrip('-')}-{tail}"
